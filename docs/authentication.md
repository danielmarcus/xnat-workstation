# Authentication

XNAT Workstation signs users in one of two ways:

- **Browser sign-in** (bearer mode), when the XNAT server publishes a discovery document naming its identity provider: the app runs OAuth 2.0 authorization code with PKCE in the user's own browser and calls XNAT with `Authorization: Bearer <access token>`. See [Browser sign-in](#browser-sign-in).
- **The login window** (cookie mode), everywhere else: the app opens XNAT's own login page in an Electron BrowserWindow, then observes when XNAT sets an authenticated session cookie. This delegates all authentication logic to the XNAT server, supporting local accounts, LDAP, and OIDC providers without any provider-specific code in the app.

The login form has one server field. On Sign In the app looks for the discovery document; if there is none, or it is invalid, or anything about it fails, the login window opens exactly as before.

After login, credentials are held exclusively in the main process. The renderer never sees session IDs or tokens. All XNAT API calls from the renderer go through IPC to the main process, and Cornerstone's direct image fetches get auth injected transparently via Electron's webRequest interceptor.

## Architecture overview

```
┌──────────────────────────────────────────────────────────┐
│ Renderer (React)                                         │
│                                                          │
│  connectionStore ──IPC──► sessionManager.browserLogin()  │
│  viewerStore     ──IPC──► proxyHandlers (REST, DICOMweb) │
│  Cornerstone     ──HTTP──► webRequest interceptor ──►    │
│                            (injects Cookie header)       │
└──────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────┐
│ Main Process                                             │
│                                                          │
│  sessionManager ── manages lifecycle, keepalive, expiry  │
│  xnatClient     ── holds JSESSIONID + server cookies;    │
│                    makes all API calls                   │
│  browserLogin   ── opens login window, detects auth,     │
│                    retrieves username                    │
└──────────────────────────────────────────────────────────┘
                              │
                              ▼
                         XNAT Server
```

## Browser sign-in

### Discovery

The server URL the user typed (origin plus path, no trailing slash) is the resource identifier. The app fetches `<origin>/.well-known/oauth-protected-resource<path>` ([RFC 9728](https://www.rfc-editor.org/rfc/rfc9728) section 3.1) with a 5 s timeout, no cookies, and redirects not followed. Example:

```json
{
  "resource": "https://xnat.example.org",
  "authorization_servers": ["https://idp.example.org/realms/xnat"],
  "xnat_api_url": "https://xnat-api.example.org",
  "xnat_web_url": "https://xnat.example.org",
  "xnat_clients": {
    "xnat-workstation": { "client_id": "xnat-workstation", "scope": "openid" },
    "default": { "client_id": "xnat-tools", "scope": "openid" }
  }
}
```

The document is used only if all of these hold; otherwise the login window opens:

- the response is `200` with a JSON body (an XNAT without discovery answers with a redirect to its login page);
- `resource` equals the typed URL, and the typed URL is https (plain http only on a loopback host, for local testing);
- `authorization_servers[0]` is an https URL (the issuer);
- `xnat_clients` has an `xnat-workstation` entry, else a `default` entry, with a `client_id` (`scope` defaults to `openid`);
- `xnat_api_url` and `xnat_web_url`, when present, are https and on the same registrable domain as the typed URL. Both default to `resource`. The check uses the Public Suffix List through [tldts](https://github.com/remusao/tldts), including its private section, so two tenants of one hosting suffix (for example two `github.io` sites) do not count as one site. The identity provider may be anywhere.

The app then fetches `<issuer>/.well-known/openid-configuration` and requires its `issuer` to match exactly and `code_challenge_methods_supported` to include `S256`.

### The browser flow

`authorizeInBrowser()` in `src/main/xnat/oidcLogin.ts`, all in the main process:

1. Generates a PKCE verifier (32 random bytes, base64url), its S256 challenge, and a random `state`.
2. Starts an HTTP listener on `127.0.0.1` only, on a random port, and uses `http://127.0.0.1:<port>/callback` as the redirect URI ([RFC 8252](https://www.rfc-editor.org/rfc/rfc8252) section 7.3; the client is registered with `http://127.0.0.1/callback`, and the provider accepts any port). The listener answers one request to `/callback` whose `Host` is that address, shows a short "Signed in" or "Sign-in failed" page, and closes. It gives up after 10 minutes, or when the user clicks Cancel in the login form.
3. Opens the authorization URL with `shell.openExternal`. The login form shows "Continue in your browser" with the identity provider's host.
4. Checks the callback: `state` must match; `iss` ([RFC 9207](https://www.rfc-editor.org/rfc/rfc9207)) must equal the issuer when present, and must be present when the provider advertises `authorization_response_iss_parameter_supported`; an `error` fails the sign-in.
5. Exchanges the code at the token endpoint with the verifier.

If the flow fails (timeout, a refused or mismatched response), the login form shows the error and a **Use the XNAT login window instead** button. Cancel returns to the form with no error.

### First sign-in

XNAT answers a valid token whose user has no XNAT account yet with `403` "no XNAT account is mapped to this OpenID identity" (when the server does not create accounts for bearer tokens). On that answer the app opens the login window once at `xnat_web_url`, which creates the account through the server's browser sign-in, discards that cookie session, and retries with the token.

### Bearer requests

`XnatClient` takes a token source (`BearerAuth`) and, in bearer mode, every request:

- goes to `xnat_api_url`;
- carries `Authorization: Bearer <access token>` and `User-Agent: XNATWorkstation/<version>`. XNAT checks its CSRF token on any request from a browser User-Agent, bearer requests included (it answers `500 InvalidCsrfException`, GETs too), and skips the check for a User-Agent it doesn't parse as a browser, which Electron's default is;
- sends no cookies (`credentials: 'omit'`): a session cookie would make XNAT ignore the token. No CSRF token is added;
- on `401`, refreshes the access token and retries once.

The webRequest interceptor does the same for the renderer's Cornerstone image fetches: for URLs under `xnat_api_url` only, it sets `Authorization` and the User-Agent and removes any `Cookie` header (`withBearerAuth()` in `sessionManager.ts`).

Links meant for a person's browser ("open in XNAT") use `xnat_web_url` (`connection.webUrl`).

### Tokens

Tokens stay in the main process (`OidcSession`, `src/main/xnat/oidcSession.ts`):

- The access token is held in memory and refreshed a minute before it expires, and once on a `401`. At most one refresh is in flight; a `401` for a token another request has already replaced does not refresh again. The renderer's own requests (image loads) get a token refreshed first when it is about to expire, so they are not sent with an expired one after the machine sleeps.
- The refresh token is kept in `sign-in-tokens.json` under the app's user data folder, encrypted with Electron `safeStorage`, keyed by issuer, client and API URL. Where `safeStorage` has no encryption (or uses the `basic_text` backend on Linux) it is kept in memory only. A stored refresh token lets the next Sign In to the same server connect without opening the browser. When that sign-in then fails, the stored token is revoked only if XNAT or the provider turned it down; a network error or a `5xx` keeps it for the next attempt.
- When the provider refuses a refresh (`invalid_grant`: the provider's session has ended), the stored token is deleted, the connection is torn down and the renderer is told the session expired, as in cookie mode.
- Sign-out revokes the refresh token at the provider's `revocation_endpoint` and deletes it. A refresh still in flight at sign-out is discarded when it returns, so it cannot store a new refresh token.

There is no keepalive in bearer mode; XNAT holds no session for these requests.

### Development override

Before a server publishes its document, an unpackaged build (`npm run dev`, or `npm run build` then `npx electron .`) reads it from `XNAT_WORKSTATION_DISCOVERY`, a path to a JSON file or an http(s) URL. Every check above still applies, including `resource` matching the typed URL. Packaged builds ignore the variable.

## Login flow (login window)

### 1. User initiates login

The renderer's `LoginForm` component collects a server URL and calls `window.electronAPI.xnat.browserLogin(serverUrl)` via IPC. The main process `sessionManager.browserLogin()` handles the rest.

### 2. BrowserWindow opens XNAT's login page

`openBrowserLogin()` in `src/main/xnat/browserLogin.ts`:

- Creates a BrowserWindow in an **isolated session partition** (`persist:xnat-login`) to prevent cookie contamination with the main app window.
- Clears any stale cookies/state from previous login attempts.
- Navigates to `{serverUrl}/app/template/Login.vm` — XNAT's built-in login page.
- The user authenticates directly with XNAT using whatever method the server supports.

### 3. Detecting successful authentication

The app does **not** scrape the login page or parse DOM content. Instead, it uses Electron's cookie change API to detect when XNAT has authenticated the user:

**Cookie change listener** (`session.cookies.on('changed', ...)`): Electron's Session API emits an event whenever the Chromium cookie jar is modified. The code listens for changes to the `JSESSIONID` cookie. Tomcat sets a JSESSIONID immediately for anonymous sessions, so the first value is recorded as the "pre-auth" baseline. When Spring Security's session fixation protection regenerates the JSESSIONID after successful login, the listener detects the new value and triggers validation.

The listener calls `checkForAuthenticatedSession()`, which validates the current JSESSIONID by calling `GET /data/projects?format=json&limit=1` through the login session's Chromium network stack. The response is checked for both HTTP status and Content-Type — some XNAT endpoints return 200 with an HTML login page for unauthenticated requests instead of a 401, so JSON Content-Type confirms a real API response.

### 4. Credential exchange

Once authentication is confirmed, `exchangeCredentials()` runs using the login session's `session.fetch()` (same Chromium network stack as the BrowserWindow, which some XNAT servers require):

1. **Username**: `GET /xapi/users/username` retrieves the authenticated user's username.

2. **Cookie collection**: All cookies for the XNAT domain are read from the login session's cookie jar. This captures the current JSESSIONID (which may have changed during the username request due to Tomcat's Set-Cookie behavior) plus any infrastructure cookies like ALB sticky-session cookies (AWSALB, AWSALBCORS) needed for load-balanced servers.

The login window is then destroyed and the login session's storage is cleared.

### 5. Session establishment

`sessionManager` passes the login result to `XnatClient.setAuthFromBrowserLogin()`, which syncs all cookies (JSESSIONID + infrastructure cookies) into Electron's **default session** cookie jar via `session.defaultSession.cookies.set()`.

The session manager then starts two background mechanisms:
- **Keepalive timer**: pings `GET /data/JSESSION` every 5 minutes to keep the session alive.
- **WebRequest interceptor**: injects auth into Cornerstone's direct HTTP requests (see below).

## Credential storage

All credentials are held in `XnatClient` in the main process. Nothing crosses the IPC boundary.

| Credential | Purpose | Storage |
|---|---|---|
| JSESSIONID | Auth for all XNAT API calls (cookie mode) | Default session cookie jar |
| Server cookies (AWSALB, etc.) | Infrastructure cookies for load balancers (cookie mode) | Default session cookie jar |
| Access token | Auth for all XNAT API calls (bearer mode) | Main-process memory |
| Refresh token | Renewing the access token (bearer mode) | `sign-in-tokens.json`, encrypted with `safeStorage`; memory only without it |

## How requests are authenticated

### Main process API calls (XnatClient)

`XnatClient.xfetch()` delegates to `session.defaultSession.fetch()`, which is Electron's Chromium-level fetch. It automatically includes cookies from the default session's cookie jar for matching domains — no manual Cookie header needed.

### Renderer REST API calls (IPC proxy)

The renderer calls `window.electronAPI.xnat.*` methods (e.g., `getProjects()`, `getScans()`). These are IPC invocations handled in `src/main/ipc/proxyHandlers.ts`, which call `XnatClient` methods. The renderer receives parsed JSON results — never raw credentials.

### Cornerstone WADO-URI fetches (webRequest interceptor)

Cornerstone3D fetches DICOM images directly via HTTP (wadouri scheme). These requests originate from the renderer's Chromium network stack and bypass IPC. The `sessionManager` installs a `webRequest.onBeforeSendHeaders` interceptor on the default session that:

1. Matches requests to `{serverUrl}/*`.
2. Injects a `Cookie` header with JSESSIONID + all server cookies from the cookie jar, or, in bearer mode, the `Authorization` and `User-Agent` headers (see [Bearer requests](#bearer-requests)).

A corresponding `onHeadersReceived` interceptor injects CORS and `Cross-Origin-Resource-Policy: cross-origin` headers on XNAT responses, which is required for COEP compliance (Cornerstone3D needs SharedArrayBuffer for volume rendering).

## Session lifecycle

### Keepalive

A 5-minute interval timer calls `client.validateSession()`, which hits `GET /data/JSESSION`. On success, the session stays alive on the server. On failure (401), it triggers a full teardown: the keepalive timer, webRequest interceptor, and client are all cleaned up, and the renderer is notified.

### Session expiry

If the JSESSION expires (server restart, network interruption, etc.) or any API call returns a 401:

1. `sessionManager` stops the keepalive timer, clears the webRequest interceptor, marks the client as disconnected, and nulls all references.
2. `IPC.XNAT_SESSION_EXPIRED` is broadcast to all renderer windows.
3. The renderer's `connectionStore` listener sets status to `disconnected` and the user sees the login form.

The same teardown runs whether expiry is detected by the keepalive timer or by an IPC handler calling `handleAuthFailure()`.

### Logout

`sessionManager.logout()`:

1. Stops the keepalive timer.
2. Clears the webRequest interceptor.
3. `XnatClient.disconnect()` invalidates the JSESSION on the server (`DELETE /data/JSESSION`) and clears all cookies from the default session's cookie jar. In bearer mode there is no JSESSION; the refresh token is revoked instead.

## Known limitations

### Google OIDC

Google blocks sign-in from embedded browsers per [RFC 8252 Section 8.12](https://datatracker.ietf.org/doc/html/rfc8252#section-8.12). The BrowserWindow, despite using a full Chromium engine, is classified as an embedded user-agent because the host application has programmatic access to the window contents (DOM, cookies, network traffic, keystrokes). This means it could theoretically intercept user credentials — a risk that doesn't exist in a standalone browser with its own trusted UI chrome.

If an XNAT server uses Google as its OIDC provider, users will see Google's "sign-in is blocked" error in the login window. Browser sign-in avoids this, but needs the server to publish the discovery document and a client registered with the identity provider.

### Single connection

Only one XNAT connection is active at a time. Calling `browserLogin()` while connected will disconnect the existing session first.

## Key files

| File | Role |
|---|---|
| `src/main/xnat/oidcDiscovery.ts` | Fetches and checks the discovery document and the provider configuration |
| `src/main/xnat/oidcLogin.ts` | Browser sign-in: PKCE, loopback listener, callback checks, token exchange |
| `src/main/xnat/oidcSession.ts` | Access and refresh tokens: single-flight refresh, encrypted storage, revocation |
| `src/main/xnat/browserLogin.ts` | Opens login window, detects auth via cookie observation, retrieves username |
| `src/main/xnat/xnatClient.ts` | Holds JSESSIONID + server cookies or the token source, makes authenticated API calls |
| `src/main/xnat/sessionManager.ts` | Chooses browser sign-in or the login window, connection lifecycle, keepalive, webRequest interceptor, expiry notification |
| `src/main/ipc/proxyHandlers.ts` | IPC handlers that proxy renderer REST/DICOMweb calls through XnatClient |
| `src/preload/index.ts` | Context bridge exposing `window.electronAPI.xnat.*` to renderer |
| `src/renderer/stores/connectionStore.ts` | Zustand store wrapping IPC calls, listens for session expiry |
| `src/renderer/components/connection/LoginForm.tsx` | Login UI, recent connections, URL normalization |
