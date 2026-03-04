import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../../shared/ipcChannels';

const mocks = vi.hoisted(() => {
  const clientInstances: any[] = [];
  class MockXnatAuthError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'XnatAuthError';
    }
  }

  const XnatClient = vi.fn(function MockXnatClient(this: any, serverUrl: string) {
    this.serverUrl = serverUrl.replace(/\/+$/, '');
    this.currentUsername = '';
    this.isAuthenticated = true;
    this.setAuthFromBrowserLogin = vi.fn(async (opts: { username: string }) => {
      this.currentUsername = opts.username;
    });
    this.disconnect = vi.fn(async () => undefined);
    this.validateSession = vi.fn(async () => this.currentUsername || null);
    this.buildAuthHeaders = vi.fn(() => ({ Cookie: 'JSESSIONID=mock' }));
    this.clearCookies = vi.fn();
    this.markDisconnected = vi.fn(() => {
      this.isAuthenticated = false;
    });
    clientInstances.push(this);
  });

  const windows = [{ webContents: { send: vi.fn() } }, { webContents: { send: vi.fn() } }];
  return {
    XnatClient,
    XnatAuthError: MockXnatAuthError,
    clientInstances,
    openBrowserLogin: vi.fn(),
    windows,
    onBeforeSendHeaders: vi.fn(),
    onHeadersReceived: vi.fn(),
  };
});

vi.mock('./xnatClient', () => ({
  XnatClient: mocks.XnatClient,
  XnatAuthError: mocks.XnatAuthError,
}));

vi.mock('./browserLogin', () => ({
  openBrowserLogin: mocks.openBrowserLogin,
}));

vi.mock('electron', () => ({
  session: {
    defaultSession: {
      webRequest: {
        onBeforeSendHeaders: mocks.onBeforeSendHeaders,
        onHeadersReceived: mocks.onHeadersReceived,
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
    beforeSendHandler({ requestHeaders: { Accept: '*/*' } }, cb);
    expect(cb).toHaveBeenCalledWith({
      requestHeaders: {
        Accept: '*/*',
        Cookie: 'JSESSIONID=mock',
      },
    });

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(client.validateSession).toHaveBeenCalled();
  });

  it('overrides stale renderer cookie headers with active session cookies', async () => {
    vi.resetModules();
    const sessionManager = await import('./sessionManager');

    await sessionManager.browserLogin('https://xnat.example/');
    const beforeSendHandler = mocks.onBeforeSendHeaders.mock.calls[0][1];
    const cb = vi.fn();

    beforeSendHandler(
      {
        requestHeaders: {
          Accept: '*/*',
          Cookie: 'JSESSIONID=stale; AWSALB=old',
        },
      },
      cb,
    );

    expect(cb).toHaveBeenCalledWith({
      requestHeaders: {
        Accept: '*/*',
        Cookie: 'JSESSIONID=mock',
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
});
