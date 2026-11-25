/**
 * Session Manager — singleton managing the XNAT connection lifecycle.
 *
 * Wraps XnatClient with:
 * - Browser sign-in when the server publishes a discovery document, else the login window
 * - Keepalive timer (pings /data/JSESSION periodically) or, after browser sign-in, token refresh
 * - WebRequest interceptor for injecting auth headers into Cornerstone's
 *   direct WADO-URI fetches
 * - Session expiry notification to renderer via IPC
 *
 * Only one active connection at a time.
 */
import * as path from 'path';
import { app, session as electronSession, BrowserWindow, safeStorage, shell } from 'electron';
import { XnatClient, XnatAuthError, NON_BROWSER_USER_AGENT, summarizeErrorBody } from './xnatClient';
import { openBrowserLogin } from './browserLogin';
import { discoverSignIn, type FetchLike, type SignInConfig } from './oidcDiscovery';
import { authorizeInBrowser, OidcLoginError } from './oidcLogin';
import { EncryptedRefreshTokenStore, OidcSession, OidcSessionEndedError, type OidcSessionDeps, type RefreshTokenStore } from './oidcSession';
import { IPC } from '../../shared/ipcChannels';
import type {
  XnatLoginOptions,
  XnatLoginResult,
  XnatConnectionInfo,
  XnatSessionStatus,
} from '../../shared/types/xnat';

let client: XnatClient | null = null;
let connectionInfo: XnatConnectionInfo | null = null;
let keepaliveInterval: NodeJS.Timeout | null = null;
let oidcSession: OidcSession | null = null;
let loginAbort: AbortController | null = null;

// ─── Public API ──────────────────────────────────────────────────

/**
 * Sign in. When the server publishes a discovery document, in the system browser (bearer mode);
 * otherwise, or when asked, in XNAT's login page in a child BrowserWindow (cookie mode).
 */
export async function browserLogin(serverUrl: string, options: XnatLoginOptions = {}): Promise<XnatLoginResult> {
  // Disconnect existing connection first
  if (client) {
    await logout();
  }

  if (!options.useLoginWindow) {
    const config = await discoverSignIn(serverUrl, { fetch: idpFetch, override: discoveryOverride() });
    if (config) return signInWithBrowser(config);
  }
  return loginWindow(serverUrl);
}

/** Stop a browser sign-in that is waiting for the user. */
export function cancelLogin(): void {
  loginAbort?.abort();
}

/**
 * Opens XNAT's login page in a child BrowserWindow. After the user
 * authenticates, extracts the JSESSIONID and retrieves the username —
 * all using the BrowserWindow's Chromium network stack (which some
 * XNAT servers require). The pre-fetched credentials are then handed
 * to xnatClient.
 */
async function loginWindow(serverUrl: string): Promise<XnatLoginResult> {
  // Open browser login window — returns pre-fetched auth data
  let loginResult: Awaited<ReturnType<typeof openBrowserLogin>>;
  try {
    loginResult = await openBrowserLogin(serverUrl);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Create client and set pre-fetched auth credentials directly
  const newClient = new XnatClient(serverUrl);
  await newClient.setAuthFromBrowserLogin(loginResult);
  const profile = await newClient.getCurrentUserProfile();

  client = newClient;

  connectionInfo = {
    serverUrl: client.serverUrl,
    username: client.currentUsername,
    firstName: profile.firstName,
    lastName: profile.lastName,
    connectedAt: Date.now(),
  };

  // Reset expiry notification flag for the new session
  resetSessionExpiredFlag();

  // Start keepalive timer
  startKeepalive();

  // Set up web request interceptor for Cornerstone's direct WADO-URI fetches
  setupWebRequestInterceptor();

  console.log(`[sessionManager] Browser login: connected to ${connectionInfo.serverUrl} as ${connectionInfo.username}`);
  notifyConnectionChange();

  return { success: true, connection: connectionInfo };
}

// ─── Browser sign-in (bearer mode) ───────────────────────────────

const idpFetch: FetchLike = (url, init) => electronSession.defaultSession.fetch(url, init);

/** XNAT_WORKSTATION_DISCOVERY: a JSON file or URL standing in for the server's document. Unpackaged builds only. */
function discoveryOverride(): string | undefined {
  return app.isPackaged ? undefined : process.env.XNAT_WORKSTATION_DISCOVERY || undefined;
}

function refreshTokenStore(): RefreshTokenStore | null {
  const available = safeStorage.isEncryptionAvailable()
    && !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text');
  if (!available) return null;
  return new EncryptedRefreshTokenStore(path.join(app.getPath('userData'), 'sign-in-tokens.json'), {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (text) => safeStorage.encryptString(text),
    decrypt: (data) => safeStorage.decryptString(data),
  });
}

function notifyLoginProgress(progress: { stage: 'browser'; host: string }): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.XNAT_LOGIN_PROGRESS, progress);
  }
}

const NO_ACCOUNT = Symbol('no XNAT account');

class NoXnatAccountError extends Error {
  constructor() {
    super('XNAT has no account for this sign-in.');
    this.name = 'NoXnatAccountError';
  }
}

/** XNAT or the identity provider refused the sign-in itself, as opposed to failing to answer. */
export function isSignInRejected(err: unknown): boolean {
  return err instanceof XnatAuthError || err instanceof OidcSessionEndedError || err instanceof NoXnatAccountError;
}

async function fetchBearerUsername(c: XnatClient): Promise<string | typeof NO_ACCOUNT> {
  const response = await c.rawRequest('/xapi/users/username');
  const text = (await response.text().catch(() => '')).trim();
  if (response.status === 403 && /no XNAT account is mapped/i.test(text)) return NO_ACCOUNT;
  if (!response.ok || !text) {
    throw new Error(`XNAT refused the sign-in: ${response.status} ${summarizeErrorBody(text, response.statusText)}`.trim());
  }
  return text;
}

async function signInWithBrowser(config: SignInConfig): Promise<XnatLoginResult> {
  const abort = new AbortController();
  loginAbort = abort;
  let session: OidcSession | null = null;
  let restored = false;
  const sessionConfig = {
    tokenEndpoint: config.tokenEndpoint,
    revocationEndpoint: config.revocationEndpoint,
    clientId: config.clientId,
    storeKey: `${config.issuer} ${config.clientId} ${config.apiUrl}`,
  };
  const deps: OidcSessionDeps = {
    fetch: idpFetch,
    store: refreshTokenStore(),
    onSessionEnded: () => {
      if (!session || session !== oidcSession) return;
      console.warn('[sessionManager] Sign-in session ended — disconnecting');
      tearDown();
      notifySessionExpired();
    },
  };

  try {
    session = await OidcSession.restore(sessionConfig, deps);
    restored = session !== null;
    if (!session) {
      notifyLoginProgress({ stage: 'browser', host: new URL(config.issuer).host });
      const tokens = await authorizeInBrowser(config, {
        fetch: idpFetch,
        openExternal: (url) => shell.openExternal(url),
        signal: abort.signal,
      });
      session = new OidcSession(sessionConfig, deps, tokens);
      BrowserWindow.getAllWindows()[0]?.focus();
    }

    const newClient = new XnatClient(config.apiUrl, session);
    let username = await fetchBearerUsername(newClient);
    if (username === NO_ACCOUNT) {
      // First sign-in: XNAT creates the account through its own login page, once.
      console.log('[sessionManager] No XNAT account for this identity yet — opening the login window once');
      await openBrowserLogin(config.webUrl);
      username = await fetchBearerUsername(newClient);
      if (username === NO_ACCOUNT) throw new NoXnatAccountError();
    }
    newClient.setBearerUsername(username);
    const profile = await newClient.getCurrentUserProfile();

    client = newClient;
    oidcSession = session;
    connectionInfo = {
      serverUrl: client.serverUrl,
      webUrl: config.webUrl,
      authMode: 'bearer',
      username,
      firstName: profile.firstName,
      lastName: profile.lastName,
      connectedAt: Date.now(),
    };

    resetSessionExpiredFlag();
    session.startAutoRefresh();
    setupWebRequestInterceptor();

    console.log(`[sessionManager] Browser sign-in: connected to ${connectionInfo.serverUrl} as ${username}`);
    notifyConnectionChange();
    return { success: true, connection: connectionInfo };
  } catch (err) {
    // A sign-in made just now is abandoned. A restored one is kept for the next attempt unless
    // XNAT or the provider turned it down: a network error or a 5xx says nothing about it.
    if (!restored || isSignInRejected(err)) await session?.revoke();
    else session?.stopAutoRefresh();
    const cancelled = (err instanceof OidcLoginError && err.cancelled) || (err instanceof Error && err.message === 'Login cancelled');
    if (cancelled) return { success: false, error: 'Login cancelled' };
    const message = err instanceof XnatAuthError
      ? 'XNAT did not accept the sign-in.'
      : (err instanceof Error ? err.message : String(err));
    return { success: false, error: message, canUseLoginWindow: true };
  } finally {
    if (loginAbort === abort) loginAbort = null;
  }
}

// ─── Connection listeners ─────────────────────────────────────────

const connectionListeners = new Set<(info: XnatConnectionInfo | null) => void>();

/**
 * Be told when the connection starts (with its info) or ends (null) — the extension host re-checks
 * extensions' licences on it. Returns the function that stops listening.
 */
export function onConnectionChange(listener: (info: XnatConnectionInfo | null) => void): () => void {
  connectionListeners.add(listener);
  return () => { connectionListeners.delete(listener); };
}

function notifyConnectionChange(): void {
  for (const l of [...connectionListeners]) {
    try { l(connectionInfo); } catch (err) { console.warn('[sessionManager] a connection listener failed:', err); }
  }
}

/**
 * Disconnect: invalidate session on server, then clean up local state.
 */
export async function logout(): Promise<void> {
  // Best-effort: tell the server to invalidate the session
  if (client) {
    await client.disconnect();
  }
  await oidcSession?.revoke();
  tearDown();
  console.log('[sessionManager] Logged out');
}

/**
 * Validate the current session.
 */
export async function validateSession(): Promise<XnatSessionStatus> {
  if (!client) return { valid: false };

  const username = await client.validateSession();
  if (username) {
    return { valid: true, username, connection: connectionInfo ?? undefined };
  }

  return { valid: false };
}

/**
 * Get the current connection info (no secrets).
 */
export function getConnectionInfo(): XnatConnectionInfo | null {
  return connectionInfo;
}

/**
 * Get the active XnatClient instance.
 */
export function getClient(): XnatClient | null {
  return client;
}

/**
 * Check if connected.
 */
export function isConnected(): boolean {
  return client !== null && client.isAuthenticated;
}

/**
 * Direct login for E2E testing — authenticates via XNAT REST API
 * without opening a browser popup. Gated behind E2E_TESTING=1.
 *
 * Calls POST /data/JSESSION with Basic Auth, then fetches the username
 * and sets up the full connection state (XnatClient, keepalive, interceptor).
 */
export async function directLogin(
  serverUrl: string,
  username: string,
  password: string,
): Promise<XnatLoginResult> {
  if (process.env.E2E_TESTING !== '1') {
    return { success: false, error: 'directLogin is only available in E2E testing mode' };
  }

  // Disconnect existing connection first
  if (client) {
    await logout();
  }

  const baseUrl = serverUrl.replace(/\/+$/, '');
  const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');

  try {
    // Clear all existing cookies for this server to avoid HttpOnly conflicts
    // when setAuthFromBrowserLogin() calls cookies.set() later.
    const existingCookies = await electronSession.defaultSession.cookies.get({ url: baseUrl });
    for (const c of existingCookies) {
      try {
        await electronSession.defaultSession.cookies.remove(baseUrl, c.name);
      } catch { /* ignore */ }
    }

    // Authenticate via XNAT REST API.
    // Try POST /data/JSESSION with Basic Auth first; if the server
    // returns 500 (some XNAT deployments behind ALBs reject this),
    // fall back to POST /data/services/auth with form-encoded body.
    let jsessionId: string | undefined;

    const sessionResp = await electronSession.defaultSession.fetch(
      `${baseUrl}/data/JSESSION`,
      {
        method: 'POST',
        // Not a browser User-Agent: some SSO-only servers answer 500 to a basic-auth
        // sign-in that looks like it came from a browser, and an alias token must sign in here.
        headers: { Authorization: authHeader, 'User-Agent': 'xnat-workstation-e2e' },
      },
    );

    if (sessionResp.ok) {
      jsessionId = (await sessionResp.text()).trim();
    } else {
      // Fallback: form-based auth via /data/services/auth
      const formBody = new URLSearchParams({ username, password });
      const authResp = await electronSession.defaultSession.fetch(
        `${baseUrl}/data/services/auth`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: formBody.toString(),
        },
      );
      if (!authResp.ok) {
        return { success: false, error: `Authentication failed: ${authResp.status}` };
      }
      jsessionId = (await authResp.text()).trim();
    }

    if (!jsessionId) {
      return { success: false, error: 'Authentication returned empty session ID' };
    }

    // Fetch username (using the server-set HttpOnly session cookie)
    const userResp = await electronSession.defaultSession.fetch(
      `${baseUrl}/xapi/users/username`,
    );
    const fetchedUsername = userResp.ok ? (await userResp.text()).trim() : username;

    // Fetch CSRF token from the root page
    let csrfToken: string | null = null;
    try {
      const rootResp = await electronSession.defaultSession.fetch(`${baseUrl}/`);
      if (rootResp.ok) {
        const html = await rootResp.text();
        const match = html.match(/var\s+csrfToken\s*=\s*['"]([^'"]+)['"]/);
        csrfToken = match?.[1] || null;
      }
    } catch {
      // Non-fatal — CSRF token will be missing but GETs still work
    }

    // Clear all cookies set by the HTTP requests above. The server sets
    // JSESSIONID as HttpOnly, but XnatClient.setAuthFromBrowserLogin()
    // calls cookies.set() without HttpOnly — Chromium rejects that with
    // EXCLUDE_OVERWRITE_HTTP_ONLY. Removing first avoids the conflict.
    const staleHttpCookies = await electronSession.defaultSession.cookies.get({ url: baseUrl });
    for (const c of staleHttpCookies) {
      try {
        await electronSession.defaultSession.cookies.remove(baseUrl, c.name);
      } catch { /* ignore */ }
    }

    // Create client with pre-fetched auth
    const newClient = new XnatClient(baseUrl);
    await newClient.setAuthFromBrowserLogin({
      jsessionId,
      username: fetchedUsername,
      csrfToken,
    });
    const profile = await newClient.getCurrentUserProfile();

    client = newClient;
    connectionInfo = {
      serverUrl: client.serverUrl,
      username: client.currentUsername,
      firstName: profile.firstName,
      lastName: profile.lastName,
      connectedAt: Date.now(),
    };

    resetSessionExpiredFlag();
    startKeepalive();
    setupWebRequestInterceptor();

    console.log(`[sessionManager] E2E direct login: connected to ${connectionInfo.serverUrl} as ${connectionInfo.username}`);
    notifyConnectionChange();
    return { success: true, connection: connectionInfo };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Keepalive ───────────────────────────────────────────────────

function startKeepalive(): void {
  stopKeepalive();

  // Ping every 5 min to keep JSESSION alive on the server.
  const intervalMs = 5 * 60 * 1000;

  keepaliveInterval = setInterval(async () => {
    if (!client) {
      stopKeepalive();
      return;
    }

    const username = await client.validateSession();
    if (!username) {
      console.warn('[sessionManager] Keepalive: session expired — disconnecting');
      tearDown();
      notifySessionExpired();
    } else {
      console.log('[sessionManager] Keepalive: session valid');
    }
  }, intervalMs);

  console.log(`[sessionManager] Keepalive started (${intervalMs / 1000}s interval)`);
}

function stopKeepalive(): void {
  if (keepaliveInterval) {
    clearInterval(keepaliveInterval);
    keepaliveInterval = null;
  }
}

// ─── Tear Down ───────────────────────────────────────────────────

/**
 * Full cleanup of auth state: stop keepalive, clear interceptors,
 * mark client disconnected, null references. Does NOT notify renderer
 * — callers should call notifySessionExpired() separately if needed.
 */
function tearDown(): void {
  const wasConnected = connectionInfo !== null;
  stopKeepalive();
  oidcSession?.stopAutoRefresh();
  oidcSession = null;
  clearWebRequestInterceptor();
  if (client) {
    client.clearCookies();
    client.markDisconnected();
  }
  client = null;
  connectionInfo = null;
  if (wasConnected) notifyConnectionChange();
}

// ─── Auth Failure Handling ────────────────────────────────────────

/**
 * Called by IPC handlers when an API call fails with an auth error.
 * Cleans up the session and notifies the renderer to return to login.
 * Uses XnatAuthError type checking instead of fragile string matching.
 */
export function handleAuthFailure(err: unknown): void {
  if (!(err instanceof XnatAuthError)) return;
  if (!client && !connectionInfo) return; // Already cleaned up

  console.warn('[sessionManager] Unrecoverable auth failure — disconnecting');
  tearDown();
  notifySessionExpired();
}

// ─── Session Expiry Notification ─────────────────────────────────

/** Debounce flag to prevent duplicate session-expired notifications
 *  when multiple API calls fail simultaneously with auth errors. */
let sessionExpiredNotified = false;

function notifySessionExpired(): void {
  if (sessionExpiredNotified) return;
  sessionExpiredNotified = true;

  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    win.webContents.send(IPC.XNAT_SESSION_EXPIRED);
  }
}

/** Reset the notification flag (called when a new login succeeds). */
function resetSessionExpiredFlag(): void {
  sessionExpiredNotified = false;
}

// ─── Web Request Interceptor ─────────────────────────────────────
//
// Injects auth headers into outgoing requests matching the XNAT server URL.
// This makes Cornerstone's direct wadouri fetch() calls transparent — they
// automatically get auth headers without any JS-level interception.
//
// Also adds Cross-Origin-Resource-Policy: cross-origin to responses from
// the XNAT server so COEP doesn't block them.

function setupWebRequestInterceptor(): void {
  if (!client) return;

  const serverUrl = client.serverUrl;
  const filter = { urls: [`${serverUrl}/*`] };
  const bearer = oidcSession;

  // Inject cookies on outgoing renderer requests (Cornerstone wadouri GETs).
  // Renderer requests are cross-origin so Chromium won't attach cookies
  // automatically. Read from the cookie jar — the single source of truth.
  // After browser sign-in, inject the access token instead.
  electronSession.defaultSession.webRequest.onBeforeSendHeaders(
    filter,
    (details, callback) => {
      if (bearer) {
        // A usable token: after the machine sleeps past its expiry the refresh timer has not
        // run yet, and an image request sent with the old token would get a 401. When it
        // cannot be refreshed, the request goes with the old one and XNAT turns it away.
        const send = (token: string) =>
          callback({ requestHeaders: withBearerAuth(details.url, serverUrl, details.requestHeaders, token) });
        if (!details.url.startsWith(`${serverUrl}/`)) {
          callback({ requestHeaders: details.requestHeaders });
          return;
        }
        bearer.getAccessToken().then(send, () => send(bearer.accessToken));
        return;
      }
      electronSession.defaultSession.cookies.get({ url: details.url })
        .then((cookies) => {
          if (cookies.length === 0) {
            callback({ requestHeaders: details.requestHeaders });
            return;
          }
          const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
          const requestHeaders = { ...details.requestHeaders } as Record<string, string | string[]>;
          requestHeaders.Cookie = cookieHeader;
          callback({ requestHeaders });
        })
        .catch(() => {
          callback({ requestHeaders: details.requestHeaders });
        });
    },
  );

  // Add CORS + CORP headers to XNAT responses.
  // XNAT doesn't send CORS headers, so Cornerstone's XHR (wadouri) requests
  // would fail without injected headers. Let all Set-Cookie headers through
  // so the cookie jar stays current (ALB routing + session cookies in sync).
  electronSession.defaultSession.webRequest.onHeadersReceived(
    filter,
    (details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Access-Control-Allow-Origin': ['*'],
          'Access-Control-Allow-Headers': ['*'],
          'Access-Control-Allow-Methods': ['GET, POST, OPTIONS'],
          'Cross-Origin-Resource-Policy': ['cross-origin'],
        },
      });
    },
  );

  console.log(`[sessionManager] WebRequest interceptor set up for ${serverUrl}`);
}

/**
 * The access token and a non-browser User-Agent for a request to the XNAT API, with no cookies;
 * any other request's headers unchanged.
 */
export function withBearerAuth(
  url: string,
  apiUrl: string,
  headers: Record<string, string | string[]>,
  accessToken: string,
): Record<string, string | string[]> {
  if (!url.startsWith(`${apiUrl}/`)) return headers;
  const out: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (lower !== 'cookie' && lower !== 'authorization' && lower !== 'user-agent') out[name] = value;
  }
  out.Authorization = `Bearer ${accessToken}`;
  out['User-Agent'] = NON_BROWSER_USER_AGENT;
  return out;
}

function clearWebRequestInterceptor(): void {
  // Reset to no-op handlers — Electron doesn't have a "remove" API,
  // but setting handlers without a filter effectively clears previous ones
  electronSession.defaultSession.webRequest.onBeforeSendHeaders(null as any);
  electronSession.defaultSession.webRequest.onHeadersReceived(null as any);
  console.log('[sessionManager] WebRequest interceptor cleared');
}
