import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const appHandlers: Record<string, (() => void) | undefined> = {};
  const windowInstances: any[] = [];

  const app = {
    name: '',
    isPackaged: false,
    getVersion: vi.fn(() => '0.5.2'),
    whenReady: vi.fn(() => Promise.resolve()),
    on: vi.fn((event: string, cb: () => void) => {
      appHandlers[event] = cb;
    }),
    quit: vi.fn(),
    dock: { setIcon: vi.fn() },
    setAboutPanelOptions: vi.fn(),
  };

  const BrowserWindow = vi.fn().mockImplementation((opts: unknown) => {
    const handlers: Record<string, (() => void) | undefined> = {};
    const instance = {
      opts,
      loadURL: vi.fn(() => Promise.resolve()),
      loadFile: vi.fn(() => Promise.resolve()),
      webContents: {
        openDevTools: vi.fn(),
      },
      on: vi.fn((event: string, cb: () => void) => {
        handlers[event] = cb;
      }),
      __handlers: handlers,
    };
    windowInstances.push(instance);
    return instance;
  });

  (BrowserWindow as any).getAllWindows = vi.fn(() => windowInstances);

  const Menu = {
    buildFromTemplate: vi.fn(() => ({ menu: true })),
    setApplicationMenu: vi.fn(),
  };

  const nativeImage = {
    createFromPath: vi.fn(() => ({ isEmpty: () => false })),
    createEmpty: vi.fn(() => ({ isEmpty: () => true })),
  };

  return {
    app,
    appHandlers,
    BrowserWindow,
    Menu,
    nativeImage,
    ipcMain: {
      handle: vi.fn(),
    },
    shell: {
      openExternal: vi.fn(async () => undefined),
    },
    windowInstances,
    registerAuthHandlers: vi.fn(),
    registerProxyHandlers: vi.fn(),
    registerExportHandlers: vi.fn(),
    registerUploadHandlers: vi.fn(),
    registerBackupHandlers: vi.fn(),
    registerDiagnosticsHandlers: vi.fn(),
    registerUpdateHandlers: vi.fn(),
    autoUpdateService: {
      initialize: vi.fn(),
      dispose: vi.fn(),
    },
    installMainLogCapture: vi.fn(),
  };
});

vi.mock('electron', () => ({
  app: mocks.app,
  BrowserWindow: mocks.BrowserWindow,
  Menu: mocks.Menu,
  nativeImage: mocks.nativeImage,
  ipcMain: mocks.ipcMain,
  shell: mocks.shell,
}));

vi.mock('./ipc/authHandlers', () => ({
  registerAuthHandlers: mocks.registerAuthHandlers,
}));

vi.mock('./ipc/proxyHandlers', () => ({
  registerProxyHandlers: mocks.registerProxyHandlers,
}));

vi.mock('./ipc/exportHandlers', () => ({
  registerExportHandlers: mocks.registerExportHandlers,
}));

vi.mock('./ipc/uploadHandlers', () => ({
  registerUploadHandlers: mocks.registerUploadHandlers,
}));

vi.mock('./ipc/backupHandlers', () => ({
  registerBackupHandlers: mocks.registerBackupHandlers,
}));

vi.mock('./ipc/diagnosticsHandlers', () => ({
  registerDiagnosticsHandlers: mocks.registerDiagnosticsHandlers,
}));

vi.mock('./ipc/updateHandlers', () => ({
  registerUpdateHandlers: mocks.registerUpdateHandlers,
}));

vi.mock('./updater/autoUpdateService', () => ({
  autoUpdateService: mocks.autoUpdateService,
}));

vi.mock('./diagnostics/mainLogBuffer', () => ({
  installMainLogCapture: mocks.installMainLogCapture,
}));

async function loadMainEntry(): Promise<void> {
  vi.resetModules();
  await import('./index');
  await Promise.resolve();
  await Promise.resolve();
}

describe('main/index bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.windowInstances.length = 0;
    mocks.app.isPackaged = false;
    (process as any).resourcesPath = '/tmp';
    process.env.VITE_DEV_SERVER_URL = 'http://localhost:7777';
  });

  it('registers handlers, builds menu, and creates dev BrowserWindow', async () => {
    await loadMainEntry();

    expect(mocks.registerAuthHandlers).toHaveBeenCalledTimes(1);
    expect(mocks.registerProxyHandlers).toHaveBeenCalledTimes(1);
    expect(mocks.registerExportHandlers).toHaveBeenCalledTimes(1);
    expect(mocks.registerUploadHandlers).toHaveBeenCalledTimes(1);
    expect(mocks.registerBackupHandlers).toHaveBeenCalledTimes(1);
    expect(mocks.registerDiagnosticsHandlers).toHaveBeenCalledTimes(1);
    expect(mocks.registerUpdateHandlers).toHaveBeenCalledTimes(1);
    expect(mocks.autoUpdateService.initialize).toHaveBeenCalledTimes(1);
    expect(mocks.installMainLogCapture).toHaveBeenCalledTimes(1);

    expect(mocks.app.name).toBe('XNAT');
    expect(mocks.Menu.buildFromTemplate).toHaveBeenCalledTimes(1);
    expect(mocks.Menu.setApplicationMenu).toHaveBeenCalledTimes(1);

    expect(mocks.BrowserWindow).toHaveBeenCalledTimes(1);
    const created = mocks.windowInstances[0];
    expect(created.loadURL).toHaveBeenCalledWith('http://localhost:7777/');
    expect(created.webContents.openDevTools).toHaveBeenCalledTimes(1);
  });

  it('creates packaged renderer window and responds to activate/window-close events', async () => {
    mocks.app.isPackaged = true;
    await loadMainEntry();

    expect(mocks.BrowserWindow).toHaveBeenCalledTimes(1);
    const created = mocks.windowInstances[0];
    expect(created.loadFile).toHaveBeenCalledTimes(1);

    // Exercise activation callback path.
    (mocks.BrowserWindow.getAllWindows as any).mockReturnValue([]);
    mocks.appHandlers.activate?.();
    expect(mocks.BrowserWindow).toHaveBeenCalledTimes(2);

    // Exercise window-all-closed path (platform-dependent quit behavior).
    mocks.appHandlers['window-all-closed']?.();
    if (process.platform !== 'darwin') {
      expect(mocks.app.quit).toHaveBeenCalledTimes(1);
    } else {
      expect(mocks.app.quit).not.toHaveBeenCalled();
    }

    mocks.appHandlers['before-quit']?.();
    expect(mocks.autoUpdateService.dispose).toHaveBeenCalledTimes(1);
  });
});
