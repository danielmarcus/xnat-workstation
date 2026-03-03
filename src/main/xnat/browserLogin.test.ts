import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  type CookieListener = (event: unknown, cookie: any, cause: string, removed: boolean) => void;

  const cookieListeners = new Set<CookieListener>();
  const cookiesGet = vi.fn(async () => []);
  const cookiesOn = vi.fn((event: string, listener: CookieListener) => {
    if (event === 'changed') cookieListeners.add(listener);
  });
  const cookiesRemoveListener = vi.fn((event: string, listener: CookieListener) => {
    if (event === 'changed') cookieListeners.delete(listener);
  });

  const loginSession = {
    clearStorageData: vi.fn(async () => undefined),
    fetch: vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => '',
    })),
    cookies: {
      get: cookiesGet,
      on: cookiesOn,
      removeListener: cookiesRemoveListener,
    },
  };

  const browserWindows: any[] = [];
  let nextLoadUrlError: Error | null = null;
  class BrowserWindowMock {
    public webContents = {
      stop: vi.fn(),
      executeJavaScript: vi.fn(async (script: string) => {
        if (script.includes('document.documentElement.scrollWidth')) return [900, 700];
        if (script.includes('window.csrfToken')) return 'csrf-from-window';
        return null;
      }),
    };

    public loadURL = vi.fn(async () => {
      if (nextLoadUrlError) {
        const err = nextLoadUrlError;
        nextLoadUrlError = null;
        throw err;
      }
      return undefined;
    });
    public destroy = vi.fn(() => {
      this._destroyed = true;
    });
    public hide = vi.fn();
    public show = vi.fn();
    public setContentSize = vi.fn();
    public center = vi.fn();
    public isDestroyed = vi.fn(() => this._destroyed);

    private listeners: Record<string, Array<() => void>> = {};
    private _destroyed = false;

    constructor() {
      browserWindows.push(this);
    }

    on(event: string, cb: () => void): void {
      this.listeners[event] ??= [];
      this.listeners[event].push(cb);
    }

    emit(event: string): void {
      for (const cb of this.listeners[event] ?? []) cb();
    }
  }

  return {
    sessionFromPartition: vi.fn(() => loginSession),
    loginSession,
    BrowserWindowMock,
    browserWindows,
    emitCookieChanged(cookie: any, removed = false): void {
      for (const listener of cookieListeners) {
        listener({}, cookie, 'explicit', removed);
      }
    },
    setNextLoadUrlError(error: Error | null): void {
      nextLoadUrlError = error;
    },
    clearCookieListeners(): void {
      cookieListeners.clear();
    },
  };
});

vi.mock('electron', () => ({
  session: {
    fromPartition: mocks.sessionFromPartition,
  },
  BrowserWindow: mocks.BrowserWindowMock,
}));

function mockJsonResponse(status = 200, contentType = 'application/json'): any {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    text: async () => '',
  };
}

async function waitForCreatedWindow(): Promise<any> {
  for (let i = 0; i < 5; i++) {
    if (mocks.browserWindows[0]) return mocks.browserWindows[0];
    await Promise.resolve();
  }
  throw new Error('BrowserWindow was not created');
}

describe('openBrowserLogin', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.clearCookieListeners();
    mocks.setNextLoadUrlError(null);
    mocks.browserWindows.length = 0;
    mocks.sessionFromPartition.mockReturnValue(mocks.loginSession);
    mocks.loginSession.clearStorageData.mockResolvedValue(undefined);
    mocks.loginSession.cookies.get.mockResolvedValue([]);
    mocks.loginSession.fetch.mockImplementation(async (url: string) => {
      if (url.includes('/data/projects')) return mockJsonResponse(200, 'application/json');
      if (url.includes('/xapi/users/username')) {
        return { ok: true, text: async () => 'dan' };
      }
      return { ok: true, text: async () => "<script>var csrfToken = 'csrf-from-fetch'</script>" };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects unsupported URL schemes before opening a BrowserWindow', async () => {
    const { openBrowserLogin } = await import('./browserLogin');
    await expect(openBrowserLogin('file:///tmp/xnat')).rejects.toThrow('Only HTTP(S) URLs are supported');
    expect(mocks.sessionFromPartition).not.toHaveBeenCalled();
  });

  it('completes login flow after JSESSIONID rotation and returns collected auth data', async () => {
    const { openBrowserLogin } = await import('./browserLogin');

    mocks.loginSession.cookies.get.mockImplementation(async ({ name }: { name?: string }) => {
      if (name === 'JSESSIONID') {
        return [{ name: 'JSESSIONID', value: 'sess-new', path: '/', secure: true, httpOnly: true, sameSite: 'lax' }];
      }
      return [
        { name: 'JSESSIONID', value: 'sess-new', path: '/', secure: true, httpOnly: true, sameSite: 'lax' },
        { name: 'AWSALB', value: 'alb', path: '/', secure: true, httpOnly: true, sameSite: 'lax' },
      ];
    });

    const resultPromise = openBrowserLogin('https://xnat.example/');
    await waitForCreatedWindow();

    // First cookie is anonymous baseline; second rotated cookie triggers auth check.
    mocks.emitCookieChanged({ name: 'JSESSIONID', value: 'sess-old' });
    mocks.emitCookieChanged({ name: 'JSESSIONID', value: 'sess-new' });

    const result = await resultPromise;
    const win = mocks.browserWindows[0];

    expect(result).toEqual(
      expect.objectContaining({
        jsessionId: 'sess-new',
        username: 'dan',
        csrfToken: 'csrf-from-window',
      }),
    );
    expect(result.serverCookies.map((c) => c.name)).toEqual(expect.arrayContaining(['JSESSIONID', 'AWSALB']));

    expect(win.webContents.stop).toHaveBeenCalledTimes(1);
    expect(win.hide).toHaveBeenCalledTimes(1);
    expect(win.show).toHaveBeenCalledTimes(1);
    expect(mocks.loginSession.clearStorageData).toHaveBeenCalledTimes(2);
    expect(mocks.loginSession.cookies.removeListener).toHaveBeenCalledWith(
      'changed',
      expect.any(Function),
    );
  });

  it('falls back to fetching root HTML when csrf token is unavailable in window context', async () => {
    const { openBrowserLogin } = await import('./browserLogin');

    mocks.loginSession.cookies.get.mockImplementation(async ({ name }: { name?: string }) => {
      if (name === 'JSESSIONID') return [{ name: 'JSESSIONID', value: 'sess-new' }];
      return [{ name: 'JSESSIONID', value: 'sess-new' }];
    });

    const resultPromise = openBrowserLogin('https://xnat.example');
    const win = await waitForCreatedWindow();
    win.webContents.executeJavaScript.mockImplementation(async (script: string) => {
      if (script.includes('document.documentElement.scrollWidth')) return [900, 700];
      if (script.includes('window.csrfToken')) throw new Error('window token unavailable');
      return null;
    });

    mocks.emitCookieChanged({ name: 'JSESSIONID', value: 'sess-old' });
    mocks.emitCookieChanged({ name: 'JSESSIONID', value: 'sess-new' });

    const result = await resultPromise;
    expect(result.csrfToken).toBe('csrf-from-fetch');
  });

  it('rejects with a load error when BrowserWindow cannot navigate to the login page', async () => {
    const { openBrowserLogin } = await import('./browserLogin');
    const failingLoad = new Error('dns unreachable');
    mocks.setNextLoadUrlError(failingLoad);

    await expect(openBrowserLogin('https://xnat.example')).rejects.toThrow(
      'Failed to load login page: dns unreachable',
    );
  });

  it('rejects when login times out without authenticated cookie rotation', async () => {
    vi.useFakeTimers();
    const { openBrowserLogin } = await import('./browserLogin');

    const promise = openBrowserLogin('https://xnat.example');
    const rejected = expect(promise).rejects.toThrow('Login timed out — please try again');
    await waitForCreatedWindow();
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    await rejected;
  });

  it('rejects when the login window is closed by the user', async () => {
    const { openBrowserLogin } = await import('./browserLogin');

    const promise = openBrowserLogin('https://xnat.example');
    const rejected = expect(promise).rejects.toThrow('Login cancelled');
    const win = await waitForCreatedWindow();
    win.emit('closed');
    await rejected;
  });
});
