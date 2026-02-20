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
  /** JSESSION cookie — used for all XNAT API requests */
  private jsessionId: string | null = null;
  /** All server cookies (JSESSIONID, ALB sticky-session, etc.) */
  private serverCookies: ServerCookie[] = [];
  /** Set by markDisconnected() to stop concurrent in-flight requests from retrying */
  private _disconnected = false;
  private scanSopClassUidCache = new Map<string, string | null>();
  /** Cached CSRF token used for mutating requests (PUT/POST/PATCH/DELETE). */
  private csrfToken: string | null = null;
  private loggedCsrfMissingWarning = false;
  /** Candidate cookie names used by XNAT/Spring deployments for CSRF token transport. */
  private static readonly CSRF_COOKIE_NAMES = [
    'XNAT_CSRF',
    'XSRF-TOKEN',
    'CSRF-TOKEN',
    '_csrf',
    'CSRF',
  ];
  /** Candidate endpoints that may return/refresh CSRF token material on different XNAT versions. */
  private static readonly CSRF_TOKEN_ENDPOINTS = [
    '/data/services/tokens/XSRF',
    '/data/services/tokens/CSRF',
    '/data/services/tokens/xsrf',
    '/data/services/tokens/csrf',
    '/xapi/auth/csrf',
    '/xapi/auth/CSRF',
    '/xapi/auth/xsrf',
    '/xapi/auth/XSRF',
  ];
  private static readonly CSRF_TOKEN_METHODS: ReadonlyArray<'GET' | 'POST' | 'PUT'> = [
    'GET',
    'POST',
    'PUT',
  ];

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
    this.csrfToken = this.extractCsrfFromServerCookies(this.serverCookies);
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
    const headers: Record<string, string> = { Cookie: parts.join('; ') };
    if (this.csrfToken) {
      headers['X-XSRF-TOKEN'] = this.csrfToken;
      headers['X-CSRF-TOKEN'] = this.csrfToken;
      headers.XNAT_CSRF = this.csrfToken;
      headers['X-Requested-With'] = 'XMLHttpRequest';
    }
    return headers;
  }

  /**
   * Wrapper around session.fetch that uses the default session's
   * cookie jar. session.fetch() automatically sends cookies for the
   * matching domain.
   */
  private rawFetch(url: string, options?: RequestInit): Promise<Response> {
    // Explicitly set fetch mode/credentials for non-renderer requests so
    // Chromium does not downgrade to no-cors semantics (which can strip
    // custom CSRF headers on mutating requests).
    const normalized: RequestInit = {
      credentials: 'include',
      cache: 'no-store',
      redirect: 'follow',
      ...(options ?? {}),
    };
    if (!normalized.mode) {
      normalized.mode = 'cors';
    }
    return electronSession.defaultSession.fetch(url, normalized);
  }

  private extractCsrfFromServerCookies(cookies: ServerCookie[]): string | null {
    for (const name of XnatClient.CSRF_COOKIE_NAMES) {
      const hit = cookies.find((c) => c.name.toLowerCase() === name.toLowerCase() && c.value);
      if (hit?.value) return hit.value;
    }
    return null;
  }

  private async readCsrfFromDefaultSessionCookies(): Promise<string | null> {
    try {
      const cookies = await electronSession.defaultSession.cookies.get({ url: this.baseUrl });
      for (const name of XnatClient.CSRF_COOKIE_NAMES) {
        const hit = cookies.find((c) => c.name.toLowerCase() === name.toLowerCase() && c.value);
        if (hit?.value) {
          return hit.value;
        }
      }
      const heuristic = cookies.find((c) => /csrf|xsrf/i.test(c.name) && c.value);
      if (heuristic?.value) {
        return heuristic.value;
      }
    } catch {
      // Ignore cookie-read failures and continue with endpoint probing.
    }
    return null;
  }

  private async getDefaultSessionCookieNames(): Promise<string[]> {
    try {
      const cookies = await electronSession.defaultSession.cookies.get({ url: this.baseUrl });
      return cookies.map((c) => c.name);
    } catch {
      return [];
    }
  }

  private extractCsrfFromResponse(resp: Response, bodyText: string): string | null {
    const headerCandidates = ['x-xsrf-token', 'x-csrf-token', 'xnat_csrf'];
    for (const name of headerCandidates) {
      const value = resp.headers.get(name);
      if (value && value.trim()) return value.trim();
    }

    const text = (bodyText || '').trim();
    if (!text) return null;
    if (text.startsWith('<')) return null; // HTML status/login pages are not token payloads

    // Plain text token.
    if (!text.startsWith('{') && !text.startsWith('[')) {
      const normalized = text.replace(/^"+|"+$/g, '').trim();
      return normalized || null;
    }

    // JSON payload token.
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const candidates = ['token', 'csrfToken', 'csrf', '_csrf', 'value'];
      for (const key of candidates) {
        const raw = parsed[key];
        if (typeof raw === 'string' && raw.trim()) return raw.trim();
      }
    } catch {
      // Not parseable JSON — ignore.
    }
    return null;
  }

  private extractCsrfFromHtml(htmlText: string): string | null {
    const text = htmlText || '';
    if (!text) return null;
    const patterns = [
      /name=["']_csrf["'][^>]*value=["']([^"']+)["']/i,
      /name=["']csrf-token["'][^>]*content=["']([^"']+)["']/i,
      /name=["']x-csrf-token["'][^>]*content=["']([^"']+)["']/i,
      /"_csrf"\s*:\s*"([^"]+)"/i,
      /"csrfToken"\s*:\s*"([^"]+)"/i,
      /window\._csrf\s*=\s*["']([^"']+)["']/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      const value = match?.[1]?.trim();
      if (value) return value;
    }
    return null;
  }

  private async ensureCsrfToken(): Promise<string | null> {
    if (this.csrfToken) return this.csrfToken;

    const cookieToken = await this.readCsrfFromDefaultSessionCookies();
    if (cookieToken) {
      this.csrfToken = cookieToken;
      console.log('[xnatClient] CSRF token resolved from cookie jar');
      return cookieToken;
    }

    // Prime server session state first. Some deployments only mint CSRF
    // after a normal authenticated API request.
    try {
      await this.rawFetch(`${this.baseUrl}/data/JSESSION`, {
        method: 'GET',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'X-Requested-With': 'XMLHttpRequest',
        },
      });
      const tokenAfterPrime = await this.readCsrfFromDefaultSessionCookies();
      if (tokenAfterPrime) {
        this.csrfToken = tokenAfterPrime;
        console.log('[xnatClient] CSRF token resolved from cookie jar after JSESSION prime');
        return tokenAfterPrime;
      }
    } catch {
      // Continue with endpoint probing.
    }

    const probeResults: string[] = [];
    for (const endpoint of XnatClient.CSRF_TOKEN_ENDPOINTS) {
      for (const method of XnatClient.CSRF_TOKEN_METHODS) {
        try {
          const headers = new Headers({
            Accept: 'application/json, text/plain, */*',
            'X-Requested-With': 'XMLHttpRequest',
            'X-XSRF-TOKEN': 'Fetch',
            'X-CSRF-TOKEN': 'Fetch',
          });
          let body: string | undefined;
          if (method !== 'GET') {
            headers.set('Content-Type', 'application/json');
            body = '{}';
          }
          const resp = await this.rawFetch(`${this.baseUrl}${endpoint}`, {
            method,
            headers,
            body,
          });
          const text = await resp.text().catch(() => '');
          const extracted = this.extractCsrfFromResponse(resp, text);
          if (extracted) {
            this.csrfToken = extracted;
            console.log(`[xnatClient] CSRF token resolved from endpoint ${method} ${endpoint}`);
            return extracted;
          }
          const refreshedCookieToken = await this.readCsrfFromDefaultSessionCookies();
          if (refreshedCookieToken) {
            this.csrfToken = refreshedCookieToken;
            console.log(`[xnatClient] CSRF token refreshed in cookie jar via ${method} ${endpoint}`);
            return refreshedCookieToken;
          }
          const snippet = text.replace(/\s+/g, ' ').slice(0, 120);
          probeResults.push(`${method} ${endpoint}:${resp.status}${snippet ? `:${snippet}` : ''}`);
        } catch {
          probeResults.push(`${method} ${endpoint}:error`);
          // Try next method/endpoint variant.
        }
      }
    }

    // Fallback: some deployments only expose CSRF token in authenticated HTML pages.
    const htmlFallbacks = [
      '/app/template/Login.vm',
      '/app/',
      '/',
    ];
    for (const endpoint of htmlFallbacks) {
      try {
        const resp = await this.rawFetch(`${this.baseUrl}${endpoint}`, {
          method: 'GET',
          headers: {
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'X-Requested-With': 'XMLHttpRequest',
          },
        });
        const text = await resp.text().catch(() => '');
        const htmlToken = this.extractCsrfFromHtml(text);
        if (htmlToken) {
          this.csrfToken = htmlToken;
          console.log(`[xnatClient] CSRF token resolved from HTML fallback ${endpoint}`);
          return htmlToken;
        }
        probeResults.push(`GET ${endpoint}:${resp.status}:html-no-token`);
      } catch {
        probeResults.push(`GET ${endpoint}:error`);
      }
    }

    const names = await this.getDefaultSessionCookieNames();
    console.warn(
      '[xnatClient] Failed to resolve CSRF token.',
      `probes=${probeResults.join(', ') || '<none>'}`,
      `cookies=${names.join(', ') || '<none>'}`,
    );

    return null;
  }

  private isInvalidCsrfResponse(resp: Response, bodyText: string): boolean {
    const text = bodyText.toLowerCase();
    const csrfText = (
      text.includes('invalid csrf')
      || text.includes('invalidcsrf')
      || text.includes('invalidcsrfexception')
      || text.includes('csrftoken')
      || text.includes('csrf')
    );
    if (!csrfText) return false;
    return (
      resp.status === 403
      || resp.status === 400
      || resp.status === 412
      || resp.status === 500
      || text.includes('forbidden')
    );
  }

  private async xfetch(url: string, options?: RequestInit): Promise<Response> {
    const method = (options?.method ?? 'GET').toUpperCase();
    const isMutating = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
    if (!isMutating) {
      return this.rawFetch(url, options);
    }

    const attachCsrfHeaders = (token: string | null): Headers => {
      const headers = new Headers(options?.headers ?? {});
      headers.set('X-Requested-With', 'XMLHttpRequest');
      if (token) {
        headers.set('X-XSRF-TOKEN', token);
        headers.set('X-CSRF-TOKEN', token);
        headers.set('XNAT_CSRF', token);
        headers.set('XSRF-TOKEN', token);
      }
      return headers;
    };

    const csrfToken = await this.ensureCsrfToken();
    if (csrfToken) {
      this.loggedCsrfMissingWarning = false;
    } else if (!this.loggedCsrfMissingWarning) {
      this.loggedCsrfMissingWarning = true;
      console.warn(`[xnatClient] No CSRF token resolved for ${method} ${url}`);
    }

    let response = await this.rawFetch(url, {
      ...(options ?? {}),
      headers: attachCsrfHeaders(csrfToken),
    });

    // Some XNAT deployments rotate CSRF tokens server-side and may return
    // either 403 or 500 InvalidCsrfException. Retry once on CSRF failures.
    if (!response.ok) {
      const firstBody = await response.text().catch(() => '');
      if (this.isInvalidCsrfResponse(response, firstBody)) {
        this.csrfToken = null;
        const refreshedToken = await this.ensureCsrfToken();
        if (refreshedToken) {
          console.warn('[xnatClient] Retrying mutating request after CSRF token refresh');
          response = await this.rawFetch(url, {
            ...(options ?? {}),
            headers: attachCsrfHeaders(refreshedToken),
          });
        } else {
          // Recreate the consumed response body so callers receive the original detail.
          response = new Response(firstBody, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        }
      } else {
        // Recreate the consumed body for non-CSRF callers too.
        response = new Response(firstBody, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }
    }

    return response;
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
    const dicomFiles = results
      .filter((f: any) => {
        const name = (f.Name || '').toLowerCase();
        const collection = (f.collection || '').toLowerCase();
        // Include files from DICOM collection or with .dcm extension
        return collection === 'dicom' || name.endsWith('.dcm') || !name.includes('.');
      });

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
