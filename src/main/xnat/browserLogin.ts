/**
 * Browser-based XNAT Login
 *
 * Opens XNAT's own login page in an Electron BrowserWindow, allowing the user
 * to authenticate via any method the server supports (local, LDAP, OIDC, etc.).
 * After successful login, extracts the JSESSIONID cookie set by XNAT.
 *
 * Detection strategy: Tomcat sets a JSESSIONID cookie immediately (even for
 * anonymous sessions), so we can't just check for cookie presence. Instead we
 * listen for cookie changes AND page-load events, then validate the current
 * JSESSIONID against a protected endpoint to confirm it's authenticated.
 *
 * XNAT uses AJAX-based login (XNAT.xhr.submit) which triggers Spring Security's
 * SessionFixationProtectionStrategy — the JSESSIONID is regenerated after
 * authentication. We react to the cookie-changed event to reliably capture the
 * post-fixation session ID, rather than relying on navigation events that may
 * fire before the new cookie has settled.
 *
 * Uses an isolated session partition to avoid cookie/state bleed with the main window.
 * Sets a standard Chrome User-Agent for Google OIDC compatibility.
 */
import { BrowserWindow, session } from 'electron';

const LOGIN_PARTITION = 'persist:xnat-login';

// Standard Chrome User-Agent — required for Google OIDC compatibility,
// which blocks embedded browsers by default User-Agent detection.
const CHROME_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * After authentication is confirmed, exchange the JSESSIONID for an alias
 * token and retrieve the username. All requests use session.fetch() so they
 * go through the same Chromium network stack as the BrowserWindow.
 */
async function exchangeCredentials(
  loginSession: Electron.Session,
  serverUrl: string,
  jsessionId: string,
): Promise<BrowserLoginResult> {
  let aliasToken: { alias: string; secret: string } | undefined;
  let username = '';

  // Step 1: Try to issue an alias token (lasts 48h, supports token chaining).
  try {
    const tokenResp = await loginSession.fetch(
      `${serverUrl}/data/services/tokens/issue`,
      { headers: { Accept: 'application/json' } },
    );
    const tokenContentType = tokenResp.headers.get('content-type') ?? '';
    console.log(`[browserLogin] Token exchange: status=${tokenResp.status}, content-type=${tokenContentType}`);
    if (tokenResp.ok && tokenContentType.includes('json')) {
      const data = (await tokenResp.json()) as { alias: string; secret: string };
      aliasToken = data;
      console.log(`[browserLogin] Alias token issued: ${data.alias.slice(0, 8)}...`);
    }
  } catch (err) {
    console.warn('[browserLogin] Token exchange failed:', err);
  }

  // Step 2: Get the username.
  // With alias token: GET /data/JSESSION using Basic auth returns the username.
  // Without alias token: GET /data/user with cookie returns user profile.
  if (aliasToken) {
    try {
      const basicAuth = `Basic ${btoa(`${aliasToken.alias}:${aliasToken.secret}`)}`;
      const resp = await loginSession.fetch(`${serverUrl}/data/JSESSION`, {
        headers: { Authorization: basicAuth },
      });
      if (resp.ok) {
        username = (await resp.text()).trim();
        console.log(`[browserLogin] Username from /data/JSESSION: ${username}`);
      }
    } catch {
      // Fall through to next method
    }
  }

  if (!username) {
    try {
      const resp = await loginSession.fetch(`${serverUrl}/data/user`, {
        headers: { Accept: 'application/json' },
      });
      if (resp.ok) {
        const data = await resp.json();
        const login = (data as any)?.items?.[0]?.data_fields?.login;
        if (login) {
          username = login;
          console.log(`[browserLogin] Username from /data/user: ${username}`);
        }
      }
    } catch {
      // Non-fatal
    }
  }

  if (!username) {
    username = 'User';
    console.warn('[browserLogin] Could not determine username');
  }

  return { jsessionId, aliasToken, username };
}

/** Result from browser login — includes pre-fetched auth data. */
export interface BrowserLoginResult {
  jsessionId: string;
  aliasToken?: { alias: string; secret: string };
  username: string;
}

/**
 * Open a BrowserWindow to the XNAT login page and wait for the user to authenticate.
 *
 * After authentication is detected, exchanges the JSESSIONID for an alias token
 * and retrieves the username — all using the login session's Chromium network
 * stack (session.fetch), which shares cookies/headers with the BrowserWindow.
 * Node.js fetch gets rejected (401) by some XNAT servers, so all network
 * operations must happen through the login session before it's destroyed.
 */
export async function openBrowserLogin(
  serverUrl: string,
): Promise<BrowserLoginResult> {
  const loginSession = session.fromPartition(LOGIN_PARTITION);

  // Clear stale cookies/state from previous login attempts.
  // Must await — otherwise old cookies from a persistent partition
  // can be detected before the page even loads.
  await loginSession.clearStorageData();

  return new Promise<BrowserLoginResult>((resolve, reject) => {
    const loginWindow = new BrowserWindow({
      width: 900,
      height: 700,
      show: false,
      title: 'Sign in — XNAT',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition: LOGIN_PARTITION,
      },
    });

    loginWindow.webContents.setUserAgent(CHROME_USER_AGENT);

    let resolved = false;
    // Track the first JSESSIONID value. We clear session storage at the
    // start, so the first cookie Tomcat sets is always an anonymous session.
    // After authentication, Spring Security's session fixation protection
    // regenerates the JSESSIONID to a new value — that's our signal.
    let firstJsessionId: string | null = null;
    let initialLoadDone = false;

    function finish(result: BrowserLoginResult | null, error?: Error): void {
      if (resolved) return;
      resolved = true;

      // Remove the cookie listener
      loginSession.cookies.removeListener('changed', onCookieChanged);

      // Clean up the window
      if (!loginWindow.isDestroyed()) {
        loginWindow.destroy();
      }

      // Clean up the session
      loginSession.clearStorageData().catch(() => {});

      if (error) {
        reject(error);
      } else if (result) {
        resolve(result);
      } else {
        reject(new Error('Login failed'));
      }
    }

    async function checkForAuthenticatedSession(): Promise<void> {
      if (resolved) return;

      try {
        // Get JSESSIONID cookie from the login window's session
        const url = new URL(serverUrl);
        const cookies = await loginSession.cookies.get({
          domain: url.hostname,
          name: 'JSESSIONID',
        });

        if (cookies.length === 0 || !cookies[0].value) {
          return;
        }

        const jsessionId = cookies[0].value;

        // Validate using the login session's own Chromium network stack
        // (session.fetch). This automatically includes all cookies,
        // User-Agent, and headers that the BrowserWindow uses — Node.js
        // fetch gets rejected by some XNAT servers.
        //
        // Some XNAT servers return 200 with an HTML login page for
        // unauthenticated browser requests instead of 401. We ask for
        // JSON explicitly and verify the Content-Type to distinguish
        // a real API response from a login-page redirect.
        const validateResp = await loginSession.fetch(
          `${serverUrl}/data/projects?format=json&limit=1`,
          { headers: { Accept: 'application/json' } },
        );

        const contentType = validateResp.headers.get('content-type') ?? '';
        console.log(`[browserLogin] Validation: status=${validateResp.status}, content-type=${contentType}, jsession=${jsessionId.slice(0, 8)}...`);

        if (!validateResp.ok) {
          if (validateResp.status >= 500) {
            finish(null, new Error(`XNAT server error: ${validateResp.status}`));
          }
          return;
        }

        // If the server returned HTML instead of JSON, it's the login page
        // served with a 200 status — not an authenticated API response.
        if (!contentType.includes('json')) {
          console.log('[browserLogin] Got HTML instead of JSON — not authenticated yet');
          return;
        }

        console.log(`[browserLogin] Authenticated session detected (JSESSIONID=${jsessionId.slice(0, 8)}...)`);

        // ── Exchange JSESSIONID for alias token & get username ──
        // Must happen now, while the login session is still alive.
        // After finish() the session is destroyed and cookies are gone.
        const authData = await exchangeCredentials(loginSession, serverUrl, jsessionId);
        finish(authData);
        return;
      } catch (err) {
        console.warn('[browserLogin] Session check error:', err);
      }
    }

    // Listen for JSESSIONID cookie changes. The first cookie is always the
    // anonymous session Tomcat creates on page load. After authentication,
    // session fixation regenerates the JSESSIONID — we detect this by
    // comparing against the first value we saw.
    function onCookieChanged(
      _event: Electron.Event,
      cookie: Electron.Cookie,
      _cause: string,
      removed: boolean,
    ): void {
      if (cookie.name !== 'JSESSIONID' || removed) return;

      const value = cookie.value ?? '';
      if (firstJsessionId === null) {
        firstJsessionId = value;
        console.log(`[browserLogin] Initial JSESSIONID (${value.slice(0, 8)}...), waiting for auth`);
        return;
      }

      if (value === firstJsessionId) return; // same cookie, no change

      console.log(`[browserLogin] JSESSIONID regenerated (${value.slice(0, 8)}...), checking auth`);
      checkForAuthenticatedSession();
    }
    loginSession.cookies.on('changed', onCookieChanged);

    // Also check after page loads — covers post-login redirects and
    // servers that don't do session fixation (JSESSIONID stays the same).
    // Skip the very first load (that's just the login page rendering).
    loginWindow.webContents.on('did-finish-load', () => {
      if (!initialLoadDone) {
        initialLoadDone = true;
        return;
      }
      checkForAuthenticatedSession();
    });

    // Handle user closing the login window
    loginWindow.on('closed', () => {
      finish(null, new Error('Login cancelled'));
    });

    // Navigate to the XNAT login page
    const baseUrl = serverUrl.replace(/\/+$/, '');
    const loginUrl = `${baseUrl}/app/template/Login.vm`;
    console.log(`[browserLogin] Opening login window: ${loginUrl}`);

    loginWindow.loadURL(loginUrl).then(() => {
      if (!resolved) {
        loginWindow.show();
      }
    }).catch((err) => {
      finish(null, new Error(`Failed to load login page: ${err.message}`));
    });
  });
}
