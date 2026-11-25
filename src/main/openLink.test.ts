import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'path';
import { IPC } from '../shared/ipcChannels';
import { createIpcMainMock } from '../test/ipc/ipcMocks';

const mocks = vi.hoisted(() => {
  const appHandlers = new Map<string, (...args: any[]) => void>();
  return {
    appHandlers,
    app: {
      requestSingleInstanceLock: vi.fn(() => true),
      setAsDefaultProtocolClient: vi.fn(() => true),
      isReady: vi.fn(() => true),
      on: vi.fn((event: string, cb: (...args: any[]) => void) => { appHandlers.set(event, cb); }),
    },
  };
});

const ipcMainMock = createIpcMainMock();

vi.mock('electron', () => ({ app: mocks.app, ipcMain: ipcMainMock.ipcMain }));

const LINK = `xnat-workstation://open?server=${encodeURIComponent('https://xnat.example.org/')}&project=P1&session=XNAT_E1&scan=4`;
const REQUEST = { server: 'https://xnat.example.org', project: 'P1', session: 'XNAT_E1', scan: '4' };

function makeWindow(minimized = false) {
  return {
    isMinimized: vi.fn(() => minimized),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: { send: vi.fn() },
  };
}

async function load(window: ReturnType<typeof makeWindow> | null = makeWindow()) {
  vi.resetModules();
  const mod = await import('./openLink');
  const host = { getWindow: vi.fn(() => window as any), createWindow: vi.fn() };
  return { mod, host, window };
}

const take = () => ipcMainMock.invoke(IPC.OPEN_LINK_TAKE);

describe('main/openLink', () => {
  const argv = process.argv;
  const defaultApp = process.defaultApp;
  const e2e = process.env.E2E_TESTING;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appHandlers.clear();
    ipcMainMock.handlers.clear();
    mocks.app.requestSingleInstanceLock.mockReturnValue(true);
    mocks.app.isReady.mockReturnValue(true);
    process.argv = ['/Applications/XNAT Workstation.app/Contents/MacOS/XNAT Workstation'];
    Object.defineProperty(process, 'defaultApp', { value: undefined, configurable: true });
    delete process.env.E2E_TESTING;
  });

  afterEach(() => {
    process.argv = argv;
    Object.defineProperty(process, 'defaultApp', { value: defaultApp, configurable: true });
    if (e2e === undefined) delete process.env.E2E_TESTING; else process.env.E2E_TESTING = e2e;
  });

  it('a second instance gets no lock and registers nothing — the first one is handed its arguments', async () => {
    mocks.app.requestSingleInstanceLock.mockReturnValue(false);
    const { mod, host } = await load();
    expect(mod.initOpenLinks(host)).toBe(false);
    expect(mocks.app.setAsDefaultProtocolClient).not.toHaveBeenCalled();
    expect(mocks.app.on).not.toHaveBeenCalled();
  });

  it('a packaged app registers itself as the xnat-workstation:// handler', async () => {
    const { mod, host } = await load();
    expect(mod.initOpenLinks(host)).toBe(true);
    expect(mocks.app.setAsDefaultProtocolClient).toHaveBeenCalledWith('xnat-workstation');
  });

  it('under `electron .` it registers Electron with the app\'s path', async () => {
    Object.defineProperty(process, 'defaultApp', { value: true, configurable: true });
    process.argv = ['/repo/node_modules/electron/dist/electron', '.'];
    const { mod, host } = await load();
    mod.initOpenLinks(host);
    expect(mocks.app.setAsDefaultProtocolClient).toHaveBeenCalledWith('xnat-workstation', process.execPath, [path.resolve('.')]);
  });

  it('under a test harness it does not register — test runs never claim the scheme', async () => {
    process.env.E2E_TESTING = '1';
    const { mod, host } = await load();
    mod.initOpenLinks(host);
    expect(mocks.app.setAsDefaultProtocolClient).not.toHaveBeenCalled();
  });

  it('macOS: a link that arrives before ready is held for the renderer, without touching a window', async () => {
    mocks.app.isReady.mockReturnValue(false);
    const { mod, host, window } = await load();
    mod.initOpenLinks(host);
    const event = { preventDefault: vi.fn() };
    mocks.appHandlers.get('open-url')?.(event, LINK);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(host.getWindow).not.toHaveBeenCalled();
    expect(window?.webContents.send).not.toHaveBeenCalled();
    await expect(take()).resolves.toEqual(REQUEST);
    await expect(take()).resolves.toBeNull();
  });

  it('macOS: a link while running restores and focuses the window and tells the renderer', async () => {
    const { mod, host } = await load(makeWindow(true));
    mod.initOpenLinks(host);
    const window = host.getWindow();
    mocks.appHandlers.get('open-url')?.({ preventDefault: vi.fn() }, LINK);

    expect(window.restore).toHaveBeenCalled();
    expect(window.focus).toHaveBeenCalled();
    expect(window.webContents.send).toHaveBeenCalledWith(IPC.OPEN_LINK_RECEIVED);
    await expect(take()).resolves.toEqual(REQUEST);
  });

  it('with every window closed (macOS) a link opens a new one, whose renderer takes it', async () => {
    const { mod, host } = await load(null);
    mod.initOpenLinks(host);
    mocks.appHandlers.get('open-url')?.({ preventDefault: vi.fn() }, LINK);
    expect(host.createWindow).toHaveBeenCalledTimes(1);
    await expect(take()).resolves.toEqual(REQUEST);
  });

  it('Windows/Linux: the link a second launch carries reaches this instance', async () => {
    const { mod, host, window } = await load();
    mod.initOpenLinks(host);
    mocks.appHandlers.get('second-instance')?.({}, ['C:\\XNAT Workstation.exe', '--allow-file-access-from-files', LINK], 'C:\\');
    expect(window?.focus).toHaveBeenCalled();
    expect(window?.webContents.send).toHaveBeenCalledWith(IPC.OPEN_LINK_RECEIVED);
    await expect(take()).resolves.toEqual(REQUEST);
  });

  it('a second launch with no link just brings the window forward', async () => {
    const { mod, host, window } = await load();
    mod.initOpenLinks(host);
    mocks.appHandlers.get('second-instance')?.({}, ['C:\\XNAT Workstation.exe'], 'C:\\');
    expect(window?.focus).toHaveBeenCalled();
    expect(window?.webContents.send).not.toHaveBeenCalled();
    await expect(take()).resolves.toBeNull();
  });

  it('Windows/Linux: the link the app was launched with is held for the renderer', async () => {
    mocks.app.isReady.mockReturnValue(false);
    process.argv = ['/opt/XNAT Workstation/xnat-workstation', LINK];
    const { mod, host } = await load();
    mod.initOpenLinks(host);
    await expect(take()).resolves.toEqual(REQUEST);
  });

  it('an invalid link is ignored: nothing is held, no window is touched, and the link is not logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { mod, host, window } = await load();
    mod.initOpenLinks(host);
    const bad = `xnat-workstation://open?server=${encodeURIComponent('http://evil.example')}&project=P1&session=SECRET_E1`;
    mocks.appHandlers.get('open-url')?.({ preventDefault: vi.fn() }, bad);

    expect(window?.focus).not.toHaveBeenCalled();
    expect(window?.webContents.send).not.toHaveBeenCalled();
    await expect(take()).resolves.toBeNull();
    expect(warn.mock.calls.flat().join(' ')).not.toContain('SECRET_E1');
    expect(warn.mock.calls.flat().join(' ')).not.toContain('evil.example');
    warn.mockRestore();
  });

  it('only the latest link is held', async () => {
    const { mod, host } = await load();
    mod.initOpenLinks(host);
    mocks.appHandlers.get('open-url')?.({ preventDefault: vi.fn() }, LINK);
    mocks.appHandlers.get('open-url')?.({ preventDefault: vi.fn() }, LINK.replace('XNAT_E1', 'XNAT_E2'));
    await expect(take()).resolves.toEqual({ ...REQUEST, session: 'XNAT_E2' });
    await expect(take()).resolves.toBeNull();
  });

  it('under a test harness the off-screen window is not shown or focused, but still told', async () => {
    process.env.E2E_TESTING = '1';
    const { mod, host, window } = await load();
    mod.initOpenLinks(host);
    mocks.appHandlers.get('open-url')?.({ preventDefault: vi.fn() }, LINK);
    expect(window?.show).not.toHaveBeenCalled();
    expect(window?.focus).not.toHaveBeenCalled();
    expect(window?.webContents.send).toHaveBeenCalledWith(IPC.OPEN_LINK_RECEIVED);
  });
});
