import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../../shared/ipcChannels';

const mocks = vi.hoisted(() => {
  const clientInstances: any[] = [];
  const currentUserProfile = {
    firstName: undefined as string | undefined,
    lastName: undefined as string | undefined,
  };
  class MockXnatAuthError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'XnatAuthError';
    }
  }

  const XnatClient = vi.fn(function MockXnatClient(this: any, serverUrl: string, bearer?: unknown) {
    this.serverUrl = serverUrl.replace(/\/+$/, '');
    this.currentUsername = '';
    this.isAuthenticated = true;
    this.setAuthFromBrowserLogin = vi.fn(async (opts: { username: string }) => {
      this.currentUsername = opts.username;
    });
    this.disconnect = vi.fn(async () => undefined);
    this.getCurrentUserProfile = vi.fn(async () => ({ ...currentUserProfile }));
    this.validateSession = vi.fn(async () => this.currentUsername || null);
    this.clearCookies = vi.fn();
    this.markDisconnected = vi.fn(() => {
      this.isAuthenticated = false;
    });
    this.bearer = bearer;
    this.rawRequest = vi.fn(async () => usernameResponses.shift() ?? new Response('dan', { status: 200 }));
    this.setBearerUsername = vi.fn((username: string) => {
      this.currentUsername = username;
    });
    clientInstances.push(this);
  });
  const usernameResponses: Response[] = [];

  const windows = [{ webContents: { send: vi.fn() }, focus: vi.fn() }, { webContents: { send: vi.fn() }, focus: vi.fn() }];
  return {
    XnatClient,
    XnatAuthError: MockXnatAuthError,
    clientInstances,
    currentUserProfile,
    openBrowserLogin: vi.fn(),
    windows,
    onBeforeSendHeaders: vi.fn(),
    onHeadersReceived: vi.fn(),
    discoverSignIn: vi.fn(async () => null as unknown),
    authorizeInBrowser: vi.fn(),
    fetch: vi.fn(async () => new Response('', { status: 200 })),
    usernameResponses,
  };
});

vi.mock('./oidcDiscovery', () => ({
  discoverSignIn: mocks.discoverSignIn,
}));

vi.mock('./oidcLogin', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./oidcLogin')>()),
  authorizeInBrowser: mocks.authorizeInBrowser,
}));

vi.mock('./xnatClient', () => ({
  XnatClient: mocks.XnatClient,
  XnatAuthError: mocks.XnatAuthError,
  NON_BROWSER_USER_AGENT: 'XNATWorkstation/test',
  summarizeErrorBody: (body: string) => body,
}));

vi.mock('./browserLogin', () => ({
  openBrowserLogin: mocks.openBrowserLogin,
}));

vi.mock('electron', () => ({
  app: { isPackaged: true, getPath: () => '/tmp' },
  shell: { openExternal: vi.fn(async () => undefined) },
  safeStorage: { isEncryptionAvailable: () => false },
  session: {
    defaultSession: {
      fetch: mocks.fetch,
      webRequest: {
        onBeforeSendHeaders: mocks.onBeforeSendHeaders,
        onHeadersReceived: mocks.onHeadersReceived,
      },
      cookies: {
        get: vi.fn(async () => []),
      },
    },
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => mocks.windows),
  },
}));

describe('sessionManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clientInstances.length = 0;
    mocks.usernameResponses.length = 0;
    mocks.discoverSignIn.mockResolvedValue(null);
    mocks.currentUserProfile.firstName = undefined;
    mocks.currentUserProfile.lastName = undefined;
    mocks.openBrowserLogin.mockResolvedValue({
      jsessionId: 'jsession',
      username: 'dan',
      serverCookies: [],
      csrfToken: null,
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('logs in via browser flow, wires interceptors, and runs keepalive', async () => {
    vi.resetModules();
    const sessionManager = await import('./sessionManager');

    const result = await sessionManager.browserLogin('https://xnat.example/');
    expect(result.success).toBe(true);
    expect(result.connection?.serverUrl).toBe('https://xnat.example');
    expect(result.connection?.username).toBe('dan');
    expect(sessionManager.isConnected()).toBe(true);
    expect(mocks.openBrowserLogin).toHaveBeenCalledWith('https://xnat.example/');

    const client = mocks.clientInstances[0];
    expect(client.setAuthFromBrowserLogin).toHaveBeenCalledWith({
      jsessionId: 'jsession',
      username: 'dan',
      serverCookies: [],
      csrfToken: null,
    });
    expect(client.getCurrentUserProfile).toHaveBeenCalledTimes(1);
    expect(mocks.onBeforeSendHeaders).toHaveBeenCalledWith(
      { urls: ['https://xnat.example/*'] },
      expect.any(Function),
    );
    expect(mocks.onHeadersReceived).toHaveBeenCalledWith(
      { urls: ['https://xnat.example/*'] },
      expect.any(Function),
    );

    const beforeSendHandler = mocks.onBeforeSendHeaders.mock.calls[0][1];
    const cb = vi.fn();
    beforeSendHandler({ url: 'https://xnat.example/wado', requestHeaders: { Accept: '*/*' } }, cb);
    // Handler is async (reads from cookie jar) — flush microtasks
    await vi.advanceTimersByTimeAsync(0);
    expect(cb).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(client.validateSession).toHaveBeenCalled();
  });

  it('includes optional first and last name in connection info when the profile lookup succeeds', async () => {
    mocks.currentUserProfile.firstName = 'Jane';
    mocks.currentUserProfile.lastName = 'Doe';

    vi.resetModules();
    const sessionManager = await import('./sessionManager');

    const result = await sessionManager.browserLogin('https://xnat.example/');
    expect(result.connection).toMatchObject({
      username: 'dan',
      firstName: 'Jane',
      lastName: 'Doe',
    });
  });

  it('injects cookies from the jar on renderer requests', async () => {
    vi.resetModules();
    const { session } = await import('electron');
    const cookieGetMock = session.defaultSession.cookies.get as ReturnType<typeof vi.fn>;
    cookieGetMock.mockResolvedValue([
      { name: 'JSESSIONID', value: 'J1' },
      { name: 'AWSALB', value: 'alb-current' },
    ]);

    const sessionManager = await import('./sessionManager');
    await sessionManager.browserLogin('https://xnat.example/');
    const beforeSendHandler = mocks.onBeforeSendHeaders.mock.calls[0][1];
    const cb = vi.fn();

    beforeSendHandler(
      {
        url: 'https://xnat.example/wado?objectUID=1.2.3',
        requestHeaders: { Accept: '*/*' },
      },
      cb,
    );

    // Handler is async (reads from cookie jar) — flush microtasks
    await vi.advanceTimersByTimeAsync(0);

    expect(cb).toHaveBeenCalledWith({
      requestHeaders: {
        Accept: '*/*',
        Cookie: 'JSESSIONID=J1; AWSALB=alb-current',
      },
    });
  });

  it('validateSession reports valid/invalid correctly and logout tears down state', async () => {
    vi.resetModules();
    const sessionManager = await import('./sessionManager');

    expect(await sessionManager.validateSession()).toEqual({ valid: false });

    await sessionManager.browserLogin('https://xnat.example');
    const client = mocks.clientInstances[0];
    client.validateSession.mockResolvedValueOnce('dan');
    await expect(sessionManager.validateSession()).resolves.toEqual(
      expect.objectContaining({
        valid: true,
        username: 'dan',
      }),
    );

    client.validateSession.mockResolvedValueOnce(null);
    await expect(sessionManager.validateSession()).resolves.toEqual({ valid: false });

    await sessionManager.logout();
    expect(client.disconnect).toHaveBeenCalledTimes(1);
    expect(client.clearCookies).toHaveBeenCalledTimes(1);
    expect(client.markDisconnected).toHaveBeenCalledTimes(1);
    expect(mocks.onBeforeSendHeaders).toHaveBeenLastCalledWith(null);
    expect(mocks.onHeadersReceived).toHaveBeenLastCalledWith(null);
    expect(sessionManager.getConnectionInfo()).toBeNull();
    expect(sessionManager.getClient()).toBeNull();
    expect(sessionManager.isConnected()).toBe(false);
  });

  it('tells listeners when the connection starts and ends (extensions re-check their licences)', async () => {
    vi.resetModules();
    const sessionManager = await import('./sessionManager');
    const seen: Array<string | null> = [];
    const off = sessionManager.onConnectionChange((info) => seen.push(info ? info.username : null));
    await sessionManager.browserLogin('https://xnat.example');
    await sessionManager.logout();
    await sessionManager.logout(); // already out: no change, no call
    off();
    await sessionManager.browserLogin('https://xnat.example');
    expect(seen).toEqual([expect.any(String), null]);
  });

  it('handles auth failures once and broadcasts session-expired', async () => {
    vi.resetModules();
    const sessionManager = await import('./sessionManager');

    await sessionManager.browserLogin('https://xnat.example');
    const client = mocks.clientInstances[0];
    const err = new mocks.XnatAuthError('401 Unauthorized');

    sessionManager.handleAuthFailure(err);
    sessionManager.handleAuthFailure(err);

    for (const win of mocks.windows) {
      expect(win.webContents.send).toHaveBeenCalledWith(IPC.XNAT_SESSION_EXPIRED);
      expect(win.webContents.send).toHaveBeenCalledTimes(1);
    }
    expect(client.clearCookies).toHaveBeenCalledTimes(1);
    expect(client.markDisconnected).toHaveBeenCalledTimes(1);
    expect(sessionManager.getConnectionInfo()).toBeNull();
  });

  it('expires session from keepalive and disconnects automatically', async () => {
    vi.resetModules();
    const sessionManager = await import('./sessionManager');
    await sessionManager.browserLogin('https://xnat.example');

    const client = mocks.clientInstances[0];
    client.validateSession.mockResolvedValue(null);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    for (const win of mocks.windows) {
      expect(win.webContents.send).toHaveBeenCalledWith(IPC.XNAT_SESSION_EXPIRED);
    }
    expect(client.clearCookies).toHaveBeenCalledTimes(1);
    expect(client.markDisconnected).toHaveBeenCalledTimes(1);
    expect(sessionManager.isConnected()).toBe(false);
  });

  it('sends current ALB cookies from jar, not stale login-time cookies', async () => {
    // Simulates the ALB refreshing its sticky cookie after login.
    // The interceptor must read from the jar (which has the refreshed cookie)
    // rather than an in-memory snapshot from login time.
    vi.resetModules();
    const { session } = await import('electron');
    const cookieGetMock = session.defaultSession.cookies.get as ReturnType<typeof vi.fn>;

    const sessionManager = await import('./sessionManager');
    await sessionManager.browserLogin('https://xnat.example/');
    const beforeSendHandler = mocks.onBeforeSendHeaders.mock.calls[0][1];

    // First request: jar has login-time cookies
    cookieGetMock.mockResolvedValueOnce([
      { name: 'JSESSIONID', value: 'J1' },
      { name: 'AWSALB', value: 'alb-from-login' },
    ]);
    const cb1 = vi.fn();
    beforeSendHandler(
      { url: 'https://xnat.example/wado?objectUID=1', requestHeaders: {} },
      cb1,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(cb1).toHaveBeenCalledWith({
      requestHeaders: { Cookie: 'JSESSIONID=J1; AWSALB=alb-from-login' },
    });

    // Second request: jar now has ALB cookie refreshed by a prior response
    cookieGetMock.mockResolvedValueOnce([
      { name: 'JSESSIONID', value: 'J1' },
      { name: 'AWSALB', value: 'alb-refreshed-by-server' },
    ]);
    const cb2 = vi.fn();
    beforeSendHandler(
      { url: 'https://xnat.example/wado?objectUID=2', requestHeaders: {} },
      cb2,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(cb2).toHaveBeenCalledWith({
      requestHeaders: { Cookie: 'JSESSIONID=J1; AWSALB=alb-refreshed-by-server' },
    });
  });

  it('passes Set-Cookie through so ALB routing stays current', async () => {
    vi.resetModules();
    const sessionManager = await import('./sessionManager');
    await sessionManager.browserLogin('https://xnat.example/');

    const headerHandler = mocks.onHeadersReceived.mock.calls[0][1];
    const cb = vi.fn();

    // Simulate a response with ALB + JSESSIONID Set-Cookie headers
    headerHandler(
      {
        responseHeaders: {
          'Content-Type': ['application/dicom'],
          'Set-Cookie': [
            'AWSALB=new-alb-value; Path=/; Expires=Thu, 01 Jan 2099 00:00:00 GMT',
            'JSESSIONID=J1; Path=/; Secure',
          ],
        },
      },
      cb,
    );

    const result = cb.mock.calls[0][0].responseHeaders;
    // All Set-Cookie headers pass through (single source of truth = jar)
    expect(result['Set-Cookie']).toEqual([
      'AWSALB=new-alb-value; Path=/; Expires=Thu, 01 Jan 2099 00:00:00 GMT',
      'JSESSIONID=J1; Path=/; Secure',
    ]);
    // CORS headers injected
    expect(result['Access-Control-Allow-Origin']).toEqual(['*']);
    expect(result['Cross-Origin-Resource-Policy']).toEqual(['cross-origin']);
  });
});

describe('sessionManager browser sign-in', () => {
  const config = {
    resource: 'https://xnat.example.org',
    issuer: 'https://idp.example.org/realms/r',
    clientId: 'xnat-workstation',
    scope: 'openid',
    apiUrl: 'https://xnat-api.example.org',
    webUrl: 'https://xnat.example.org',
    authorizationEndpoint: 'https://idp.example.org/auth',
    tokenEndpoint: 'https://idp.example.org/token',
    revocationEndpoint: 'https://idp.example.org/revoke',
    issRequired: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clientInstances.length = 0;
    mocks.usernameResponses.length = 0;
    mocks.discoverSignIn.mockResolvedValue(config);
    mocks.authorizeInBrowser.mockResolvedValue({ accessToken: 'AT1', refreshToken: 'RT1', expiresIn: 300 });
    mocks.openBrowserLogin.mockResolvedValue({ jsessionId: 'j', username: 'dan', serverCookies: [], csrfToken: null });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the browser flow when the server publishes a document, in bearer mode against the API URL', async () => {
    vi.resetModules();
    const sessionManager = await import('./sessionManager');

    const result = await sessionManager.browserLogin('https://xnat.example.org');

    expect(result).toMatchObject({
      success: true,
      connection: { serverUrl: 'https://xnat-api.example.org', webUrl: 'https://xnat.example.org', authMode: 'bearer', username: 'dan' },
    });
    expect(mocks.openBrowserLogin).not.toHaveBeenCalled();
    expect(mocks.XnatClient).toHaveBeenCalledWith('https://xnat-api.example.org', expect.anything());
    for (const win of mocks.windows) {
      expect(win.webContents.send).toHaveBeenCalledWith(IPC.XNAT_LOGIN_PROGRESS, { stage: 'browser', host: 'idp.example.org' });
    }

    const beforeSendHandler = mocks.onBeforeSendHeaders.mock.calls[0][1];
    const cb = vi.fn();
    beforeSendHandler({ url: 'https://xnat-api.example.org/data/files/1.dcm', requestHeaders: { Cookie: 'JSESSIONID=x' } }, cb);
    expect(cb).toHaveBeenCalledWith({ requestHeaders: { Authorization: 'Bearer AT1', 'User-Agent': 'XNATWorkstation/test' } });
  });

  it('skips discovery when asked for the login window', async () => {
    vi.resetModules();
    const sessionManager = await import('./sessionManager');

    const result = await sessionManager.browserLogin('https://xnat.example.org', { useLoginWindow: true });

    expect(result.success).toBe(true);
    expect(mocks.discoverSignIn).not.toHaveBeenCalled();
    expect(mocks.openBrowserLogin).toHaveBeenCalledWith('https://xnat.example.org');
    expect(result.connection?.authMode).toBeUndefined();
  });

  it('opens the login window once for an identity with no XNAT account, then signs in with the token', async () => {
    mocks.usernameResponses.push(
      new Response('no XNAT account is mapped to this OpenID identity', { status: 403 }),
      new Response('newuser', { status: 200 }),
    );
    vi.resetModules();
    const sessionManager = await import('./sessionManager');

    const result = await sessionManager.browserLogin('https://xnat.example.org');

    expect(mocks.openBrowserLogin).toHaveBeenCalledTimes(1);
    expect(mocks.openBrowserLogin).toHaveBeenCalledWith('https://xnat.example.org');
    expect(result).toMatchObject({ success: true, connection: { authMode: 'bearer', username: 'newuser' } });
  });

  it('reports a failed browser flow with the login window as the way out', async () => {
    const { OidcLoginError } = await import('./oidcLogin');
    mocks.authorizeInBrowser.mockRejectedValue(new OidcLoginError('Sign-in timed out.'));
    vi.resetModules();
    const sessionManager = await import('./sessionManager');

    const result = await sessionManager.browserLogin('https://xnat.example.org');

    expect(result).toEqual({ success: false, error: 'Sign-in timed out.', canUseLoginWindow: true });
    expect(mocks.openBrowserLogin).not.toHaveBeenCalled();
    expect(sessionManager.isConnected()).toBe(false);
  });

  it('cancels a browser sign-in that is waiting', async () => {
    mocks.authorizeInBrowser.mockImplementation(async (_config: unknown, deps: { signal: AbortSignal }) => {
      const { OidcLoginError } = await import('./oidcLogin');
      await new Promise((_resolve, reject) => {
        deps.signal.addEventListener('abort', () => reject(new OidcLoginError('Login cancelled', true)));
      });
    });
    vi.resetModules();
    const sessionManager = await import('./sessionManager');

    const pending = sessionManager.browserLogin('https://xnat.example.org');
    await vi.advanceTimersByTimeAsync(0);
    sessionManager.cancelLogin();

    await expect(pending).resolves.toEqual({ success: false, error: 'Login cancelled' });
  });

  it('revokes the refresh token on sign-out and sends no JSESSION request', async () => {
    vi.resetModules();
    const sessionManager = await import('./sessionManager');
    await sessionManager.browserLogin('https://xnat.example.org');

    await sessionManager.logout();

    const revoke = mocks.fetch.mock.calls.find(([url]) => url === 'https://idp.example.org/revoke');
    expect(revoke).toBeDefined();
    expect(String((revoke![1] as RequestInit).body)).toContain('token=RT1');
    expect(sessionManager.isConnected()).toBe(false);
  });

  it('disconnects when a scheduled refresh finds the session over', async () => {
    mocks.fetch.mockResolvedValue(new Response('{"error":"invalid_grant"}', { status: 400 }));
    vi.resetModules();
    const sessionManager = await import('./sessionManager');
    await sessionManager.browserLogin('https://xnat.example.org');

    await vi.advanceTimersByTimeAsync(240 * 1000);

    expect(sessionManager.isConnected()).toBe(false);
    for (const win of mocks.windows) {
      expect(win.webContents.send).toHaveBeenCalledWith(IPC.XNAT_SESSION_EXPIRED);
    }
  });
});

describe('withBearerAuth', () => {
  it('sets the token and a non-browser User-Agent, and drops cookies, only for the API origin', async () => {
    const { withBearerAuth } = await import('./sessionManager');
    const api = 'https://xnat-api.example.org';
    const headers = { Accept: '*/*', cookie: 'JSESSIONID=x', 'user-agent': 'Mozilla/5.0' };

    expect(withBearerAuth(`${api}/data/files/a.dcm`, api, headers, 'T')).toEqual({
      Accept: '*/*',
      Authorization: 'Bearer T',
      'User-Agent': 'XNATWorkstation/test',
    });
    for (const other of [
      'https://xnat-api.example.org.attacker.example/data',
      'https://xnat-api.example.org:8443/data',
      'http://xnat-api.example.org/data',
      'https://xnat.example.org/data',
      'https://xnat-api.example.org@attacker.example/data',
    ]) {
      expect(withBearerAuth(other, api, headers, 'T')).toBe(headers);
    }
  });
});
