/**
 * XNAT REST API Client
 *
 * Handles authentication (alias tokens with JSESSION fallback),
 * authenticated requests, and token refresh scheduling.
 *
 * Adapted from the reference XNAT Desktop Viewer project.
 * All network operations happen in the main process — credentials
 * never cross the IPC boundary to the renderer.
 */

/** Internal token representation (alias token or JSESSION) */
interface AuthToken {
  type: 'alias' | 'jsession';
  alias: string;   // alias string or "JSESSIONID"
  secret: string;  // alias secret or session ID value
  expiresAt: number; // timestamp in ms
}

export class XnatClient {
  private baseUrl: string;
  private username: string = '';
  private token: AuthToken | null = null;
  private refreshTimeout: NodeJS.Timeout | null = null;

  constructor(baseUrl: string) {
    // Normalize base URL (remove trailing slash)
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  // ─── Authentication ────────────────────────────────────────────

  /**
   * Authenticate with XNAT.
   *
   * Strategy:
   * 1. Try alias token via POST /data/services/tokens/issue
   * 2. If 405, retry with GET (older XNAT / CNDA compatibility)
   * 3. If token endpoint fails (non-401), fall back to JSESSION
   * 4. On 401 at any step → "Invalid username or password"
   */
  async authenticate(username: string, password: string): Promise<void> {
    this.username = username;
    const basicAuth = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

    // --- Try alias token (POST then GET) ---
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/data/services/tokens/issue`, {
        method: 'POST',
        headers: { Authorization: basicAuth },
      });

      if (response.status === 405) {
        // POST not allowed — try GET (common on older XNAT / CNDA)
        console.log('[xnatClient] Token endpoint returned 405 for POST, trying GET');
        response = await fetch(`${this.baseUrl}/data/services/tokens/issue`, {
          method: 'GET',
          headers: { Authorization: basicAuth },
        });
      }
    } catch (err) {
      throw new Error(`Cannot reach XNAT server at ${this.baseUrl}`);
    }

    if (response.ok) {
      // Alias token issued successfully
      const data = (await response.json()) as { alias: string; secret: string };
      this.token = {
        type: 'alias',
        alias: data.alias,
        secret: data.secret,
        expiresAt: Date.now() + 48 * 60 * 60 * 1000, // 48 hours
      };
      this.scheduleRefresh(username, password);
      console.log('[xnatClient] Authenticated with alias token');
      return;
    }

    if (response.status === 401) {
      throw new Error('Invalid username or password');
    }

    // Token endpoint failed for non-auth reason — fall back to JSESSION
    console.log(`[xnatClient] Token endpoint failed (${response.status}), falling back to JSESSION`);
    await this.authenticateWithSession(username, password, basicAuth);
  }

  /**
   * Fallback: authenticate using JSESSIONID cookie.
   */
  private async authenticateWithSession(
    username: string,
    password: string,
    basicAuth: string,
  ): Promise<void> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/data/JSESSION`, {
        method: 'POST',
        headers: { Authorization: basicAuth },
      });
    } catch (err) {
      throw new Error(`Cannot reach XNAT server at ${this.baseUrl}`);
    }

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Invalid username or password');
      }
      const text = await response.text().catch(() => '');
      throw new Error(`Authentication failed: ${response.status} ${text}`.trim());
    }

    const sessionId = (await response.text()).trim();
    this.token = {
      type: 'jsession',
      alias: 'JSESSIONID',
      secret: sessionId,
      expiresAt: Date.now() + 15 * 60 * 1000, // 15 minutes
    };

    this.scheduleRefresh(username, password);
    console.log('[xnatClient] Authenticated with JSESSION');
  }

  // ─── Token Refresh ─────────────────────────────────────────────

  /**
   * Schedule automatic re-authentication before token expiration.
   */
  private scheduleRefresh(username: string, password: string): void {
    this.clearRefresh();
    if (!this.token) return;

    // Refresh early: 13 min for 15-min JSESSION, 47 hours for 48-hour alias
    const refreshIn =
      this.token.type === 'jsession'
        ? 13 * 60 * 1000
        : 47 * 60 * 60 * 1000;

    this.refreshTimeout = setTimeout(async () => {
      try {
        console.log('[xnatClient] Refreshing authentication');
        await this.authenticate(username, password);
      } catch (err) {
        console.error('[xnatClient] Failed to refresh auth:', err);
        // Token will expire — sessionManager will detect via keepalive
      }
    }, refreshIn);
  }

  private clearRefresh(): void {
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
      this.refreshTimeout = null;
    }
  }

  // ─── Session Validation ────────────────────────────────────────

  /**
   * Validate the current session by calling GET /data/JSESSION.
   * Returns the username if valid, null if expired.
   */
  async validateSession(): Promise<string | null> {
    if (!this.token) return null;

    try {
      const response = await fetch(`${this.baseUrl}/data/JSESSION`, {
        method: 'GET',
        headers: this.buildAuthHeaders(),
      });

      if (response.ok) {
        const text = (await response.text()).trim();
        return text || this.username;
      }
      return null;
    } catch {
      return null;
    }
  }

  // ─── Disconnect ────────────────────────────────────────────────

  /**
   * Clean up: invalidate session on server, clear local state.
   */
  async disconnect(): Promise<void> {
    this.clearRefresh();

    if (this.token) {
      // Best-effort: invalidate server session
      try {
        await fetch(`${this.baseUrl}/data/JSESSION`, {
          method: 'DELETE',
          headers: this.buildAuthHeaders(),
        });
      } catch {
        // Ignore — we're disconnecting anyway
      }
    }

    this.token = null;
    this.username = '';
    console.log('[xnatClient] Disconnected');
  }

  // ─── Authenticated Requests ────────────────────────────────────

  /**
   * Build auth headers for the current token type.
   */
  buildAuthHeaders(): Record<string, string> {
    if (!this.token) throw new Error('Not authenticated');

    if (this.token.type === 'jsession') {
      return { Cookie: `JSESSIONID=${this.token.secret}` };
    }
    // Alias token uses Basic auth with alias:secret
    return {
      Authorization: `Basic ${Buffer.from(`${this.token.alias}:${this.token.secret}`).toString('base64')}`,
    };
  }

  /**
   * Make an authenticated request to an XNAT endpoint.
   * Returns the raw Response for caller to parse.
   */
  async authenticatedFetch(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<Response> {
    if (!this.token) throw new Error('Not authenticated');

    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string>),
      ...this.buildAuthHeaders(),
    };

    const response = await fetch(url, { ...options, headers });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`XNAT API error: ${response.status} ${text}`.trim());
    }

    return response;
  }

  // ─── XNAT REST API Browse ────────────────────────────────────

  /**
   * Make an authenticated JSON request with format=json appended.
   */
  private async jsonRequest<T>(endpoint: string): Promise<T> {
    const separator = endpoint.includes('?') ? '&' : '?';
    const response = await this.authenticatedFetch(
      `${endpoint}${separator}format=json`,
    );
    const text = await response.text();
    if (!text.trim()) return {} as T;
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
    if (!this.token) throw new Error('Not authenticated');

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
    const createResp = await fetch(createUrl, {
      method: 'PUT',
      headers: this.buildAuthHeaders(),
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
    const fileResp = await fetch(fileUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/dicom',
        ...this.buildAuthHeaders(),
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
    if (!this.token) throw new Error('Not authenticated');

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
    const createResp = await fetch(createUrl, {
      method: 'PUT',
      headers: this.buildAuthHeaders(),
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
    const fileResp = await fetch(fileUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/dicom',
        ...this.buildAuthHeaders(),
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
    if (!this.token) throw new Error('Not authenticated');

    console.log(
      `[xnatClient] Overwriting DICOM SEG in scan ${targetScanId}`,
      `(${(dicomBuffer.length / 1024).toFixed(1)} KB)`,
    );

    const basePath = `/data/experiments/${encodeURIComponent(sessionId)}`
      + `/scans/${encodeURIComponent(targetScanId)}`;

    // Delete existing files in the scan's DICOM resource
    const deleteUrl = `${this.baseUrl}${basePath}/resources/DICOM/files`;
    const deleteResp = await fetch(deleteUrl, {
      method: 'DELETE',
      headers: this.buildAuthHeaders(),
    });
    if (!deleteResp.ok && deleteResp.status !== 404) {
      console.warn(`[xnatClient] Overwrite: could not delete old files (${deleteResp.status}), continuing`);
    }

    // Upload the new DICOM file
    const fileUrl = `${this.baseUrl}${basePath}/resources/DICOM/files/segmentation.dcm?format=DICOM&content=SEG`;
    const fileResp = await fetch(fileUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/dicom',
        ...this.buildAuthHeaders(),
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
  ): Promise<{ url: string }> {
    if (!this.token) throw new Error('Not authenticated');

    const filename = `autosave_seg_${sourceScanId}.dcm`;
    console.log(
      `[xnatClient] Auto-saving to temp resource: ${filename}`,
      `(${(dicomBuffer.length / 1024).toFixed(1)} KB)`,
    );

    const fileUrl = `${this.baseUrl}/data/experiments/${encodeURIComponent(sessionId)}`
      + `/resources/temp/files/${encodeURIComponent(filename)}`
      + `?format=DICOM&content=SEG&overwrite=true`;

    const resp = await fetch(fileUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/dicom',
        ...this.buildAuthHeaders(),
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
    if (!this.token) throw new Error('Not authenticated');

    const url = `${this.baseUrl}/data/experiments/${encodeURIComponent(sessionId)}`
      + `/resources/temp/files?format=json`;

    const resp = await fetch(url, {
      method: 'GET',
      headers: this.buildAuthHeaders(),
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
    if (!this.token) throw new Error('Not authenticated');

    const url = `${this.baseUrl}/data/experiments/${encodeURIComponent(sessionId)}`
      + `/resources/temp/files/${encodeURIComponent(filename)}`;

    const resp = await fetch(url, {
      method: 'DELETE',
      headers: this.buildAuthHeaders(),
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
    if (!this.token) throw new Error('Not authenticated');

    const url = `${this.baseUrl}/data/experiments/${encodeURIComponent(sessionId)}`
      + `/resources/temp/files/${encodeURIComponent(filename)}`;

    const resp = await fetch(url, {
      method: 'GET',
      headers: this.buildAuthHeaders(),
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
    return this.token !== null && this.token.expiresAt > Date.now();
  }

  get serverUrl(): string {
    return this.baseUrl;
  }

  get currentUsername(): string {
    return this.username;
  }

  get authType(): 'alias' | 'jsession' | null {
    return this.token?.type ?? null;
  }
}
