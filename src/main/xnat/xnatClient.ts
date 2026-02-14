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
  /** JSESSION cookie — used for all XNAT API requests */
  private jsessionId: string | null = null;
  /** All server cookies (JSESSIONID, ALB sticky-session, etc.) */
  private serverCookies: ServerCookie[] = [];
  /** Set by markDisconnected() to stop concurrent in-flight requests from retrying */
  private _disconnected = false;

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
  }): Promise<void> {
    this.username = opts.username;
    this.serverCookies = opts.serverCookies ?? [];
    await this.setAllCookies(opts.jsessionId, this.serverCookies);
    console.log(`[xnatClient] Browser login complete: user=${this.username}`);
  }

  /**
   * Sync all server cookies to the default session's cookie jar.
   * Includes JSESSIONID plus any infrastructure cookies (e.g. AWSALB
   * sticky-session cookies for load-balanced XNAT servers).
   * Must be awaited before making API calls.
   */
  private async setAllCookies(jsessionId: string, cookies: ServerCookie[]): Promise<void> {
    this.jsessionId = jsessionId;

    // Always set JSESSIONID
    await electronSession.defaultSession.cookies.set({
      url: this.baseUrl,
      name: 'JSESSIONID',
      value: jsessionId,
    });

    // Set all other server cookies (ALB sticky-session, XNAT session state, etc.)
    for (const c of cookies) {
      if (c.name === 'JSESSIONID') continue; // already set above
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
    console.log(`[xnatClient] Set ${cookies.length + 1} cookies in default session`);
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

      // Drain the response body to release the connection
      await response.text().catch(() => {});
      return response.ok ? this.username : null;
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
    for (const c of this.serverCookies) {
      electronSession.defaultSession.cookies.remove(this.baseUrl, c.name).catch(() => {});
    }
    electronSession.defaultSession.cookies.remove(this.baseUrl, 'JSESSIONID').catch(() => {});

    this.jsessionId = null;
    this.serverCookies = [];
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
   * Build auth headers for XNAT requests.
   * Includes JSESSIONID plus any infrastructure cookies (ALB sticky-session, etc.).
   * Used by the webRequest interceptor in sessionManager for renderer requests.
   */
  buildAuthHeaders(): Record<string, string> {
    if (!this.jsessionId) throw new XnatAuthError('Not authenticated');
    const parts = [`JSESSIONID=${this.jsessionId}`];
    for (const c of this.serverCookies) {
      if (c.name === 'JSESSIONID') continue;
      parts.push(`${c.name}=${c.value}`);
    }
    return { Cookie: parts.join('; ') };
  }

  /**
   * Wrapper around session.fetch that uses the default session's
   * cookie jar. session.fetch() automatically sends cookies for the
   * matching domain.
   */
  private xfetch(url: string, options?: RequestInit): Promise<Response> {
    return electronSession.defaultSession.fetch(url, options);
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
    // JSESSIONID cookie is provided by the default session's cookie jar.
    const response = await this.xfetch(url, options);

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      if (response.status === 401) {
        throw new XnatAuthError(`401 ${text}`.trim());
      }
      throw new Error(`XNAT API error: ${response.status} ${text}`.trim());
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
  async getScans(sessionId: string): Promise<Array<{
    id: string; type?: string; seriesDescription?: string;
    quality?: string; frames?: number; modality?: string;
  }>> {
    const data = await this.jsonRequest<any>(
      `/data/experiments/${encodeURIComponent(sessionId)}/scans`,
    );
    const results = data?.ResultSet?.Result ?? data?.items ?? [];
    return results.map((r: any) => {
      const fields = r.data_fields || r;
      let modality = fields.modality;
      if (!modality && fields.xsiType) {
        const match = fields.xsiType.match(/xnat:(\w+)ScanData/i);
        if (match) modality = match[1].toUpperCase();
      }
      return {
        id: fields.ID || fields.id,
        type: fields.type,
        seriesDescription: fields.series_description,
        quality: fields.quality,
        frames: fields.frames ? parseInt(String(fields.frames), 10) : undefined,
        modality,
      };
    });
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

    // Filter to DICOM files only and sort by Name for consistent ordering
    const dicomFiles = results
      .filter((f: any) => {
        const name = (f.Name || '').toLowerCase();
        const collection = (f.collection || '').toLowerCase();
        // Include files from DICOM collection or with .dcm extension
        return collection === 'dicom' || name.endsWith('.dcm') || !name.includes('.');
      })
      .sort((a: any, b: any) =>
        (a.Name || '').localeCompare(b.Name || '', undefined, { numeric: true }),
      );

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

    // Fetch the first DICOM file
    const uri = fileUris[0];
    console.log(`[xnatClient] Downloading scan file: ${uri}`);
    const response = await this.authenticatedFetch(uri);
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  // ─── Upload ───────────────────────────────────────────────────

  /**
   * Upload a DICOM SEG file to an XNAT session as a new scan.
   *
   * We bypass the Session Importer (which routes SEG to assessors based
   * on SOP Class) and instead use the manual scan resource REST API so
   * the SEG appears as a scan on the session — the way it would if sent
   * from PACS.
   *
   * Scan numbering convention: 30xx where xx = source scan number.
   * If 30xx is occupied, try 31xx, 32xx, etc.
   * Example: source scan 4 → try 3004, 3104, 3204, ...
   *
   * Three-step process:
   *  1. Query existing scans to find an unused scan number
   *  2. Create scan with xsiType=xnat:otherDicomScanData
   *  3. Upload DICOM file to the scan's DICOM resource
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

    // ── Step 1: Find unused scan number ──────────────────────────
    const existingScans = await this.getScans(sessionId);
    const existingScanIds = new Set(existingScans.map((s) => s.id));

    // Parse the source scan number (handles numeric and string IDs)
    const srcNum = parseInt(sourceScanId, 10);
    const suffix = isNaN(srcNum)
      ? sourceScanId                          // Non-numeric: use as-is
      : String(srcNum).padStart(2, '0');      // Numeric: zero-pad to 2+ digits

    let targetScanId = '';
    for (let prefix = 30; prefix < 100; prefix++) {
      const candidate = `${prefix}${suffix}`;
      if (!existingScanIds.has(candidate)) {
        targetScanId = candidate;
        break;
      }
    }
    if (!targetScanId) {
      throw new Error(`Could not find unused scan number for source scan ${sourceScanId}`);
    }

    console.log(
      `[xnatClient] Uploading DICOM SEG as scan ${targetScanId}`,
      `(source scan: ${sourceScanId}, ${(dicomBuffer.length / 1024).toFixed(1)} KB)`,
    );

    // Build the base path for scan operations
    const basePath = `/data/projects/${encodeURIComponent(projectId)}`
      + `/subjects/${encodeURIComponent(subjectId)}`
      + `/experiments/${encodeURIComponent(sessionLabel)}`
      + `/scans/${encodeURIComponent(targetScanId)}`;

    // ── Step 2: Create the scan ──────────────────────────────────
    const createParams = new URLSearchParams({
      'xsiType': 'xnat:otherDicomScanData',
      'xnat:otherDicomScanData/type': 'SEG',
      'xnat:otherDicomScanData/series_description': seriesDescription,
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
      throw new Error(`Failed to create scan ${targetScanId}: ${createResp.status} ${text}`.trim());
    }
    console.log(`[xnatClient] Created scan ${targetScanId}`);

    // ── Step 3: Upload DICOM file to scan resource ───────────────
    const fileParams = new URLSearchParams({
      'format': 'DICOM',
      'content': 'SEG',
    });

    const fileUrl = `${this.baseUrl}${basePath}/resources/DICOM/files/segmentation.dcm?${fileParams.toString()}`;
    const fileResp = await this.xfetch(fileUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/dicom',
      },
      body: new Uint8Array(dicomBuffer),
    });

    if (!fileResp.ok) {
      const text = await fileResp.text().catch(() => '');
      throw new Error(`Failed to upload file to scan ${targetScanId}: ${fileResp.status} ${text}`.trim());
    }

    const scanUrl = `${this.baseUrl}${basePath}`;
    console.log(`[xnatClient] Upload successful: ${scanUrl}`);
    return { url: scanUrl, scanId: targetScanId };
  }

  /**
   * Upload a DICOM RTSTRUCT file to an XNAT session as a new scan.
   *
   * Same three-step process as uploadDicomSegAsScan(), but:
   * - Scan numbering convention: 40xx (then 41xx, 42xx, etc.)
   * - xnat:otherDicomScanData/type = 'RTSTRUCT'
   * - series_description = 'RT Structure Set'
   * - filename = rtstruct.dcm
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

    // ── Step 1: Find unused scan number ──────────────────────────
    const existingScans = await this.getScans(sessionId);
    const existingScanIds = new Set(existingScans.map((s) => s.id));

    const srcNum = parseInt(sourceScanId, 10);
    const suffix = isNaN(srcNum)
      ? sourceScanId
      : String(srcNum).padStart(2, '0');

    let targetScanId = '';
    for (let prefix = 40; prefix < 100; prefix++) {
      const candidate = `${prefix}${suffix}`;
      if (!existingScanIds.has(candidate)) {
        targetScanId = candidate;
        break;
      }
    }
    if (!targetScanId) {
      throw new Error(`Could not find unused scan number for source scan ${sourceScanId}`);
    }

    console.log(
      `[xnatClient] Uploading DICOM RTSTRUCT as scan ${targetScanId}`,
      `(source scan: ${sourceScanId}, ${(dicomBuffer.length / 1024).toFixed(1)} KB)`,
    );

    const basePath = `/data/projects/${encodeURIComponent(projectId)}`
      + `/subjects/${encodeURIComponent(subjectId)}`
      + `/experiments/${encodeURIComponent(sessionLabel)}`
      + `/scans/${encodeURIComponent(targetScanId)}`;

    // ── Step 2: Create the scan ──────────────────────────────────
    const createParams = new URLSearchParams({
      'xsiType': 'xnat:otherDicomScanData',
      'xnat:otherDicomScanData/type': 'RTSTRUCT',
      'xnat:otherDicomScanData/series_description': seriesDescription,
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
      throw new Error(`Failed to create scan ${targetScanId}: ${createResp.status} ${text}`.trim());
    }
    console.log(`[xnatClient] Created scan ${targetScanId}`);

    // ── Step 3: Upload DICOM file to scan resource ───────────────
    const fileParams = new URLSearchParams({
      'format': 'DICOM',
      'content': 'RTSTRUCT',
    });

    const fileUrl = `${this.baseUrl}${basePath}/resources/DICOM/files/rtstruct.dcm?${fileParams.toString()}`;
    const fileResp = await this.xfetch(fileUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/dicom',
      },
      body: new Uint8Array(dicomBuffer),
    });

    if (!fileResp.ok) {
      const text = await fileResp.text().catch(() => '');
      throw new Error(`Failed to upload file to scan ${targetScanId}: ${fileResp.status} ${text}`.trim());
    }

    const scanUrl = `${this.baseUrl}${basePath}`;
    console.log(`[xnatClient] RTSTRUCT upload successful: ${scanUrl}`);
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
    const fileUrl = `${this.baseUrl}${basePath}/resources/DICOM/files/segmentation.dcm?format=DICOM&content=SEG`;
    const fileResp = await this.xfetch(fileUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/dicom',
      },
      body: new Uint8Array(dicomBuffer),
    });

    if (!fileResp.ok) {
      const text = await fileResp.text().catch(() => '');
      throw new Error(`Failed to overwrite SEG in scan ${targetScanId}: ${fileResp.status} ${text}`.trim());
    }

    const scanUrl = `${this.baseUrl}${basePath}`;
    console.log(`[xnatClient] Overwrite successful: ${scanUrl}`);
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
