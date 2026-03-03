import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../../shared/ipcChannels';
import { createIpcMainMock } from '../../test/ipc/ipcMocks';

const ipcMainMock = createIpcMainMock();

const sessionManagerMock = {
  browserLogin: vi.fn(),
  logout: vi.fn(),
  validateSession: vi.fn(),
  getConnectionInfo: vi.fn(),
};

let registerAuthHandlers: (typeof import('./authHandlers'))['registerAuthHandlers'];

beforeAll(async () => {
  vi.doMock('electron', () => ({
    ipcMain: ipcMainMock.ipcMain,
  }));

  vi.doMock('../xnat/sessionManager', () => sessionManagerMock);

  ({ registerAuthHandlers } = await import('./authHandlers'));
});

describe('registerAuthHandlers', () => {
  beforeEach(() => {
    ipcMainMock.handlers.clear();
    ipcMainMock.listeners.clear();
    ipcMainMock.ipcMain.handle.mockClear();
    vi.clearAllMocks();
  });

  it('registers expected auth IPC channels', () => {
    registerAuthHandlers();

    const channels = ipcMainMock.ipcMain.handle.mock.calls.map((call) => call[0]);
    expect(channels).toEqual([
      IPC.XNAT_BROWSER_LOGIN,
      IPC.XNAT_LOGOUT,
      IPC.XNAT_VALIDATE,
      IPC.XNAT_GET_CONNECTION,
    ]);
  });

  it('invokes session manager for each auth action', async () => {
    sessionManagerMock.browserLogin.mockResolvedValue({ success: true });
    sessionManagerMock.logout.mockResolvedValue(undefined);
    sessionManagerMock.validateSession.mockResolvedValue({ valid: true });
    sessionManagerMock.getConnectionInfo.mockResolvedValue({ serverUrl: 'https://xnat.example.org' });
    registerAuthHandlers();

    await expect(ipcMainMock.invoke(IPC.XNAT_BROWSER_LOGIN, 'https://xnat.example.org')).resolves.toEqual({
      success: true,
    });
    await expect(ipcMainMock.invoke(IPC.XNAT_LOGOUT)).resolves.toBeUndefined();
    await expect(ipcMainMock.invoke(IPC.XNAT_VALIDATE)).resolves.toEqual({ valid: true });
    await expect(ipcMainMock.invoke(IPC.XNAT_GET_CONNECTION)).resolves.toEqual({
      serverUrl: 'https://xnat.example.org',
    });

    expect(sessionManagerMock.browserLogin).toHaveBeenCalledWith('https://xnat.example.org');
    expect(sessionManagerMock.logout).toHaveBeenCalledTimes(1);
    expect(sessionManagerMock.validateSession).toHaveBeenCalledTimes(1);
    expect(sessionManagerMock.getConnectionInfo).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid browser login payloads with a clear error', async () => {
    registerAuthHandlers();

    const result = await ipcMainMock.invokeWithErrorCapture(IPC.XNAT_BROWSER_LOGIN, '   ');

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected invalid payload to fail');
    }
    expect(result.error).toBeInstanceOf(Error);
    expect((result.error as Error).message).toContain('Invalid payload for xnat:browser-login');
    expect(sessionManagerMock.browserLogin).not.toHaveBeenCalled();
  });
});
