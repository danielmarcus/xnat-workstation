/**
 * Browser-based XNAT Login
 *
 * Opens XNAT's own login page in an Electron BrowserWindow, allowing the user
 * to authenticate via any method the server supports (local, LDAP, OIDC, etc.).
 * After successful login, extracts the JSESSIONID cookie set by XNAT.
 *
 * Detection strategy: Tomcat sets a JSESSIONID cookie immediately (even for
 * anonymous sessions), so we can't just check for cookie presence. Instead we
 * listen for cookie changes, then validate the current JSESSIONID against a
 * protected endpoint to confirm it's authenticated.
 *
 * XNAT uses AJAX-based login (XNAT.xhr.submit) which triggers Spring Security's
 * SessionFixationProtectionStrategy — the JSESSIONID is regenerated after
 * authentication. We react to the cookie-changed event to reliably capture the
 * post-fixation session ID.
 *
 * Uses an isolated session partition to avoid cookie/state bleed with the main window.
 *
 * Note: Google OIDC blocks sign-in from embedded browsers (per RFC 8252 §8.12)
 * because the host app has full access to the window contents and could intercept
 * credentials. If XNAT uses Google OIDC, users will need to authenticate via a
 * method that doesn't rely on Google's embedded-browser-restricted flow.
 */
import { BrowserWindow, session } from 'electron';

const LOGIN_PARTITION = 'xnat-login';
/** Auto-close the login window after this duration (ms) to prevent indefinite hangs. */
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * After authentication is confirmed, retrieve the username and collect
 * all cookies. All requests use session.fetch() so they go through the
 * same Chromium network stack as the BrowserWindow.
 *
 * IMPORTANT: The requests below can cause Tomcat to regenerate the
 * JSESSIONID via Set-Cookie. Chromium updates its cookie jar
 * automatically, but our caller's `jsessionId` variable becomes stale.
 * We re-read the cookie at the end to return the current value.
 */
async function exchangeCredentials(
  loginSession: Electron.Session,
  serverUrl: string,
  jsessionId: string,
): Promise<BrowserLoginResult> {
  let username = '';

  // Get the username via GET /xapi/users/username
  try {
    const resp = await loginSession.fetch(`${serverUrl}/xapi/users/username`);
    if (resp.ok) {
      const text = (await resp.text()).trim();
      if (text) {
        username = text;
        console.log(`[browserLogin] Username from /xapi/users/username: ${username}`);
      }
    }
  } catch {
    // Non-fatal
  }

  if (!username) {
    console.warn('[browserLogin] Could not determine username');
  }

  // Re-read ALL cookies — the request above may have caused Tomcat to
  // regenerate the JSESSIONID (Set-Cookie), and we also need ALB
  // sticky-session cookies (AWSALB, AWSALBCORS) for load-balanced servers.
  const url = new URL(serverUrl);
  const serverCookies: ServerCookie[] = [];
  let currentJsessionId = jsessionId;

  try {
    const allCookies = await loginSession.cookies.get({ domain: url.hostname });
    for (const c of allCookies) {
      serverCookies.push({
        name: c.name,
        value: c.value,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: c.sameSite as ServerCookie['sameSite'],
      });
      if (c.name === 'JSESSIONID' && c.value) {
        if (c.value !== jsessionId) {
          console.log(`[browserLogin] JSESSIONID changed during exchange: ${c.value.slice(0, 8)}... (was ${jsessionId.slice(0, 8)}...)`);
        }
        currentJsessionId = c.value;
      }
    }
    console.log(`[browserLogin] Transferring ${serverCookies.length} cookies: ${serverCookies.map(c => c.name).join(', ')}`);
  } catch {
    // Use original JSESSIONID if cookie read fails
  }

  return { jsessionId: currentJsessionId, username, serverCookies };
}

/** A server cookie to transfer between sessions. */
export interface ServerCookie {
  name: string;
  value: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: 'unspecified' | 'no_restriction' | 'lax' | 'strict';
}

/** Result from browser login — includes pre-fetched auth data. */
export interface BrowserLoginResult {
  jsessionId: string;
  username: string;
  /** All server cookies (JSESSIONID, ALB sticky-session cookies, etc.) */
  serverCookies: ServerCookie[];
}

/**
 * Open a BrowserWindow to the XNAT login page and wait for the user to authenticate.
 *
 * After authentication is detected, retrieves the username and collects all
 * cookies — using the login session's Chromium network stack (session.fetch),
 * which shares the cookie jar with the BrowserWindow. All network operations
 * must happen through the login session before it's destroyed.
 *
 * Times out after LOGIN_TIMEOUT_MS to prevent indefinite hangs.
 */
export async function openBrowserLogin(
  serverUrl: string,
): Promise<BrowserLoginResult> {
  // Validate URL scheme — only HTTP(S) allowed. The renderer auto-prepends
  // https://, but the main process must enforce this independently since
  // the URL is loaded into a BrowserWindow.
  const parsedUrl = new URL(serverUrl);
  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    throw new Error('Only HTTP(S) URLs are supported');
  }

  const loginSession = session.fromPartition(LOGIN_PARTITION);

  // Clear stale cookies/state from previous login attempts within
  // this app session. Must await — otherwise old cookies can be
  // detected before the page even loads.
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
        sandbox: true,
        partition: LOGIN_PARTITION,
      },
    });

    let resolved = false;
    // Track the first JSESSIONID value. We clear session storage at the
    // start, so the first cookie Tomcat sets is always an anonymous session.
    // After authentication, Spring Security's session fixation protection
    // regenerates the JSESSIONID to a new value — that's our signal.
    let firstJsessionId: string | null = null;

    // Auto-close after timeout to prevent indefinite hangs
    const timeoutId = setTimeout(() => {
      finish(null, new Error('Login timed out — please try again'));
    }, LOGIN_TIMEOUT_MS);

    function finish(result: BrowserLoginResult | null, error?: Error): void {
      if (resolved) return;
      resolved = true;

      clearTimeout(timeoutId);

      // Remove the cookie listener
      loginSession.cookies.removeListener('changed', onCookieChanged);

      // Clean up the window
      if (!loginWindow.isDestroyed()) {
        loginWindow.destroy();
      }

      // Clean up the session — log failures since stale cookies could
      // leak to subsequent login attempts within this app session
      loginSession.clearStorageData().catch((err) => {
        console.warn('[browserLogin] Failed to clear login session data:', err);
      });

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
        // (session.fetch), which shares the cookie jar with the BrowserWindow.
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

        // ── Get username & collect all cookies ──
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
