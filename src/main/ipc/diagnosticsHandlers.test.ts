import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../../shared/ipcChannels';
import { createIpcMainMock } from '../../test/ipc/ipcMocks';

const ipcMainMock = createIpcMainMock();

const electronMocks = {
  app: {
    getName: vi.fn(() => 'XNAT Workstation'),
    getVersion: vi.fn(() => '0.5.2'),
    isPackaged: true,
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [{}, {}]),
  },
};

const getMainLogSnapshotMock = vi.fn(() => ({
  stdout: [
    {
      timestamp: '2026-03-05T00:00:00.000Z',
      source: 'main' as const,
      stream: 'stdout' as const,
      level: 'info' as const,
      message: 'main stdout',
    },
  ],
  stderr: [
    {
      timestamp: '2026-03-05T00:00:01.000Z',
      source: 'main' as const,
      stream: 'stderr' as const,
      level: 'error' as const,
      message: 'main stderr',
    },
  ],
}));

let registerDiagnosticsHandlers: (typeof import('./diagnosticsHandlers'))['registerDiagnosticsHandlers'];

beforeAll(async () => {
  vi.doMock('electron', () => ({
    ipcMain: ipcMainMock.ipcMain,
    app: electronMocks.app,
    BrowserWindow: electronMocks.BrowserWindow,
  }));

  vi.doMock('../diagnostics/mainLogBuffer', () => ({
    getMainLogSnapshot: getMainLogSnapshotMock,
  }));

  ({ registerDiagnosticsHandlers } = await import('./diagnosticsHandlers'));
});

describe('registerDiagnosticsHandlers', () => {
  beforeEach(() => {
    ipcMainMock.handlers.clear();
    ipcMainMock.listeners.clear();
    ipcMainMock.ipcMain.handle.mockClear();
    vi.clearAllMocks();
  });

  it('registers diagnostics snapshot channel and returns structured data', async () => {
    registerDiagnosticsHandlers();

    const channels = ipcMainMock.ipcMain.handle.mock.calls.map((call) => call[0]);
    expect(channels).toContain(IPC.DIAGNOSTICS_GET_MAIN_SNAPSHOT);

    const result = await ipcMainMock.invoke(IPC.DIAGNOSTICS_GET_MAIN_SNAPSHOT);
    expect(result.ok).toBe(true);
    expect(result.snapshot.app.name).toBe('XNAT Workstation');
    expect(result.snapshot.app.version).toBe('0.5.2');
    expect(result.snapshot.app.windowCount).toBe(2);
    expect(result.snapshot.logs.stdout[0].message).toBe('main stdout');
    expect(result.snapshot.logs.stderr[0].message).toBe('main stderr');
    expect(getMainLogSnapshotMock).toHaveBeenCalledWith(220);
  });
});
