import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../../shared/ipcChannels';
import { createIpcMainMock } from '../../test/ipc/ipcMocks';

const ipcMainMock = createIpcMainMock();

const updateServiceMock = {
  getState: vi.fn(),
  configure: vi.fn(),
  checkForUpdates: vi.fn(),
  quitAndInstall: vi.fn(),
};

let registerUpdateHandlers: (typeof import('./updateHandlers'))['registerUpdateHandlers'];

beforeAll(async () => {
  vi.doMock('electron', () => ({
    ipcMain: ipcMainMock.ipcMain,
  }));

  vi.doMock('../updater/autoUpdateService', () => ({
    autoUpdateService: updateServiceMock,
  }));

  ({ registerUpdateHandlers } = await import('./updateHandlers'));
});

describe('registerUpdateHandlers', () => {
  beforeEach(() => {
    ipcMainMock.handlers.clear();
    ipcMainMock.listeners.clear();
    ipcMainMock.ipcMain.handle.mockClear();
    vi.clearAllMocks();
    updateServiceMock.getState.mockReturnValue({
      phase: 'idle',
      currentVersion: '0.5.2',
      enabled: true,
      autoDownload: true,
      isPackaged: true,
      availableVersion: null,
      downloadedVersion: null,
      downloadProgressPercent: null,
      lastCheckedAt: null,
      message: null,
      error: null,
    });
    updateServiceMock.configure.mockResolvedValue({
      ok: true,
      status: updateServiceMock.getState(),
    });
    updateServiceMock.checkForUpdates.mockResolvedValue({
      ok: true,
      status: updateServiceMock.getState(),
    });
    updateServiceMock.quitAndInstall.mockResolvedValue({ ok: true });
  });

  it('registers the updater IPC contract', () => {
    registerUpdateHandlers();

    const channels = ipcMainMock.ipcMain.handle.mock.calls.map((call) => call[0]);
    expect(channels).toEqual([
      IPC.UPDATER_GET_STATE,
      IPC.UPDATER_CONFIGURE,
      IPC.UPDATER_CHECK_FOR_UPDATES,
      IPC.UPDATER_QUIT_AND_INSTALL,
    ]);
  });

  it('forwards valid updater requests to the service', async () => {
    registerUpdateHandlers();

    await expect(ipcMainMock.invoke(IPC.UPDATER_GET_STATE)).resolves.toEqual(updateServiceMock.getState());
    await expect(
      ipcMainMock.invoke(IPC.UPDATER_CONFIGURE, { enabled: false, autoDownload: false }),
    ).resolves.toEqual({
      ok: true,
      status: updateServiceMock.getState(),
    });
    await expect(ipcMainMock.invoke(IPC.UPDATER_CHECK_FOR_UPDATES)).resolves.toEqual({
      ok: true,
      status: updateServiceMock.getState(),
    });
    await expect(ipcMainMock.invoke(IPC.UPDATER_QUIT_AND_INSTALL)).resolves.toEqual({ ok: true });

    expect(updateServiceMock.configure).toHaveBeenCalledWith({ enabled: false, autoDownload: false });
    expect(updateServiceMock.checkForUpdates).toHaveBeenCalledWith({ manual: true });
    expect(updateServiceMock.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid updater configuration payloads with a stable error shape', async () => {
    registerUpdateHandlers();

    await expect(
      ipcMainMock.invoke(IPC.UPDATER_CONFIGURE, { enabled: 'yes', autoDownload: false }),
    ).resolves.toEqual({
      ok: false,
      status: updateServiceMock.getState(),
      error: `Invalid payload for ${IPC.UPDATER_CONFIGURE}: expected boolean enabled and autoDownload values`,
    });

    expect(updateServiceMock.configure).not.toHaveBeenCalled();
  });
});
