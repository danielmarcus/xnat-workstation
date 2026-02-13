/**
 * Session Manager — singleton managing the XNAT connection lifecycle.
 *
 * Wraps XnatClient with:
 * - Keepalive timer (pings /data/JSESSION periodically)
 * - Token refresh scheduling (handled by XnatClient internally)
 * - WebRequest interceptor for injecting auth headers into Cornerstone's
 *   direct WADO-URI fetches
 * - Session expiry notification to renderer via IPC
 *
 * Only one active connection at a time.
 */
import { session as electronSession, BrowserWindow } from 'electron';
import { XnatClient } from './xnatClient';
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
 * authenticates, browserLogin extracts the JSESSIONID, exchanges it
 * for an alias token, and retrieves the username — all using the
 * BrowserWindow's Chromium network stack (which some XNAT servers
 * require). The pre-fetched credentials are then handed to xnatClient.
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
    authType: client.authType ?? 'jsession',
  };

  // Start keepalive timer
  startKeepalive();

  // Set up web request interceptor for Cornerstone's direct WADO-URI fetches
  setupWebRequestInterceptor();

  console.log(`[sessionManager] Browser login: connected to ${connectionInfo.serverUrl} as ${connectionInfo.username}`);

  return { success: true, connection: connectionInfo };
}

/**
 * Disconnect: stop timers, invalidate session, clear interceptors.
 */
export async function logout(): Promise<void> {
  stopKeepalive();
  clearWebRequestInterceptor();

  if (client) {
    await client.disconnect();
    client = null;
  }

  connectionInfo = null;
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

  // All requests use JSESSION cookies — ping every 5 min to keep session alive.
  // Alias token chaining is handled separately by xnatClient.scheduleAliasRefresh.
  const intervalMs = 5 * 60 * 1000;

  keepaliveInterval = setInterval(async () => {
    if (!client) {
      stopKeepalive();
      return;
    }

    const username = await client.validateSession();
    if (!username) {
      console.warn('[sessionManager] Keepalive: session expired');
      notifySessionExpired();
      stopKeepalive();
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

// ─── Auth Failure Handling ────────────────────────────────────────

/**
 * Called by IPC handlers when an API call fails with an auth error
 * (401 or "Not authenticated") after xnatClient's own recovery attempt.
 * Cleans up the session and notifies the renderer to return to login.
 */
export function handleAuthFailure(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  if (!msg.includes('401') && !msg.includes('Not authenticated')) return;
  if (!client && !connectionInfo) return; // Already cleaned up

  console.warn('[sessionManager] Unrecoverable auth failure — disconnecting');
  stopKeepalive();
  clearWebRequestInterceptor();
  // Mark disconnected first so concurrent in-flight requests stop retrying
  if (client) client.markDisconnected();
  client = null;
  connectionInfo = null;
  notifySessionExpired();
}

// ─── Session Expiry Notification ─────────────────────────────────

function notifySessionExpired(): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    win.webContents.send(IPC.XNAT_SESSION_EXPIRED);
  }
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

  // Inject auth headers on outgoing requests
  electronSession.defaultSession.webRequest.onBeforeSendHeaders(
    filter,
    (details, callback) => {
      if (!client) {
        callback({ requestHeaders: details.requestHeaders });
        return;
      }

      try {
        const authHeaders = client.buildAuthHeaders();
        callback({
          requestHeaders: {
            ...details.requestHeaders,
            ...authHeaders,
          },
        });
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
