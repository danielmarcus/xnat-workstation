import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../../shared/ipcChannels';
import { createIpcMainMock } from '../../test/ipc/ipcMocks';

const ipcMainMock = createIpcMainMock();

const mockClient = {
  downloadScanFile: vi.fn(),
  uploadDicomSegAsScan: vi.fn(),
  overwriteDicomSegInScan: vi.fn(),
  overwriteDicomRtStructInScan: vi.fn(),
  prepareDicomForUpload: vi.fn(),
  autoSaveToTemp: vi.fn(),
  listTempFiles: vi.fn(),
  deleteTempFile: vi.fn(),
  downloadTempFile: vi.fn(),
  uploadDicomRtStructAsScan: vi.fn(),
};

const sessionManagerMock = {
  getClient: vi.fn(),
  handleAuthFailure: vi.fn(),
};

let registerUploadHandlers: (typeof import('./uploadHandlers'))['registerUploadHandlers'];

beforeAll(async () => {
  vi.doMock('electron', () => ({
    ipcMain: ipcMainMock.ipcMain,
  }));

  vi.doMock('../xnat/sessionManager', () => sessionManagerMock);

  ({ registerUploadHandlers } = await import('./uploadHandlers'));
});

describe('registerUploadHandlers', () => {
  beforeEach(() => {
    ipcMainMock.handlers.clear();
    ipcMainMock.listeners.clear();
    ipcMainMock.ipcMain.handle.mockClear();
    vi.clearAllMocks();
    sessionManagerMock.getClient.mockReturnValue(mockClient);
  });

  it('registers all upload/download channels', () => {
    registerUploadHandlers();

    const channels = ipcMainMock.ipcMain.handle.mock.calls.map((call) => call[0]);
    expect(channels).toEqual([
      IPC.XNAT_DOWNLOAD_SCAN_FILE,
      IPC.XNAT_UPLOAD_DICOM_SEG,
      IPC.XNAT_OVERWRITE_DICOM_SEG,
      IPC.XNAT_OVERWRITE_DICOM_RTSTRUCT,
      IPC.XNAT_PREPARE_DICOM_UPLOAD,
      IPC.XNAT_AUTOSAVE_TEMP,
      IPC.XNAT_LIST_TEMP_FILES,
      IPC.XNAT_DELETE_TEMP_FILE,
      IPC.XNAT_DOWNLOAD_TEMP_FILE,
      IPC.XNAT_UPLOAD_DICOM_RTSTRUCT,
    ]);
  });

  it('handles valid payloads across core upload/download handlers', async () => {
    registerUploadHandlers();

    mockClient.downloadScanFile.mockResolvedValue(Buffer.from('scan-bytes'));
    mockClient.uploadDicomSegAsScan.mockResolvedValue({ url: '/archive/scans/3004', scanId: '3004' });
    mockClient.overwriteDicomSegInScan.mockResolvedValue({ url: '/archive/scans/17', scanId: '17' });
    mockClient.overwriteDicomRtStructInScan.mockResolvedValue({ url: '/archive/scans/18', scanId: '18' });
    mockClient.prepareDicomForUpload.mockResolvedValue({
      scanId: '3004',
      dicomBuffer: Buffer.from('prepared-dicom'),
    });
    mockClient.autoSaveToTemp.mockResolvedValue({ url: '/temp/seg-latest.dcm' });
    mockClient.listTempFiles.mockResolvedValue([{ name: 'seg-latest.dcm', uri: '/temp/seg-latest.dcm', size: 100 }]);
    mockClient.deleteTempFile.mockResolvedValue(undefined);
    mockClient.downloadTempFile.mockResolvedValue(Buffer.from('temp-bytes'));
    mockClient.uploadDicomRtStructAsScan.mockResolvedValue({ url: '/archive/scans/3005', scanId: '3005' });

    const dicomBase64 = Buffer.from('dicom-source').toString('base64');

    await expect(ipcMainMock.invoke(IPC.XNAT_DOWNLOAD_SCAN_FILE, 'XNAT_E001', '3')).resolves.toEqual({
      ok: true,
      data: Buffer.from('scan-bytes').toString('base64'),
    });

    await expect(
      ipcMainMock.invoke(
        IPC.XNAT_UPLOAD_DICOM_SEG,
        'P1',
        'S1',
        'XNAT_E001',
        'Session-1',
        '3',
        dicomBase64,
        'Lung Mask',
      ),
    ).resolves.toEqual({ ok: true, url: '/archive/scans/3004', scanId: '3004' });

    await expect(
      ipcMainMock.invoke(
        IPC.XNAT_OVERWRITE_DICOM_SEG,
        'XNAT_E001',
        '17',
        dicomBase64,
        'Series Desc',
      ),
    ).resolves.toEqual({ ok: true, url: '/archive/scans/17', scanId: '17' });

    await expect(
      ipcMainMock.invoke(
        IPC.XNAT_OVERWRITE_DICOM_RTSTRUCT,
        'XNAT_E001',
        '18',
        dicomBase64,
        'RT Series',
      ),
    ).resolves.toEqual({ ok: true, url: '/archive/scans/18', scanId: '18' });

    await expect(
      ipcMainMock.invoke(
        IPC.XNAT_PREPARE_DICOM_UPLOAD,
        'SEG',
        'P1',
        'S1',
        'XNAT_E001',
        'Session-1',
        '3',
        dicomBase64,
        '17',
        'Series Desc',
      ),
    ).resolves.toEqual({
      ok: true,
      scanId: '3004',
      data: Buffer.from('prepared-dicom').toString('base64'),
    });

    await expect(
      ipcMainMock.invoke(IPC.XNAT_AUTOSAVE_TEMP, 'XNAT_E001', '3', dicomBase64, 'autosave-seg.dcm'),
    ).resolves.toEqual({ ok: true, url: '/temp/seg-latest.dcm' });

    await expect(ipcMainMock.invoke(IPC.XNAT_LIST_TEMP_FILES, 'XNAT_E001')).resolves.toEqual({
      ok: true,
      files: [{ name: 'seg-latest.dcm', uri: '/temp/seg-latest.dcm', size: 100 }],
    });

    await expect(ipcMainMock.invoke(IPC.XNAT_DELETE_TEMP_FILE, 'XNAT_E001', 'autosave-seg.dcm')).resolves.toEqual({
      ok: true,
    });

    await expect(ipcMainMock.invoke(IPC.XNAT_DOWNLOAD_TEMP_FILE, 'XNAT_E001', 'autosave-seg.dcm')).resolves.toEqual({
      ok: true,
      data: Buffer.from('temp-bytes').toString('base64'),
    });

    await expect(
      ipcMainMock.invoke(
        IPC.XNAT_UPLOAD_DICOM_RTSTRUCT,
        'P1',
        'S1',
        'XNAT_E001',
        'Session-1',
        '3',
        dicomBase64,
        'RT Label',
      ),
    ).resolves.toEqual({ ok: true, url: '/archive/scans/3005', scanId: '3005' });

    expect(mockClient.downloadScanFile).toHaveBeenCalledWith('XNAT_E001', '3');
    expect(mockClient.uploadDicomSegAsScan).toHaveBeenCalledWith(
      'P1',
      'S1',
      'XNAT_E001',
      'Session-1',
      '3',
      expect.any(Buffer),
      'Lung Mask',
    );
    expect(mockClient.uploadDicomRtStructAsScan).toHaveBeenCalledWith(
      'P1',
      'S1',
      'XNAT_E001',
      'Session-1',
      '3',
      expect.any(Buffer),
      'RT Label',
    );
  });

  it('rejects invalid download payloads before dependency calls', async () => {
    registerUploadHandlers();

    await expect(ipcMainMock.invoke(IPC.XNAT_DOWNLOAD_SCAN_FILE, 'XNAT_E001', '')).resolves.toEqual({
      ok: false,
      error: 'Invalid payload: scanId must be a non-empty string',
    });
    expect(sessionManagerMock.getClient).not.toHaveBeenCalled();
  });

  it('returns safe errors for missing client and dependency failures', async () => {
    registerUploadHandlers();

    sessionManagerMock.getClient.mockReturnValueOnce(null);
    await expect(ipcMainMock.invoke(IPC.XNAT_AUTOSAVE_TEMP, 'XNAT_E001', '3', 'YQ==')).resolves.toEqual({
      ok: false,
      error: 'Not connected to XNAT',
    });

    sessionManagerMock.getClient.mockReturnValue(mockClient);
    const uploadError = new Error('upload failed');
    mockClient.uploadDicomSegAsScan.mockRejectedValueOnce(uploadError);

    await expect(
      ipcMainMock.invoke(
        IPC.XNAT_UPLOAD_DICOM_SEG,
        'P1',
        'S1',
        'XNAT_E001',
        'Session-1',
        '3',
        Buffer.from('seg').toString('base64'),
      ),
    ).resolves.toEqual({ ok: false, error: 'upload failed' });

    expect(sessionManagerMock.handleAuthFailure).toHaveBeenCalledWith(uploadError);
  });

  it('returns not-connected payloads for all client-gated channels', async () => {
    registerUploadHandlers();
    sessionManagerMock.getClient.mockReturnValue(null);

    const b64 = Buffer.from('x').toString('base64');
    const cases: Array<{ channel: string; args: unknown[] }> = [
      { channel: IPC.XNAT_UPLOAD_DICOM_SEG, args: ['P1', 'S1', 'E1', 'Session-1', '3', b64] },
      { channel: IPC.XNAT_OVERWRITE_DICOM_SEG, args: ['E1', '17', b64] },
      { channel: IPC.XNAT_OVERWRITE_DICOM_RTSTRUCT, args: ['E1', '18', b64] },
      { channel: IPC.XNAT_PREPARE_DICOM_UPLOAD, args: ['SEG', 'P1', 'S1', 'E1', 'Session-1', '3', b64] },
      { channel: IPC.XNAT_AUTOSAVE_TEMP, args: ['E1', '3', b64] },
      { channel: IPC.XNAT_LIST_TEMP_FILES, args: ['E1'] },
      { channel: IPC.XNAT_DELETE_TEMP_FILE, args: ['E1', 'f.dcm'] },
      { channel: IPC.XNAT_DOWNLOAD_TEMP_FILE, args: ['E1', 'f.dcm'] },
      { channel: IPC.XNAT_UPLOAD_DICOM_RTSTRUCT, args: ['P1', 'S1', 'E1', 'Session-1', '3', b64] },
    ];

    for (const testCase of cases) {
      // eslint-disable-next-line no-await-in-loop
      await expect(ipcMainMock.invoke(testCase.channel, ...testCase.args)).resolves.toEqual({
        ok: false,
        error: 'Not connected to XNAT',
      });
    }
  });

  it('surfaces per-handler catch-path errors consistently', async () => {
    registerUploadHandlers();
    const b64 = Buffer.from('x').toString('base64');

    mockClient.downloadScanFile.mockRejectedValueOnce(new Error('download failed'));
    await expect(ipcMainMock.invoke(IPC.XNAT_DOWNLOAD_SCAN_FILE, 'E1', '3')).resolves.toEqual({
      ok: false,
      error: 'download failed',
    });

    mockClient.overwriteDicomSegInScan.mockRejectedValueOnce(new Error('overwrite seg failed'));
    await expect(ipcMainMock.invoke(IPC.XNAT_OVERWRITE_DICOM_SEG, 'E1', '17', b64)).resolves.toEqual({
      ok: false,
      error: 'overwrite seg failed',
    });

    mockClient.overwriteDicomRtStructInScan.mockRejectedValueOnce(new Error('overwrite rtstruct failed'));
    await expect(ipcMainMock.invoke(IPC.XNAT_OVERWRITE_DICOM_RTSTRUCT, 'E1', '18', b64)).resolves.toEqual({
      ok: false,
      error: 'overwrite rtstruct failed',
    });

    mockClient.prepareDicomForUpload.mockRejectedValueOnce(new Error('prepare failed'));
    await expect(
      ipcMainMock.invoke(IPC.XNAT_PREPARE_DICOM_UPLOAD, 'SEG', 'P1', 'S1', 'E1', 'Session-1', '3', b64),
    ).resolves.toEqual({
      ok: false,
      error: 'prepare failed',
    });

    mockClient.autoSaveToTemp.mockRejectedValueOnce(new Error('autosave failed'));
    await expect(ipcMainMock.invoke(IPC.XNAT_AUTOSAVE_TEMP, 'E1', '3', b64)).resolves.toEqual({
      ok: false,
      error: 'autosave failed',
    });

    mockClient.listTempFiles.mockRejectedValueOnce(new Error('list failed'));
    await expect(ipcMainMock.invoke(IPC.XNAT_LIST_TEMP_FILES, 'E1')).resolves.toEqual({
      ok: false,
      error: 'list failed',
    });

    mockClient.deleteTempFile.mockRejectedValueOnce(new Error('delete failed'));
    await expect(ipcMainMock.invoke(IPC.XNAT_DELETE_TEMP_FILE, 'E1', 'f.dcm')).resolves.toEqual({
      ok: false,
      error: 'delete failed',
    });

    mockClient.downloadTempFile.mockRejectedValueOnce(new Error('download temp failed'));
    await expect(ipcMainMock.invoke(IPC.XNAT_DOWNLOAD_TEMP_FILE, 'E1', 'f.dcm')).resolves.toEqual({
      ok: false,
      error: 'download temp failed',
    });

    mockClient.uploadDicomRtStructAsScan.mockRejectedValueOnce(new Error('upload rtstruct failed'));
    await expect(
      ipcMainMock.invoke(IPC.XNAT_UPLOAD_DICOM_RTSTRUCT, 'P1', 'S1', 'E1', 'Session-1', '3', b64),
    ).resolves.toEqual({
      ok: false,
      error: 'upload rtstruct failed',
    });
  });
});
