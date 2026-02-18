# Authentication

XNAT Workstation authenticates users by opening XNAT's own login page in an Electron BrowserWindow, then observing when XNAT sets an authenticated session cookie. This approach delegates all authentication logic to the XNAT server, supporting local accounts, LDAP, and OIDC providers without any provider-specific code in the app.

After login, credentials are held exclusively in the main process. The renderer never sees session IDs. All XNAT API calls from the renderer go through IPC to the main process, and Cornerstone's direct image fetches get auth injected transparently via Electron's webRequest interceptor.

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

## Login flow

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
| JSESSIONID | Auth for all XNAT API calls | Default session cookie jar |
| Server cookies (AWSALB, etc.) | Infrastructure cookies for load balancers | Default session cookie jar |

## How requests are authenticated

### Main process API calls (XnatClient)

`XnatClient.xfetch()` delegates to `session.defaultSession.fetch()`, which is Electron's Chromium-level fetch. It automatically includes cookies from the default session's cookie jar for matching domains — no manual Cookie header needed.

### Renderer REST API calls (IPC proxy)

The renderer calls `window.electronAPI.xnat.*` methods (e.g., `getProjects()`, `getScans()`). These are IPC invocations handled in `src/main/ipc/proxyHandlers.ts`, which call `XnatClient` methods. The renderer receives parsed JSON results — never raw credentials.

### Cornerstone WADO-URI fetches (webRequest interceptor)

Cornerstone3D fetches DICOM images directly via HTTP (wadouri scheme). These requests originate from the renderer's Chromium network stack and bypass IPC. The `sessionManager` installs a `webRequest.onBeforeSendHeaders` interceptor on the default session that:

1. Matches requests to `{serverUrl}/*`.
2. Injects a `Cookie` header with JSESSIONID + all server cookies via `client.buildAuthHeaders()`.

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
3. `XnatClient.disconnect()` invalidates the JSESSION on the server (`DELETE /data/JSESSION`) and clears all cookies from the default session's cookie jar.

## Known limitations

### Google OIDC

Google blocks sign-in from embedded browsers per [RFC 8252 Section 8.12](https://datatracker.ietf.org/doc/html/rfc8252#section-8.12). The BrowserWindow, despite using a full Chromium engine, is classified as an embedded user-agent because the host application has programmatic access to the window contents (DOM, cookies, network traffic, keystrokes). This means it could theoretically intercept user credentials — a risk that doesn't exist in a standalone browser with its own trusted UI chrome.

If an XNAT server uses Google as its OIDC provider, users will see Google's "sign-in is blocked" error. Supporting this would require a system-browser flow (`shell.openExternal()` to the user's default browser) with a callback mechanism (custom protocol handler or localhost redirect), which also requires XNAT server-side configuration.

### Single connection

Only one XNAT connection is active at a time. Calling `browserLogin()` while connected will disconnect the existing session first.

## Key files

| File | Role |
|---|---|
| `src/main/xnat/browserLogin.ts` | Opens login window, detects auth via cookie observation, retrieves username |
| `src/main/xnat/xnatClient.ts` | Holds JSESSIONID + server cookies, makes authenticated API calls |
| `src/main/xnat/sessionManager.ts` | Connection lifecycle, keepalive, webRequest interceptor, expiry notification |
| `src/main/ipc/proxyHandlers.ts` | IPC handlers that proxy renderer REST/DICOMweb calls through XnatClient |
| `src/preload/index.ts` | Context bridge exposing `window.electronAPI.xnat.*` to renderer |
| `src/renderer/stores/connectionStore.ts` | Zustand store wrapping IPC calls, listens for session expiry |
| `src/renderer/components/connection/LoginForm.tsx` | Login UI, recent connections, URL normalization |
