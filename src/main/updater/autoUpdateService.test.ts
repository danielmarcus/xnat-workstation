import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../../shared/ipcChannels';

type Listener = (...args: any[]) => void;

function createFakeUpdater() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    checkForUpdates: vi.fn(async () => undefined),
    quitAndInstall: vi.fn(),
    on(event: string, listener: Listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)?.add(listener);
      return this;
    },
    removeListener(event: string, listener: Listener) {
      listeners.get(event)?.delete(listener);
      return this;
    },
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) {
        listener(...args);
      }
    },
    listenerCount(event: string) {
      return listeners.get(event)?.size ?? 0;
    },
  };
}

const sendMock = vi.fn();
const electronMocks = {
  app: {
    isPackaged: true,
    getVersion: vi.fn(() => '0.5.2'),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [
      {
        isDestroyed: () => false,
        webContents: {
          send: sendMock,
        },
      },
    ]),
  },
};

let createAutoUpdateService: (typeof import('./autoUpdateService'))['createAutoUpdateService'];

beforeAll(async () => {
  vi.doMock('electron', () => electronMocks);
  vi.doMock('electron-updater', () => ({
    autoUpdater: createFakeUpdater(),
  }));

  ({ createAutoUpdateService } = await import('./autoUpdateService'));
});

describe('autoUpdateService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    electronMocks.app.isPackaged = true;
  });

  it('schedules automatic checks when initialized in packaged builds', async () => {
    const updater = createFakeUpdater();
    const service = createAutoUpdateService(updater as any);

    service.initialize();
    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(true);

    await vi.advanceTimersByTimeAsync(3000);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);

    service.dispose();
    expect(updater.listenerCount('checking-for-update')).toBe(0);
  });

  it('tracks update lifecycle events and broadcasts status snapshots', () => {
    const updater = createFakeUpdater();
    const service = createAutoUpdateService(updater as any);
    service.initialize();

    updater.emit('update-available', { version: '0.5.3' });
    expect(service.getState().phase).toBe('downloading');
    expect(service.getState().availableVersion).toBe('0.5.3');

    updater.emit('download-progress', { percent: 42.4 });
    expect(service.getState().phase).toBe('downloading');
    expect(service.getState().downloadProgressPercent).toBeCloseTo(42.4);

    updater.emit('update-downloaded', { version: '0.5.3' });
    expect(service.getState().phase).toBe('downloaded');
    expect(service.getState().downloadedVersion).toBe('0.5.3');

    expect(sendMock).toHaveBeenCalledWith(
      IPC.UPDATER_STATUS,
      expect.objectContaining({
        phase: 'downloaded',
        downloadedVersion: '0.5.3',
      }),
    );

    service.dispose();
  });

  it('applies configuration updates and stops automatic checks when disabled', async () => {
    const updater = createFakeUpdater();
    const service = createAutoUpdateService(updater as any);
    service.initialize();

    const result = await service.configure({ enabled: false, autoDownload: false });
    expect(result.ok).toBe(true);
    expect(service.getState().enabled).toBe(false);
    expect(service.getState().autoDownload).toBe(false);
    expect(service.getState().phase).toBe('disabled');
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);

    await vi.advanceTimersByTimeAsync(3000);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();

    service.dispose();
  });

  it('returns unsupported errors for development builds', async () => {
    electronMocks.app.isPackaged = false;
    const updater = createFakeUpdater();
    const service = createAutoUpdateService(updater as any);

    const result = await service.checkForUpdates({ manual: true });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('packaged builds');
    expect(service.getState().phase).toBe('unsupported');
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it('only installs after an update has been downloaded', async () => {
    const updater = createFakeUpdater();
    const service = createAutoUpdateService(updater as any);
    service.initialize();

    await expect(service.quitAndInstall()).resolves.toEqual({
      ok: false,
      error: 'No downloaded update is ready to install.',
    });

    updater.emit('update-downloaded', { version: '0.5.3' });
    await expect(service.quitAndInstall()).resolves.toEqual({ ok: true });
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);

    service.dispose();
  });
});
