/**
 * Session Manager — singleton managing the XNAT connection lifecycle.
 *
 * Wraps XnatClient with:
 * - Keepalive timer (pings /data/JSESSION periodically)
 * - WebRequest interceptor for injecting auth headers into Cornerstone's
 *   direct WADO-URI fetches
 * - Session expiry notification to renderer via IPC
 *
 * Only one active connection at a time.
 */
import { session as electronSession, BrowserWindow } from 'electron';
import { XnatClient, XnatAuthError } from './xnatClient';
import { openBrowserLogin } from './browserLogin';
import { IPC } from '../../shared/ipcChannels';
import type {
  XnatLoginResult,
  XnatConnectionInfo,
  XnatSessionStatus,
} from '../../shared/types/xnat';

let client: XnatClient | null = null;
let connectionInfo: XnatConnectionInfo | null = null;
let keepaliveInterval: NodeJS.Timeout | null = null;

// ─── Public API ──────────────────────────────────────────────────

/**
 * Authenticate via browser-based login (SSO/OIDC/LDAP/local).
 * Opens XNAT's login page in a child BrowserWindow. After the user
 * authenticates, extracts the JSESSIONID and retrieves the username —
 * all using the BrowserWindow's Chromium network stack (which some
 * XNAT servers require). The pre-fetched credentials are then handed
 * to xnatClient.
 */
export async function browserLogin(serverUrl: string): Promise<XnatLoginResult> {
  // Disconnect existing connection first
  if (client) {
    await logout();
  }

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

  client = newClient;

  connectionInfo = {
    serverUrl: client.serverUrl,
    username: client.currentUsername,
    connectedAt: Date.now(),
  };

  // Reset expiry notification flag for the new session
  resetSessionExpiredFlag();

  // Start keepalive timer
  startKeepalive();

  // Set up web request interceptor for Cornerstone's direct WADO-URI fetches
  setupWebRequestInterceptor();

  console.log(`[sessionManager] Browser login: connected to ${connectionInfo.serverUrl} as ${connectionInfo.username}`);

  return { success: true, connection: connectionInfo };
}

/**
 * Disconnect: invalidate session on server, then clean up local state.
 */
export async function logout(): Promise<void> {
  // Best-effort: tell the server to invalidate the session
  if (client) {
    await client.disconnect();
  }
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
  stopKeepalive();
  clearWebRequestInterceptor();
  if (client) {
    client.clearCookies();
    client.markDisconnected();
  }
  client = null;
  connectionInfo = null;
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

  // Inject auth cookie on outgoing requests from the renderer (Cornerstone
  // wadouri GETs). Main-process fetches already have cookies via session.fetch().
  electronSession.defaultSession.webRequest.onBeforeSendHeaders(
    filter,
    (details, callback) => {
      if (!client) {
        callback({ requestHeaders: details.requestHeaders });
        return;
      }

      try {
        const authHeaders = client.buildAuthHeaders();
        const requestHeaders = { ...details.requestHeaders } as Record<string, string | string[]>;
        const hasHeader = (name: string): boolean =>
          Object.keys(requestHeaders).some((k) => k.toLowerCase() === name.toLowerCase());

        if (!hasHeader('cookie') && authHeaders.Cookie) {
          requestHeaders.Cookie = authHeaders.Cookie;
        }

        callback({ requestHeaders });
      } catch {
        callback({ requestHeaders: details.requestHeaders });
      }
    },
  );

  // Add CORS + CORP headers to XNAT responses.
  // XNAT doesn't send CORS headers, so Cornerstone's XHR (wadouri) requests
  // would fail. We inject the necessary headers from the main process.
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

function clearWebRequestInterceptor(): void {
  // Reset to no-op handlers — Electron doesn't have a "remove" API,
  // but setting handlers without a filter effectively clears previous ones
  electronSession.defaultSession.webRequest.onBeforeSendHeaders(null as any);
  electronSession.defaultSession.webRequest.onHeadersReceived(null as any);
  console.log('[sessionManager] WebRequest interceptor cleared');
}
