/**
 * XNAT REST API Client
 *
 * All XNAT API requests authenticate via JSESSION cookie stored in
 * Electron's default session cookie jar. The session is kept alive
 * by a periodic keepalive ping in sessionManager.
 *
 * All network operations happen in the main process — session cookies
 * never cross the IPC boundary to the renderer.
 *
 * Uses Electron's session.fetch() (Chromium network stack) so requests
 * automatically include cookies from the default session's cookie jar.
 */
import { session as electronSession } from 'electron';
import { data as dcmjsData } from 'dcmjs';
import type { ServerCookie } from './browserLogin';

/** Typed auth error so callers can detect auth failures without string matching. */
export class XnatAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XnatAuthError';
  }
}

export class XnatClient {
  private baseUrl: string;
  private username: string = '';
  /** JSESSION cookie ID — used for auth guards (isAuthenticated, etc.) */
  private jsessionId: string | null = null;
  /** Set by markDisconnected() to stop concurrent in-flight requests from retrying */
  private _disconnected = false;
  private scanSopClassUidCache = new Map<string, string | null>();
  /** CSRF token extracted at login — appended as ?XNAT_CSRF= on mutating requests. */
  private csrfToken: string | null = null;

  private isDicomFileEntry(file: any): boolean {
    const name = String(file?.Name ?? '').toLowerCase();
    const collection = String(file?.collection ?? '').toLowerCase();
    const fileFormat = String(file?.file_format ?? '').toLowerCase();
    const fileContent = String(file?.file_content ?? '').toLowerCase();

    // Prefer explicit XNAT metadata when present.
    if (fileFormat === 'dicom' || fileContent === 'dicom' || collection === 'dicom') {
      return true;
    }

    // Fallback for older resources where only filename hints exist.
    return name.endsWith('.dcm');
  }

  private hasDicomPart10Prefix(buffer: Buffer): boolean {
    return buffer.length >= 132 && buffer.toString('ascii', 128, 132) === 'DICM';
  }

  private hasFileMetaAtStart(buffer: Buffer): boolean {
    // Group 0002 tag at offset 0 (Little Endian): bytes [0]=0x02, [1]=0x00.
    return buffer.length >= 4 && buffer[0] === 0x02 && buffer[1] === 0x00;
  }

  private looksLikeHtml(buffer: Buffer): boolean {
    const head = buffer.subarray(0, Math.min(buffer.length, 256)).toString('ascii').toLowerCase();
    return head.includes('<!doctype html') || head.includes('<html');
  }

  private normalizeDicomPart10(buffer: Buffer): Buffer {
    if (this.hasDicomPart10Prefix(buffer)) return buffer;
    if (!this.hasFileMetaAtStart(buffer)) return buffer;

    // Some exports omit the 128-byte preamble + DICM marker.
    const preamble = Buffer.alloc(132, 0);
    preamble.write('DICM', 128, 'ascii');
    return Buffer.concat([preamble, buffer]);
  }

  constructor(baseUrl: string) {
    // Normalize base URL (remove trailing slash)
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  // ─── Authentication ────────────────────────────────────────────

  /**
   * Set auth state from browser login results.
   * Stores the pre-fetched credentials without making any network calls.
   */
  async setAuthFromBrowserLogin(opts: {
    jsessionId: string;
    username: string;
    serverCookies?: ServerCookie[];
    csrfToken?: string | null;
  }): Promise<void> {
    this.username = opts.username;
    this.jsessionId = opts.jsessionId;
    this.csrfToken = opts.csrfToken ?? null;

    // Write all login cookies to the cookie jar — the single source of truth.
    const cookies = opts.serverCookies ?? [];
    await electronSession.defaultSession.cookies.set({
      url: this.baseUrl,
      name: 'JSESSIONID',
      value: opts.jsessionId,
    });
    for (const c of cookies) {
      if (c.name === 'JSESSIONID') continue;
      try {
        await electronSession.defaultSession.cookies.set({
          url: this.baseUrl,
          name: c.name,
          value: c.value,
          path: c.path,
          secure: c.secure,
          httpOnly: c.httpOnly,
          sameSite: c.sameSite,
        });
      } catch (err) {
        console.warn(`[xnatClient] Failed to set cookie ${c.name}:`, err);
      }
    }

    console.log(
      `[xnatClient] Browser login complete: user=${this.username}, `
      + `${cookies.length + 1} cookies in jar`,
      this.csrfToken ? `csrf=${this.csrfToken.slice(0, 8)}...` : '(no CSRF token)',
    );
  }

  // ─── Session Validation ────────────────────────────────────────

  /**
   * Validate the current session by calling GET /data/JSESSION.
   * Returns the username if valid, null if expired.
   */
  async validateSession(): Promise<string | null> {
    if (!this.jsessionId) return null;

    try {
      const response = await this.xfetch(`${this.baseUrl}/data/JSESSION`, {
        method: 'GET',
      });

      const body = await response.text().catch(() => '');
      if (!response.ok) return null;

      // XNAT returns 200 with an HTML login page instead of 401 when the
      // session has expired. GET /data/JSESSION returns the session ID as
      // plain text when authenticated, so HTML means expired.
      if (this.looksLikeHtml(Buffer.from(body))) return null;

      // If the server returned a different session ID, our authenticated
      // session is gone (e.g., expired during sleep).
      const returnedId = body.trim();
      if (returnedId && returnedId !== this.jsessionId) return null;

      return this.username;
    } catch {
      return null;
    }
  }

  // ─── Disconnect ────────────────────────────────────────────────

  /**
   * Immediately mark this client as disconnected so concurrent in-flight
   * requests stop retrying. Called by sessionManager.handleAuthFailure()
   * before nulling the client reference.
   */
  markDisconnected(): void {
    this._disconnected = true;
  }

  /**
   * Clear auth cookies from the default session's cookie jar and reset
   * local credential state. Does not contact the server.
   * Used by tearDown() for forced expiry where the session is already invalid.
   */
  clearCookies(): void {
    const url = new URL(this.baseUrl);
    electronSession.defaultSession.cookies.get({ domain: url.hostname })
      .then((cookies) => {
        for (const c of cookies) {
          electronSession.defaultSession.cookies.remove(this.baseUrl, c.name).catch(() => {});
        }
      })
      .catch(() => {});

    this.jsessionId = null;
    this.csrfToken = null;
    this.username = '';
  }

  /**
   * Best-effort server-side session invalidation. Does NOT clear local
   * state — that's handled by clearCookies() in sessionManager.tearDown().
   */
  async disconnect(): Promise<void> {
    if (this.jsessionId) {
      try {
        await this.xfetch(`${this.baseUrl}/data/JSESSION`, {
          method: 'DELETE',
        });
      } catch {
        // Ignore — we're disconnecting anyway
      }
    }
    console.log('[xnatClient] Disconnected');
  }

  // ─── Authenticated Requests ────────────────────────────────────

  /**
   * Authenticated fetch via Electron's default session cookie jar.
   * For mutating requests (POST/PUT/PATCH/DELETE), appends the CSRF
   * token as an XNAT_CSRF query parameter.
   */
  private async xfetch(url: string, options?: RequestInit): Promise<Response> {
    const method = (options?.method ?? 'GET').toUpperCase();
    const isMutating = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';

    let fetchUrl = url;
    const fetchOptions: RequestInit = {
      credentials: 'include',
      cache: 'no-store',
      redirect: 'follow',
      ...(options ?? {}),
    };

    if (isMutating && this.csrfToken) {
      const separator = url.includes('?') ? '&' : '?';
      fetchUrl = `${url}${separator}XNAT_CSRF=${encodeURIComponent(this.csrfToken)}`;
    } else if (isMutating) {
      // Fallback: XNAT's XnatSecureGuard skips CSRF validation for
      // non-browser User-Agent strings. Use the XNATDesktopClient UA
      // so mutating requests still succeed without a token.
      const headers = new Headers(fetchOptions.headers as HeadersInit ?? {});
      headers.set('User-Agent', 'XNATDesktopClient');
      fetchOptions.headers = headers;
    }

    return electronSession.defaultSession.fetch(fetchUrl, fetchOptions);
  }

  /**
   * Make an authenticated request to an XNAT endpoint.
   * Returns the raw Response for caller to parse.
   */
  async authenticatedFetch(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<Response> {
    if (!this.jsessionId || this._disconnected) throw new XnatAuthError('Not authenticated');

    const url = `${this.baseUrl}${endpoint}`;
    const response = await this.xfetch(url, options);

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      if (response.status === 401) {
        throw new XnatAuthError(`401 ${text}`.trim());
      }
      throw new Error(`XNAT API error: ${response.status} ${text}`.trim());
    }

    // XNAT returns 200 with an HTML login page instead of 401 when the
    // session has expired. Detect this before callers try to parse the
    // response as JSON or DICOM.
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('text/html')) {
      throw new XnatAuthError('Session expired (received HTML login page)');
    }

    return response;
  }

  // ─── XNAT REST API Browse ────────────────────────────────────

  /**
   * Make an authenticated JSON request with format=json appended.
   * Returns null for empty responses — callers use optional chaining.
   */
  private async jsonRequest<T>(endpoint: string): Promise<T | null> {
    const separator = endpoint.includes('?') ? '&' : '?';
    const response = await this.authenticatedFetch(
      `${endpoint}${separator}format=json`,
    );
    const text = await response.text();
    if (!text.trim()) return null;
    return JSON.parse(text) as T;
  }

  /**
   * Get accessible projects.
   */
  async getProjects(): Promise<Array<{
    id: string; name: string; description?: string;
    subjectCount?: number; sessionCount?: number;
  }>> {
    const data = await this.jsonRequest<{ ResultSet: { Result: any[] } }>(
      '/data/projects?accessible=true',
    );
    const results = data?.ResultSet?.Result ?? [];
    return results.map((r: any) => ({
      id: r.ID || r.id,
      name: r.name || r.secondary_ID || r.ID,
      description: r.description,
      subjectCount: r.subjects != null ? parseInt(String(r.subjects), 10) : undefined,
      sessionCount: r.experiments != null ? parseInt(String(r.experiments), 10) : undefined,
    })).sort((a: any, b: any) =>
      (a.name || a.id).toLowerCase().localeCompare((b.name || b.id).toLowerCase()),
    );
  }

  /**
   * Get subjects in a project.
   */
  async getSubjects(projectId: string): Promise<Array<{
    id: string; label: string; projectId: string; sessionCount?: number;
  }>> {
    const data = await this.jsonRequest<{ ResultSet: { Result: any[] } }>(
      `/data/projects/${encodeURIComponent(projectId)}/subjects`,
    );
    const results = data?.ResultSet?.Result ?? [];
    return results.map((r: any) => ({
      id: r.ID || r.id,
      label: r.label || r.subject_label || r.ID,
      projectId,
      sessionCount: r.experiments != null ? parseInt(String(r.experiments), 10) : undefined,
    })).sort((a: any, b: any) =>
      (a.label || a.id).toLowerCase().localeCompare((b.label || b.id).toLowerCase()),
    );
  }

  /**
   * Get all sessions (experiments) for a project with subject and modality info.
   * Used to build per-subject modality breakdowns without N+1 queries.
   */
  async getProjectSessions(projectId: string): Promise<Array<{
    subjectId: string; modality: string;
  }>> {
    const data = await this.jsonRequest<{ ResultSet: { Result: any[] } }>(
      `/data/projects/${encodeURIComponent(projectId)}/experiments?format=json`,
    );
    const results = data?.ResultSet?.Result ?? [];
    return results
      .filter((r: any) => r.xsiType && /SessionData/i.test(r.xsiType))
      .map((r: any) => {
        let modality = r.modality;
        if (!modality && r.xsiType) {
          const match = r.xsiType.match(/xnat:(\w+)SessionData/i);
          if (match) modality = match[1].toUpperCase();
        }
        return {
          subjectId: r.subject_ID || r.xnat_subjectdata_subject_id || '',
          modality: modality || '',
        };
      })
      .filter((r: { subjectId: string; modality: string }) => r.subjectId && r.modality);
  }

  /**
   * Get sessions (experiments) for a subject in a project.
   */
  async getSessions(projectId: string, subjectId: string): Promise<Array<{
    id: string; label: string; projectId: string; subjectId: string;
    modality?: string; date?: string; scanCount?: number;
  }>> {
    const data = await this.jsonRequest<{ ResultSet: { Result: any[] } }>(
      `/data/projects/${encodeURIComponent(projectId)}/subjects/${encodeURIComponent(subjectId)}/experiments`,
    );
    const results = data?.ResultSet?.Result ?? [];
    // Only include imaging sessions (xsiType contains "SessionData").
    // This filters out non-imaging experiments like assessors, demographics, etc.
    const imagingSessions = results.filter((r: any) =>
      r.xsiType && /SessionData/i.test(r.xsiType),
    );
    return imagingSessions.map((r: any) => {
      let modality = r.modality;
      if (!modality && r.xsiType) {
        const match = r.xsiType.match(/xnat:(\w+)SessionData/i);
        if (match) modality = match[1].toUpperCase();
      }
      return {
        id: r.ID || r.id,
        label: r.label || r.session_label || r.ID,
        projectId,
        subjectId,
        modality,
        date: r.date,
        scanCount: r.scans != null ? parseInt(String(r.scans), 10) : undefined,
      };
    });
  }

  /**
   * Get scans in a session.
   */
  async getScans(
    sessionId: string,
    options?: { includeSopClassUID?: boolean },
  ): Promise<Array<{
    id: string; xsiType?: string; type?: string; seriesDescription?: string;
    quality?: string; frames?: number; modality?: string; sopClassUID?: string;
  }>> {
    const includeSopClassUID = options?.includeSopClassUID === true;
    const data = await this.jsonRequest<any>(
      `/data/experiments/${encodeURIComponent(sessionId)}/scans`,
    );
    const results = data?.ResultSet?.Result ?? data?.items ?? [];
    return Promise.all(results.map(async (r: any) => {
      const fields = r.data_fields || r;
      let modality = fields.modality;
      if (!modality && fields.xsiType) {
        const match = fields.xsiType.match(/xnat:(\w+)ScanData/i);
        if (match) modality = match[1].toUpperCase();
      }
      const rawScanId = fields.ID || fields.id;
      const scanId = rawScanId != null ? String(rawScanId) : '';
      const sopClassUID =
        includeSopClassUID && scanId
          ? await this.getScanSopClassUid(sessionId, scanId).catch(() => undefined)
          : undefined;
      return {
        id: scanId,
        xsiType: fields.xsiType,
        type: fields.type,
        seriesDescription: fields.series_description,
        quality: fields.quality,
        frames: fields.frames ? parseInt(String(fields.frames), 10) : undefined,
        modality,
        sopClassUID,
      };
    }));
  }

  private scanCacheKey(sessionId: string, scanId: string): string {
    return `${sessionId}/${scanId}`;
  }

  private parseSopClassUidFromDicom(arrayBuffer: ArrayBuffer): string | undefined {
    const file = (dcmjsData as any).DicomMessage.readFile(arrayBuffer);
    const naturalized = (dcmjsData as any).DicomMetaDictionary.naturalizeDataset(file.dict);
    const uid = naturalized?.SOPClassUID
      ?? file?.dict?.x00080016?.Value?.[0]
      ?? file?.dict?.['x00080016']?.Value?.[0];
    return typeof uid === 'string' && uid.length > 0 ? uid : undefined;
  }

  private async getScanFilesFromAllResources(sessionId: string, scanId: string): Promise<string[]> {
    const resourcesEndpoint =
      `/data/experiments/${encodeURIComponent(sessionId)}/scans/${encodeURIComponent(scanId)}/resources`;
    const resourcesData = await this.jsonRequest<{ ResultSet: { Result: any[] } }>(resourcesEndpoint);
    const resources = resourcesData?.ResultSet?.Result ?? [];

    const uris: string[] = [];
    for (const resource of resources) {
      const baseUri = resource.URI as string | undefined;
      const resourceLabel =
        (resource.label as string | undefined) ??
        (resource.xnat_abstractresource_id as string | undefined);
      const filesEndpoint = baseUri
        ? `${baseUri}/files`
        : `${resourcesEndpoint}/${encodeURIComponent(resourceLabel ?? '')}/files`;
      if (!filesEndpoint.includes('/files')) continue;

      try {
        const filesData = await this.jsonRequest<{ ResultSet: { Result: any[] } }>(filesEndpoint);
        const results = filesData?.ResultSet?.Result ?? [];
        for (const f of results) {
          const uri = f.URI as string | undefined;
          const name = String(f.Name ?? '').toLowerCase();
          if (!uri) continue;
          if (name.endsWith('.dcm') || !name.includes('.')) {
            uris.push(uri);
          }
        }
      } catch {
        // Skip resource-level failures and continue.
      }
    }

    // Dedupe while preserving order.
    return [...new Set(uris)];
  }

  /**
   * Resolve SOPClassUID for a scan by reading DICOM metadata from its files.
   * Cached per session/scan to avoid repeated network and parse work.
   */
  private async getScanSopClassUid(sessionId: string, scanId: string): Promise<string | undefined> {
    const key = this.scanCacheKey(sessionId, scanId);
    if (this.scanSopClassUidCache.has(key)) {
      return this.scanSopClassUidCache.get(key) ?? undefined;
    }

    try {
      let fileUris = await this.getScanFiles(sessionId, scanId);
      if (fileUris.length === 0) {
        fileUris = await this.getScanFilesFromAllResources(sessionId, scanId);
      }
      // SOPClassUID is series-level; sampling the first 1-2 files is typically sufficient.
      const candidateUris = fileUris.slice(0, 2);
      for (const uri of candidateUris) {
        try {
          const response = await this.authenticatedFetch(uri);
          const arrayBuffer = await response.arrayBuffer();
          const sopClassUID = this.parseSopClassUidFromDicom(arrayBuffer);
          if (sopClassUID) {
            this.scanSopClassUidCache.set(key, sopClassUID);
            return sopClassUID;
          }
        } catch {
          // Try the next file in this scan.
        }
      }
    } catch {
      // Leave unresolved and cache as null below.
    }

    this.scanSopClassUidCache.set(key, null);
    return undefined;
  }

  /**
   * Resolve canonical experiment routing fields from XNAT.
   * This avoids trusting renderer-provided project/subject IDs for writes.
   */
  private async getExperimentRouting(sessionId: string): Promise<{
    experimentId: string;
    projectId: string;
    subjectId: string;
    sessionLabel?: string;
  }> {
    const data = await this.jsonRequest<any>(
      `/data/experiments/${encodeURIComponent(sessionId)}`,
    );
    const row =
      data?.items?.[0]?.data_fields ??
      data?.ResultSet?.Result?.[0] ??
      data;

    const experimentId = row?.ID || row?.id || sessionId;
    const projectId =
      row?.project ||
      row?.project_id ||
      row?.xnat_experimentdata_project ||
      '';
    const subjectId =
      row?.subject_ID ||
      row?.subject_id ||
      row?.xnat_experimentdata_subject_id ||
      '';
    const sessionLabel = row?.label || row?.session_label;

    if (!projectId || !subjectId) {
      throw new Error(
        `Failed to resolve canonical routing for experiment ${sessionId} (project/subject missing)`,
      );
    }

    return { experimentId, projectId, subjectId, sessionLabel };
  }

  /**
   * Get DICOM file URIs for a scan.
   * Returns paths relative to the XNAT base URL that can be used as wadouri: sources.
   */
  async getScanFiles(sessionId: string, scanId: string): Promise<string[]> {
    const endpoint = `/data/experiments/${encodeURIComponent(sessionId)}/scans/${encodeURIComponent(scanId)}/files`;
    console.log(`[xnatClient] getScanFiles: ${endpoint}`);

    const data = await this.jsonRequest<{ ResultSet: { Result: any[] } }>(endpoint);
    const results = data?.ResultSet?.Result ?? [];
    console.log(`[xnatClient] getScanFiles: ${results.length} total files returned`);

    if (results.length > 0) {
      console.log('[xnatClient] getScanFiles: sample file entry:', JSON.stringify(results[0]));
    }

    // Filter to DICOM files only. Do not impose filename-based ordering here;
    // downstream consumers should choose metadata-based stack ordering.
    let dicomFiles = results.filter((f: any) => this.isDicomFileEntry(f));

    // Compatibility fallback: if XNAT returns exactly one file with weak metadata,
    // keep behavior permissive so we can still attempt the download path.
    if (dicomFiles.length === 0 && results.length === 1) {
      console.warn('[xnatClient] getScanFiles: no explicit DICOM markers, falling back to single-file scan');
      dicomFiles = results;
    }

    console.log(`[xnatClient] getScanFiles: ${dicomFiles.length} DICOM files after filtering`);

    // Return the URI paths — these are relative to the XNAT base URL
    const uris = dicomFiles.map((f: any) => f.URI as string);
    if (uris.length > 0) {
      console.log('[xnatClient] getScanFiles: first URI:', uris[0]);
    }
    return uris;
  }

  // ─── Download ─────────────────────────────────────────────────

  /**
   * Download the raw DICOM file(s) from a scan's DICOM resource.
   * Returns the first file as a Buffer (SEG scans typically have one file).
   */
  async downloadScanFile(sessionId: string, scanId: string): Promise<Buffer> {
    const fileUris = await this.getScanFiles(sessionId, scanId);
    if (fileUris.length === 0) {
      throw new Error(`No DICOM files found in scan ${scanId}`);
    }

    let lastReason = '';
    for (const uri of fileUris) {
      console.log(`[xnatClient] Downloading scan file: ${uri}`);
      const response = await this.authenticatedFetch(uri);
      const rawBuffer = Buffer.from(await response.arrayBuffer());
      const buffer = this.normalizeDicomPart10(rawBuffer);

      if (this.hasDicomPart10Prefix(buffer)) {
        if (buffer.length !== rawBuffer.length) {
          console.warn(
            `[xnatClient] Added missing DICOM preamble for scan ${scanId} file ${uri} `
            + `(${rawBuffer.length} -> ${buffer.length} bytes)`,
          );
        }
        return buffer;
      }

      if (this.looksLikeHtml(rawBuffer)) {
        lastReason = `Received HTML instead of DICOM from ${uri}`;
      } else {
        const headHex = rawBuffer.subarray(0, Math.min(rawBuffer.length, 8)).toString('hex');
        lastReason = `Invalid DICOM prefix from ${uri} (first bytes: ${headHex || 'empty'})`;
      }
      console.warn(`[xnatClient] Skipping non-DICOM scan file candidate: ${lastReason}`);
    }

    throw new Error(
      `No valid DICOM Part 10 file found in scan ${scanId}. ${lastReason || 'All candidates failed.'}`,
    );
  }

  // ─── Upload ───────────────────────────────────────────────────

  /**
   * Ask XNAT to re-extract experiment/scan metadata from archived DICOM headers.
   * This makes scan-level DICOM attributes visible in the XNAT UI after manual
   * resource uploads that bypass the normal session importer flow.
   */
  private async pullDataFromHeaders(sessionId: string): Promise<void> {
    // Temporarily disabled per product request while server-side behavior is investigated.
    void sessionId;
  }

  /**
   * Stamp upload metadata in the DICOM header.
   * - SeriesNumber is always aligned to target XNAT scan ID.
   * - SeriesDescription is optionally set from annotation label.
   */
  private withUploadMetadata(
    dicomBuffer: Buffer,
    scanId: string,
    seriesDescription?: string,
  ): Buffer {
    if (!/^\d+$/.test(scanId)) {
      throw new Error(`Cannot stamp SeriesNumber from non-numeric scan ID: ${scanId}`);
    }
    const parsedSeriesNumber = parseInt(scanId, 10);
    const normalizedSeriesDescription = seriesDescription?.trim();

    try {
      const file = (dcmjsData as any).DicomMessage.readFile(
        dicomBuffer.buffer.slice(
          dicomBuffer.byteOffset,
          dicomBuffer.byteOffset + dicomBuffer.byteLength,
        ),
      );

      const naturalized = (dcmjsData as any).DicomMetaDictionary.naturalizeDataset(file.dict);
      const naturalizedMeta = (dcmjsData as any).DicomMetaDictionary.naturalizeDataset(file.meta);
      naturalized.SeriesNumber = parsedSeriesNumber;
      if (normalizedSeriesDescription) {
        naturalized.SeriesDescription = normalizedSeriesDescription;
      }
      naturalized._meta = naturalizedMeta;

      const denaturalizedMeta = (dcmjsData as any).DicomMetaDictionary.denaturalizeDataset(naturalizedMeta);
      delete naturalized._meta;
      const denaturalizedDict = (dcmjsData as any).DicomMetaDictionary.denaturalizeDataset(naturalized);

      const dict = new (dcmjsData as any).DicomDict(denaturalizedMeta);
      dict.dict = denaturalizedDict;
      const arrayBuffer = dict.write();
      return Buffer.from(new Uint8Array(arrayBuffer));
    } catch (err) {
      throw new Error(
        `[xnatClient] Failed to stamp SeriesNumber=${scanId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async resolveUploadRouting(
    projectId: string,
    subjectId: string,
    sessionId: string,
    sessionLabel: string,
    kind: 'SEG' | 'RTSTRUCT',
  ): Promise<{
    targetSessionId: string;
    targetSessionLabel: string;
    targetProjectId: string;
    targetSubjectId: string;
  }> {
    const routing = await this.getExperimentRouting(sessionId);
    const targetSessionId = routing.experimentId || sessionId;
    const targetSessionLabel = routing.sessionLabel || sessionLabel || targetSessionId;
    const targetProjectId = routing.projectId || projectId;
    const targetSubjectId = routing.subjectId || subjectId;
    if (targetProjectId !== projectId || targetSubjectId !== subjectId) {
      console.warn(
        `[xnatClient] ${kind} upload routing override from experiment ${sessionId}: `
        + `project ${projectId} -> ${targetProjectId}, subject ${subjectId} -> ${targetSubjectId}`,
      );
    }
    return { targetSessionId, targetSessionLabel, targetProjectId, targetSubjectId };
  }

  private async findNextDerivedScanId(
    sessionId: string,
    sourceScanId: string,
    kind: 'SEG' | 'RTSTRUCT',
  ): Promise<string> {
    const existingScans = await this.getScans(sessionId);
    const existingScanIds = new Set(existingScans.map((s) => s.id));
    const srcNum = parseInt(sourceScanId, 10);
    const suffix = Number.isNaN(srcNum)
      ? sourceScanId
      : String(srcNum).padStart(2, '0');
    const prefixStart = kind === 'SEG' ? 30 : 40;

    for (let prefix = prefixStart; prefix < 100; prefix++) {
      const candidate = `${prefix}${suffix}`;
      if (!existingScanIds.has(candidate)) {
        return candidate;
      }
    }
    throw new Error(`Could not find unused ${kind} scan number for source scan ${sourceScanId}`);
  }

  /**
   * Build DICOM bytes exactly as upload would store them (including SeriesNumber stamping).
   * If targetScanId is provided, that scan ID is used directly (overwrite path).
   */
  async prepareDicomForUpload(
    kind: 'SEG' | 'RTSTRUCT',
    projectId: string,
    subjectId: string,
    sessionId: string,
    sessionLabel: string,
    sourceScanId: string,
    dicomBuffer: Buffer,
    targetScanId?: string,
    seriesDescription?: string,
  ): Promise<{ scanId: string; dicomBuffer: Buffer }> {
    if (!this.jsessionId || this._disconnected) throw new XnatAuthError('Not authenticated');

    let resolvedScanId = targetScanId;
    if (!resolvedScanId) {
      const routing = await this.resolveUploadRouting(projectId, subjectId, sessionId, sessionLabel, kind);
      resolvedScanId = await this.findNextDerivedScanId(
        routing.targetSessionId,
        sourceScanId,
        kind,
      );
    }

    return {
      scanId: resolvedScanId,
      dicomBuffer: this.withUploadMetadata(dicomBuffer, resolvedScanId, seriesDescription),
    };
  }

  /**
   * Upload a DICOM SEG file to an XNAT session as a new scan.
   */
  async uploadDicomSegAsScan(
    projectId: string,
    subjectId: string,
    sessionId: string,
    sessionLabel: string,
    sourceScanId: string,
    dicomBuffer: Buffer,
    seriesDescription: string = 'Segmentation',
  ): Promise<{ url: string; scanId: string }> {
    if (!this.jsessionId || this._disconnected) throw new XnatAuthError('Not authenticated');
    const { targetSessionId, targetSessionLabel, targetProjectId, targetSubjectId } =
      await this.resolveUploadRouting(projectId, subjectId, sessionId, sessionLabel, 'SEG');
    const targetScanId = await this.findNextDerivedScanId(targetSessionId, sourceScanId, 'SEG');
    const prepared = await this.prepareDicomForUpload(
      'SEG',
      projectId,
      subjectId,
      sessionId,
      sessionLabel,
      sourceScanId,
      dicomBuffer,
      targetScanId,
      seriesDescription,
    );
    const dicomWithScanNumber = prepared.dicomBuffer;

    console.log(
      `[xnatClient] Uploading DICOM SEG as scan ${targetScanId}`,
      `(experiment: ${targetSessionId}, source scan: ${sourceScanId}, ${(dicomBuffer.length / 1024).toFixed(1)} KB)`,
      seriesDescription ? `label: "${seriesDescription}"` : '',
    );

    const basePath = `/data/projects/${encodeURIComponent(targetProjectId)}`
      + `/subjects/${encodeURIComponent(targetSubjectId)}`
      + `/experiments/${encodeURIComponent(targetSessionLabel)}`
      + `/scans/${encodeURIComponent(targetScanId)}`;

    const createParams = new URLSearchParams({
      xsiType: 'xnat:segScanData',
      'xnat:segScanData/type': 'SEG',
      'xnat:segScanData/series_description': seriesDescription,
    });
    const createUrl = `${this.baseUrl}${basePath}?${createParams.toString()}`;
    const createResp = await this.xfetch(createUrl, {
      method: 'PUT',
    });
    if (!createResp.ok) {
      const text = await createResp.text().catch(() => '');
      if (createResp.status === 403) {
        throw new Error('Permission denied: you do not have write access to this project');
      }
      throw new Error(`Failed to create SEG scan ${targetScanId}: ${createResp.status} ${text}`.trim());
    }

    const fileUrl = `${this.baseUrl}${basePath}/resources/DICOM/files/segmentation.dcm?format=DICOM&content=SEG`;
    const fileResp = await this.xfetch(fileUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/dicom',
      },
      body: new Uint8Array(dicomWithScanNumber),
    });
    if (!fileResp.ok) {
      const text = await fileResp.text().catch(() => '');
      throw new Error(`Failed to upload SEG file to scan ${targetScanId}: ${fileResp.status} ${text}`.trim());
    }

    try {
      await this.pullDataFromHeaders(targetSessionId);
    } catch (err) {
      console.warn(
        `[xnatClient] SEG upload succeeded but pullDataFromHeaders failed for ${targetSessionId}:`,
        err,
      );
    }

    const scanUrl = `${this.baseUrl}/data/experiments/${encodeURIComponent(targetSessionId)}/scans/${encodeURIComponent(targetScanId)}`;
    return { url: scanUrl, scanId: targetScanId };
  }

  /**
   * Upload a DICOM RTSTRUCT file to an XNAT session as a new scan.
   */
  async uploadDicomRtStructAsScan(
    projectId: string,
    subjectId: string,
    sessionId: string,
    sessionLabel: string,
    sourceScanId: string,
    dicomBuffer: Buffer,
    seriesDescription: string = 'RT Structure Set',
  ): Promise<{ url: string; scanId: string }> {
    if (!this.jsessionId || this._disconnected) throw new XnatAuthError('Not authenticated');
    const { targetSessionId, targetSessionLabel, targetProjectId, targetSubjectId } =
      await this.resolveUploadRouting(projectId, subjectId, sessionId, sessionLabel, 'RTSTRUCT');
    const targetScanId = await this.findNextDerivedScanId(targetSessionId, sourceScanId, 'RTSTRUCT');
    const prepared = await this.prepareDicomForUpload(
      'RTSTRUCT',
      projectId,
      subjectId,
      sessionId,
      sessionLabel,
      sourceScanId,
      dicomBuffer,
      targetScanId,
      seriesDescription,
    );
    const dicomWithScanNumber = prepared.dicomBuffer;

    console.log(
      `[xnatClient] Uploading DICOM RTSTRUCT as scan ${targetScanId}`,
      `(experiment: ${targetSessionId}, source scan: ${sourceScanId}, ${(dicomBuffer.length / 1024).toFixed(1)} KB)`,
      seriesDescription ? `label: "${seriesDescription}"` : '',
    );

    const basePath = `/data/projects/${encodeURIComponent(targetProjectId)}`
      + `/subjects/${encodeURIComponent(targetSubjectId)}`
      + `/experiments/${encodeURIComponent(targetSessionLabel)}`
      + `/scans/${encodeURIComponent(targetScanId)}`;

    const createParams = new URLSearchParams({
      xsiType: 'xnat:rtImageScanData',
      'xnat:rtImageScanData/type': 'RTSTRUCT',
      'xnat:rtImageScanData/series_description': seriesDescription,
    });
    const createUrl = `${this.baseUrl}${basePath}?${createParams.toString()}`;
    const createResp = await this.xfetch(createUrl, {
      method: 'PUT',
    });
    if (!createResp.ok) {
      const text = await createResp.text().catch(() => '');
      if (createResp.status === 403) {
        throw new Error('Permission denied: you do not have write access to this project');
      }
      throw new Error(`Failed to create RTSTRUCT scan ${targetScanId}: ${createResp.status} ${text}`.trim());
    }

    const fileUrl = `${this.baseUrl}${basePath}/resources/DICOM/files/rtstruct.dcm?format=DICOM&content=RTSTRUCT`;
    const fileResp = await this.xfetch(fileUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/dicom',
      },
      body: new Uint8Array(dicomWithScanNumber),
    });
    if (!fileResp.ok) {
      const text = await fileResp.text().catch(() => '');
      throw new Error(`Failed to upload RTSTRUCT file to scan ${targetScanId}: ${fileResp.status} ${text}`.trim());
    }

    try {
      await this.pullDataFromHeaders(targetSessionId);
    } catch (err) {
      console.warn(
        `[xnatClient] RTSTRUCT upload succeeded but pullDataFromHeaders failed for ${targetSessionId}:`,
        err,
      );
    }

    const scanUrl = `${this.baseUrl}/data/experiments/${encodeURIComponent(targetSessionId)}/scans/${encodeURIComponent(targetScanId)}`;
    return { url: scanUrl, scanId: targetScanId };
  }

  // ─── Overwrite Existing Scan ─────────────────────────────────────

  /**
   * Overwrite the DICOM SEG file within an existing scan.
   * Deletes old files and uploads new content to the same scan ID.
   */
  async overwriteDicomSegInScan(
    sessionId: string,
    targetScanId: string,
    dicomBuffer: Buffer,
    seriesDescription?: string,
  ): Promise<{ url: string; scanId: string }> {
    if (!this.jsessionId || this._disconnected) throw new XnatAuthError('Not authenticated');

    console.log(
      `[xnatClient] Overwriting DICOM SEG in scan ${targetScanId}`,
      `(${(dicomBuffer.length / 1024).toFixed(1)} KB)`,
    );

    const basePath = `/data/experiments/${encodeURIComponent(sessionId)}`
      + `/scans/${encodeURIComponent(targetScanId)}`;

    // Delete existing files in the scan's DICOM resource
    const deleteUrl = `${this.baseUrl}${basePath}/resources/DICOM/files`;
    const deleteResp = await this.xfetch(deleteUrl, {
      method: 'DELETE',
    });
    if (!deleteResp.ok && deleteResp.status !== 404) {
      console.warn(`[xnatClient] Overwrite: could not delete old files (${deleteResp.status}), continuing`);
    }

    // Upload the new DICOM file
    const dicomWithScanNumber = this.withUploadMetadata(dicomBuffer, targetScanId, seriesDescription);
    const fileUrl = `${this.baseUrl}${basePath}/resources/DICOM/files/segmentation.dcm?format=DICOM&content=SEG`;
    const fileResp = await this.xfetch(fileUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/dicom',
      },
      body: new Uint8Array(dicomWithScanNumber),
    });

    if (!fileResp.ok) {
      const text = await fileResp.text().catch(() => '');
      throw new Error(`Failed to overwrite SEG in scan ${targetScanId}: ${fileResp.status} ${text}`.trim());
    }

    // Best-effort metadata refresh so DICOM-derived scan attributes are repopulated in XNAT.
    try {
      await this.pullDataFromHeaders(sessionId);
    } catch (err) {
      console.warn(
        `[xnatClient] SEG overwrite succeeded but pullDataFromHeaders failed for session ${sessionId}:`,
        err,
      );
    }

    const scanUrl = `${this.baseUrl}${basePath}`;
    console.log(`[xnatClient] Overwrite successful: ${scanUrl}`);
    return { url: scanUrl, scanId: targetScanId };
  }

  /**
   * Overwrite the DICOM RTSTRUCT file within an existing scan.
   * Deletes old files and uploads new content to the same scan ID.
   */
  async overwriteDicomRtStructInScan(
    sessionId: string,
    targetScanId: string,
    dicomBuffer: Buffer,
    seriesDescription?: string,
  ): Promise<{ url: string; scanId: string }> {
    if (!this.jsessionId || this._disconnected) throw new XnatAuthError('Not authenticated');

    console.log(
      `[xnatClient] Overwriting DICOM RTSTRUCT in scan ${targetScanId}`,
      `(${(dicomBuffer.length / 1024).toFixed(1)} KB)`,
    );

    const basePath = `/data/experiments/${encodeURIComponent(sessionId)}`
      + `/scans/${encodeURIComponent(targetScanId)}`;

    const deleteUrl = `${this.baseUrl}${basePath}/resources/DICOM/files`;
    const deleteResp = await this.xfetch(deleteUrl, {
      method: 'DELETE',
    });
    if (!deleteResp.ok && deleteResp.status !== 404) {
      console.warn(`[xnatClient] RTSTRUCT overwrite: could not delete old files (${deleteResp.status}), continuing`);
    }

    const dicomWithScanNumber = this.withUploadMetadata(dicomBuffer, targetScanId, seriesDescription);
    const fileUrl = `${this.baseUrl}${basePath}/resources/DICOM/files/rtstruct.dcm?format=DICOM&content=RTSTRUCT`;
    const fileResp = await this.xfetch(fileUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/dicom',
      },
      body: new Uint8Array(dicomWithScanNumber),
    });

    if (!fileResp.ok) {
      const text = await fileResp.text().catch(() => '');
      throw new Error(`Failed to overwrite RTSTRUCT in scan ${targetScanId}: ${fileResp.status} ${text}`.trim());
    }

    try {
      await this.pullDataFromHeaders(sessionId);
    } catch (err) {
      console.warn(
        `[xnatClient] RTSTRUCT overwrite succeeded but pullDataFromHeaders failed for session ${sessionId}:`,
        err,
      );
    }

    const scanUrl = `${this.baseUrl}${basePath}`;
    console.log(`[xnatClient] RTSTRUCT overwrite successful: ${scanUrl}`);
    return { url: scanUrl, scanId: targetScanId };
  }

  // ─── Temp Resource (Session-Level Auto-Save) ──────────────────────

  /**
   * Auto-save a DICOM SEG to the session-level "temp" resource folder.
   * Filename: autosave_seg_{sourceScanId}.dcm
   * XNAT auto-creates the "temp" resource on first PUT.
   */
  async autoSaveToTemp(
    sessionId: string,
    sourceScanId: string,
    dicomBuffer: Buffer,
    customFilename?: string,
  ): Promise<{ url: string }> {
    if (!this.jsessionId || this._disconnected) throw new XnatAuthError('Not authenticated');

    const filename = customFilename ?? `autosave_seg_${sourceScanId}.dcm`;
    console.log(
      `[xnatClient] Auto-saving to temp resource: ${filename}`,
      `(${(dicomBuffer.length / 1024).toFixed(1)} KB)`,
    );

    const fileUrl = `${this.baseUrl}/data/experiments/${encodeURIComponent(sessionId)}`
      + `/resources/temp/files/${encodeURIComponent(filename)}`
      + `?format=DICOM&content=SEG&overwrite=true`;

    const resp = await this.xfetch(fileUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/dicom',
      },
      body: new Uint8Array(dicomBuffer),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      if (resp.status === 403) {
        throw new Error('Permission denied: you do not have write access to this session');
      }
      throw new Error(`Failed to auto-save to temp: ${resp.status} ${text}`.trim());
    }

    console.log(`[xnatClient] Auto-save to temp successful: ${filename}`);
    return { url: fileUrl };
  }

  /**
   * List files in the session-level "temp" resource.
   * Returns empty array if the resource does not exist.
   */
  async listTempFiles(
    sessionId: string,
  ): Promise<Array<{ name: string; uri: string; size: number }>> {
    if (!this.jsessionId || this._disconnected) throw new XnatAuthError('Not authenticated');

    const url = `${this.baseUrl}/data/experiments/${encodeURIComponent(sessionId)}`
      + `/resources/temp/files?format=json`;

    const resp = await this.xfetch(url, {
      method: 'GET',
    });

    if (resp.status === 404) {
      // Resource doesn't exist yet — no temp files
      return [];
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Failed to list temp files: ${resp.status} ${text}`.trim());
    }

    const data = await resp.json();
    const results = data?.ResultSet?.Result ?? [];
    return results.map((r: any) => ({
      name: r.Name,
      uri: r.URI,
      size: parseInt(r.Size, 10) || 0,
    }));
  }

  /**
   * Delete a specific file from the session-level "temp" resource.
   */
  async deleteTempFile(
    sessionId: string,
    filename: string,
  ): Promise<void> {
    if (!this.jsessionId || this._disconnected) throw new XnatAuthError('Not authenticated');

    const url = `${this.baseUrl}/data/experiments/${encodeURIComponent(sessionId)}`
      + `/resources/temp/files/${encodeURIComponent(filename)}`;

    const resp = await this.xfetch(url, {
      method: 'DELETE',
    });

    if (!resp.ok && resp.status !== 404) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Failed to delete temp file ${filename}: ${resp.status} ${text}`.trim());
    }

    console.log(`[xnatClient] Deleted temp file: ${filename}`);
  }

  /**
   * Download a file from the session-level "temp" resource.
   */
  async downloadTempFile(
    sessionId: string,
    filename: string,
  ): Promise<Buffer> {
    if (!this.jsessionId || this._disconnected) throw new XnatAuthError('Not authenticated');

    const url = `${this.baseUrl}/data/experiments/${encodeURIComponent(sessionId)}`
      + `/resources/temp/files/${encodeURIComponent(filename)}`;

    const resp = await this.xfetch(url, {
      method: 'GET',
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Failed to download temp file ${filename}: ${resp.status} ${text}`.trim());
    }

    const arrayBuffer = await resp.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  // ─── Getters ───────────────────────────────────────────────────

  get isAuthenticated(): boolean {
    return this.jsessionId !== null;
  }

  get serverUrl(): string {
    return this.baseUrl;
  }

  get currentUsername(): string {
    return this.username;
  }
}
