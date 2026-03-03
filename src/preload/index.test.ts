import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../shared/ipcChannels';

const mocks = vi.hoisted(() => {
  const exposed: { api: any } = { api: null };
  const ipcOnHandlers = new Map<string, (...args: unknown[]) => void>();
  return {
    exposed,
    exposeInMainWorld: vi.fn((_key: string, value: any) => {
      exposed.api = value;
    }),
    invoke: vi.fn(async () => ({ ok: true })),
    on: vi.fn((channel: string, cb: (...args: unknown[]) => void) => {
      ipcOnHandlers.set(channel, cb);
    }),
    removeListener: vi.fn((channel: string) => {
      ipcOnHandlers.delete(channel);
    }),
    getOnHandler: (channel: string) => ipcOnHandlers.get(channel),
  };
});

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: mocks.exposeInMainWorld,
  },
  ipcRenderer: {
    invoke: mocks.invoke,
    on: mocks.on,
    removeListener: mocks.removeListener,
  },
}));

describe('preload bridge', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.exposed.api = null;
    vi.resetModules();
    await import('./index');
  });

  it('exposes electronAPI and forwards invoke calls to expected channels', async () => {
    expect(mocks.exposeInMainWorld).toHaveBeenCalledWith('electronAPI', expect.any(Object));
    const api = mocks.exposed.api;
    expect(api.platform).toBe(process.platform);

    await api.xnat.browserLogin('https://xnat.example');
    await api.xnat.logout();
    await api.xnat.validateSession();
    await api.xnat.getConnection();
    await api.xnat.getProjects();
    await api.xnat.getSubjects('P1');
    await api.xnat.getSessions('P1', 'S1');
    await api.xnat.getScans('XNAT_E001', { includeSopClassUID: true });
    await api.xnat.getScanFiles('XNAT_E001', '11');
    await api.xnat.getProjectSessions('P1');
    await api.xnat.downloadScanFile('XNAT_E001', '11');
    await api.xnat.uploadDicomSeg('P1', 'S1', 'E1', 'Session 1', '11', 'ZmFrZQ==', 'Seg Label');
    await api.xnat.uploadDicomRtStruct('P1', 'S1', 'E1', 'Session 1', '11', 'ZmFrZQ==', 'RT Label');
    await api.xnat.overwriteDicomSeg('E1', '31', 'ZmFrZQ==', 'Seg overwrite');
    await api.xnat.overwriteDicomRtStruct('E1', '41', 'ZmFrZQ==', 'RT overwrite');
    await api.xnat.prepareDicomForUpload(
      'SEG',
      'P1',
      'S1',
      'E1',
      'Session 1',
      '11',
      'ZmFrZQ==',
      '3011',
      'Series',
    );
    await api.xnat.autoSaveTemp('E1', '11', 'ZmFrZQ==', 'autosave_seg_11.dcm');
    await api.xnat.listTempFiles('E1');
    await api.xnat.deleteTempFile('E1', 'autosave_seg_11.dcm');
    await api.xnat.downloadTempFile('E1', 'autosave_seg_11.dcm');
    await api.export.saveScreenshot('data:image/png;base64,abc', 'capture.png');
    await api.export.copyToClipboard('data:image/png;base64,abc');
    await api.export.copyViewportCapture({ x: 1, y: 1, width: 2, height: 2 });
    await api.export.saveDicom('ZmFrZQ==');
    await api.export.saveAllSlices([{ dataUrl: 'data:image/png;base64,abc', filename: 'slice.png' }]);
    await api.export.saveReport('report text', 'report.txt');
    await api.export.saveDicomSeg('ZmFrZQ==', 'seg.dcm');
    await api.export.saveDicomRtStruct('ZmFrZQ==', 'rtstruct.dcm');
    await api.export.saveViewportCapture({ x: 1, y: 2, width: 3, height: 4 }, 'capture.png');

    expect(mocks.invoke).toHaveBeenCalledWith(IPC.XNAT_BROWSER_LOGIN, 'https://xnat.example');
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.XNAT_LOGOUT);
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.XNAT_VALIDATE);
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.XNAT_GET_CONNECTION);
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.XNAT_GET_PROJECTS);
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.XNAT_GET_SUBJECTS, 'P1');
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.XNAT_GET_SESSIONS, 'P1', 'S1');
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.XNAT_GET_SCANS, 'XNAT_E001', { includeSopClassUID: true });
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.XNAT_GET_SCAN_FILES, 'XNAT_E001', '11');
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.XNAT_GET_PROJECT_SESSIONS, 'P1');
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.XNAT_DOWNLOAD_SCAN_FILE, 'XNAT_E001', '11');
    expect(mocks.invoke).toHaveBeenCalledWith(
      IPC.XNAT_UPLOAD_DICOM_SEG,
      'P1',
      'S1',
      'E1',
      'Session 1',
      '11',
      'ZmFrZQ==',
      'Seg Label',
    );
    expect(mocks.invoke).toHaveBeenCalledWith(
      IPC.XNAT_UPLOAD_DICOM_RTSTRUCT,
      'P1',
      'S1',
      'E1',
      'Session 1',
      '11',
      'ZmFrZQ==',
      'RT Label',
    );
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.XNAT_OVERWRITE_DICOM_SEG, 'E1', '31', 'ZmFrZQ==', 'Seg overwrite');
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.XNAT_OVERWRITE_DICOM_RTSTRUCT, 'E1', '41', 'ZmFrZQ==', 'RT overwrite');
    expect(mocks.invoke).toHaveBeenCalledWith(
      IPC.XNAT_PREPARE_DICOM_UPLOAD,
      'SEG',
      'P1',
      'S1',
      'E1',
      'Session 1',
      '11',
      'ZmFrZQ==',
      '3011',
      'Series',
    );
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.XNAT_AUTOSAVE_TEMP, 'E1', '11', 'ZmFrZQ==', 'autosave_seg_11.dcm');
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.XNAT_LIST_TEMP_FILES, 'E1');
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.XNAT_DELETE_TEMP_FILE, 'E1', 'autosave_seg_11.dcm');
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.XNAT_DOWNLOAD_TEMP_FILE, 'E1', 'autosave_seg_11.dcm');
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.EXPORT_SAVE_SCREENSHOT, 'data:image/png;base64,abc', 'capture.png');
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.EXPORT_COPY_CLIPBOARD, 'data:image/png;base64,abc');
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.EXPORT_COPY_VIEWPORT_CAPTURE, { x: 1, y: 1, width: 2, height: 2 });
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.EXPORT_SAVE_DICOM, 'ZmFrZQ==');
    expect(mocks.invoke).toHaveBeenCalledWith(
      IPC.EXPORT_SAVE_ALL_SLICES,
      [{ dataUrl: 'data:image/png;base64,abc', filename: 'slice.png' }],
    );
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.EXPORT_SAVE_REPORT, 'report text', 'report.txt');
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.EXPORT_SAVE_DICOM_SEG, 'ZmFrZQ==', 'seg.dcm');
    expect(mocks.invoke).toHaveBeenCalledWith(IPC.EXPORT_SAVE_DICOM_RTSTRUCT, 'ZmFrZQ==', 'rtstruct.dcm');
    expect(mocks.invoke).toHaveBeenCalledWith(
      IPC.EXPORT_SAVE_VIEWPORT_CAPTURE,
      { x: 1, y: 2, width: 3, height: 4 },
      'capture.png',
    );
  });

  it('allows only whitelisted event channels and unsubscribes listeners', () => {
    const api = mocks.exposed.api;
    const callback = vi.fn();
    const off = api.on(IPC.XNAT_SESSION_EXPIRED, callback);

    expect(mocks.on).toHaveBeenCalledWith(IPC.XNAT_SESSION_EXPIRED, expect.any(Function));
    const wrapped = mocks.getOnHandler(IPC.XNAT_SESSION_EXPIRED);
    wrapped?.({} as any, 'payload-1', 2);
    expect(callback).toHaveBeenCalledWith('payload-1', 2);

    off();
    expect(mocks.removeListener).toHaveBeenCalledWith(IPC.XNAT_SESSION_EXPIRED, expect.any(Function));
  });

  it('blocks unknown renderer event channels', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const api = mocks.exposed.api;
    const off = api.on('xnat:not-allowed', vi.fn());

    expect(mocks.on).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[preload] Blocked IPC listener for unknown channel: xnat:not-allowed',
    );
    expect(() => off()).not.toThrow();
    warnSpy.mockRestore();
  });
});
