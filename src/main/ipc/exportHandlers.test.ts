import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../../shared/ipcChannels';
import { createIpcMainMock } from '../../test/ipc/ipcMocks';

const ipcMainMock = createIpcMainMock();

const writeFileMock = vi.fn();
const showSaveDialogMock = vi.fn();
const showOpenDialogMock = vi.fn();
const writeImageMock = vi.fn();
const toPNGMock = vi.fn(() => Buffer.from('png-bytes'));
const toJPEGMock = vi.fn(() => Buffer.from('jpeg-bytes'));
const createFromDataURLMock = vi.fn(() => ({ toPNG: toPNGMock, toJPEG: toJPEGMock }));
const capturePageMock = vi.fn(async () => ({ toPNG: toPNGMock, toJPEG: toJPEGMock }));
const getFocusedWindowMock = vi.fn(() => focusedWindow);

const focusedWindow = {
  webContents: {
    capturePage: capturePageMock,
  },
};

let registerExportHandlers: (typeof import('./exportHandlers'))['registerExportHandlers'];

beforeAll(async () => {
  vi.doMock('electron', () => ({
    ipcMain: ipcMainMock.ipcMain,
    dialog: {
      showSaveDialog: showSaveDialogMock,
      showOpenDialog: showOpenDialogMock,
    },
    clipboard: {
      writeImage: writeImageMock,
    },
    nativeImage: {
      createFromDataURL: createFromDataURLMock,
    },
    BrowserWindow: {
      getFocusedWindow: getFocusedWindowMock,
    },
  }));

  vi.doMock('fs/promises', () => ({
    default: {
      writeFile: writeFileMock,
    },
    writeFile: writeFileMock,
  }));

  ({ registerExportHandlers } = await import('./exportHandlers'));
});

describe('registerExportHandlers', () => {
  beforeEach(() => {
    ipcMainMock.handlers.clear();
    ipcMainMock.listeners.clear();
    ipcMainMock.ipcMain.handle.mockClear();
    vi.clearAllMocks();
    getFocusedWindowMock.mockReturnValue(focusedWindow);

    showSaveDialogMock.mockResolvedValue({ canceled: false, filePath: '/tmp/output.png' });
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: ['/tmp/export-folder'] });
  });

  it('registers all export channels', () => {
    registerExportHandlers();

    const channels = ipcMainMock.ipcMain.handle.mock.calls.map((call) => call[0]);
    expect(channels).toEqual([
      IPC.EXPORT_SAVE_SCREENSHOT,
      IPC.EXPORT_SAVE_VIEWPORT_CAPTURE,
      IPC.EXPORT_COPY_CLIPBOARD,
      IPC.EXPORT_COPY_VIEWPORT_CAPTURE,
      IPC.EXPORT_SAVE_ALL_SLICES,
      IPC.EXPORT_SAVE_REPORT,
      IPC.EXPORT_SAVE_DICOM_SEG,
      IPC.EXPORT_SAVE_DICOM_RTSTRUCT,
      IPC.EXPORT_SAVE_DICOM,
    ]);
  });

  it('rejects invalid viewport-capture bounds payloads with clear errors', async () => {
    registerExportHandlers();

    await expect(
      ipcMainMock.invoke(IPC.EXPORT_SAVE_VIEWPORT_CAPTURE, { x: 0, y: 0, width: Number.NaN, height: 20 }),
    ).resolves.toEqual({
      ok: false,
      error: 'Invalid payload: bounds must include finite x/y/width/height',
    });

    await expect(
      ipcMainMock.invoke(IPC.EXPORT_COPY_VIEWPORT_CAPTURE, { x: 1, y: 2, width: -10, height: 0 }),
    ).resolves.toEqual({
      ok: false,
      error: 'Invalid viewport bounds',
    });
  });

  it('saves screenshot files via dialog + writeFile', async () => {
    registerExportHandlers();

    await expect(
      ipcMainMock.invoke(IPC.EXPORT_SAVE_SCREENSHOT, 'data:image/png;base64,AAA', 'capture.png'),
    ).resolves.toEqual({
      ok: true,
      path: '/tmp/output.png',
    });

    expect(showSaveDialogMock).toHaveBeenCalled();
    expect(createFromDataURLMock).toHaveBeenCalledWith('data:image/png;base64,AAA');
    expect(writeFileMock).toHaveBeenCalledWith('/tmp/output.png', expect.any(Buffer));
  });

  it('copies screenshot data to clipboard', async () => {
    registerExportHandlers();

    await expect(
      ipcMainMock.invoke(IPC.EXPORT_COPY_CLIPBOARD, 'data:image/png;base64,BBB'),
    ).resolves.toEqual({ ok: true });

    expect(createFromDataURLMock).toHaveBeenCalledWith('data:image/png;base64,BBB');
    expect(writeImageMock).toHaveBeenCalledTimes(1);
  });

  it('captures viewport region and saves to selected file', async () => {
    registerExportHandlers();

    await expect(
      ipcMainMock.invoke(
        IPC.EXPORT_SAVE_VIEWPORT_CAPTURE,
        { x: 10.2, y: 20.9, width: 300.4, height: 200.7 },
        'viewport.jpg',
      ),
    ).resolves.toEqual({
      ok: true,
      path: '/tmp/output.png',
    });

    expect(capturePageMock).toHaveBeenCalledWith({ x: 10, y: 20, width: 300, height: 200 });
    expect(writeFileMock).toHaveBeenCalledWith('/tmp/output.png', expect.any(Buffer));
  });

  it('writes every provided slice when exporting all slices', async () => {
    registerExportHandlers();

    await expect(
      ipcMainMock.invoke(IPC.EXPORT_SAVE_ALL_SLICES, [
        { dataUrl: 'data:image/png;base64,AAA', filename: '001.png' },
        { dataUrl: 'data:image/png;base64,BBB', filename: '002.png' },
      ]),
    ).resolves.toEqual({
      ok: true,
      path: '/tmp/export-folder',
      count: 2,
    });

    expect(writeFileMock).toHaveBeenCalledTimes(2);
    expect(writeFileMock).toHaveBeenNthCalledWith(1, '/tmp/export-folder/001.png', expect.any(Buffer));
    expect(writeFileMock).toHaveBeenNthCalledWith(2, '/tmp/export-folder/002.png', expect.any(Buffer));
  });

  it('returns no-window errors for window-scoped handlers', async () => {
    registerExportHandlers();
    getFocusedWindowMock.mockReturnValue(null);

    await expect(ipcMainMock.invoke(IPC.EXPORT_SAVE_SCREENSHOT, 'data:image/png;base64,AAA')).resolves.toEqual({
      ok: false,
      error: 'No focused window',
    });
    await expect(
      ipcMainMock.invoke(IPC.EXPORT_SAVE_VIEWPORT_CAPTURE, { x: 1, y: 1, width: 10, height: 10 }),
    ).resolves.toEqual({
      ok: false,
      error: 'No focused window',
    });
    await expect(
      ipcMainMock.invoke(IPC.EXPORT_COPY_VIEWPORT_CAPTURE, { x: 1, y: 1, width: 10, height: 10 }),
    ).resolves.toEqual({
      ok: false,
      error: 'No focused window',
    });
    await expect(ipcMainMock.invoke(IPC.EXPORT_SAVE_ALL_SLICES, [])).resolves.toEqual({
      ok: false,
      error: 'No focused window',
    });
    await expect(ipcMainMock.invoke(IPC.EXPORT_SAVE_REPORT, 'csv,data')).resolves.toEqual({
      ok: false,
      error: 'No focused window',
    });
    await expect(ipcMainMock.invoke(IPC.EXPORT_SAVE_DICOM_SEG, 'YQ==')).resolves.toEqual({
      ok: false,
      error: 'No focused window',
    });
    await expect(ipcMainMock.invoke(IPC.EXPORT_SAVE_DICOM_RTSTRUCT, 'YQ==')).resolves.toEqual({
      ok: false,
      error: 'No focused window',
    });
    await expect(ipcMainMock.invoke(IPC.EXPORT_SAVE_DICOM, 'YQ==')).resolves.toEqual({
      ok: false,
      error: 'No focused window',
    });
  });

  it('returns ok:false when save/open dialogs are canceled', async () => {
    registerExportHandlers();
    showSaveDialogMock.mockResolvedValue({ canceled: true });
    showOpenDialogMock.mockResolvedValue({ canceled: true, filePaths: [] });

    await expect(ipcMainMock.invoke(IPC.EXPORT_SAVE_SCREENSHOT, 'data:image/png;base64,AAA')).resolves.toEqual({
      ok: false,
    });
    await expect(
      ipcMainMock.invoke(IPC.EXPORT_SAVE_VIEWPORT_CAPTURE, { x: 1, y: 1, width: 10, height: 10 }),
    ).resolves.toEqual({
      ok: false,
    });
    await expect(ipcMainMock.invoke(IPC.EXPORT_SAVE_ALL_SLICES, [])).resolves.toEqual({
      ok: false,
    });
    await expect(ipcMainMock.invoke(IPC.EXPORT_SAVE_REPORT, 'csv,data')).resolves.toEqual({
      ok: false,
    });
    await expect(ipcMainMock.invoke(IPC.EXPORT_SAVE_DICOM_SEG, 'YQ==')).resolves.toEqual({
      ok: false,
    });
    await expect(ipcMainMock.invoke(IPC.EXPORT_SAVE_DICOM_RTSTRUCT, 'YQ==')).resolves.toEqual({
      ok: false,
    });
    await expect(ipcMainMock.invoke(IPC.EXPORT_SAVE_DICOM, 'YQ==')).resolves.toEqual({
      ok: false,
    });
  });

  it('saves report and dicom outputs to the selected paths', async () => {
    registerExportHandlers();

    showSaveDialogMock
      .mockResolvedValueOnce({ canceled: false, filePath: '/tmp/report.csv' })
      .mockResolvedValueOnce({ canceled: false, filePath: '/tmp/seg.dcm' })
      .mockResolvedValueOnce({ canceled: false, filePath: '/tmp/rtstruct.dcm' })
      .mockResolvedValueOnce({ canceled: false, filePath: '/tmp/image.dcm' });

    await expect(ipcMainMock.invoke(IPC.EXPORT_SAVE_REPORT, 'a,b,c')).resolves.toEqual({
      ok: true,
      path: '/tmp/report.csv',
    });
    await expect(ipcMainMock.invoke(IPC.EXPORT_SAVE_DICOM_SEG, Buffer.from('seg').toString('base64'))).resolves.toEqual({
      ok: true,
      path: '/tmp/seg.dcm',
    });
    await expect(
      ipcMainMock.invoke(IPC.EXPORT_SAVE_DICOM_RTSTRUCT, Buffer.from('rt').toString('base64')),
    ).resolves.toEqual({
      ok: true,
      path: '/tmp/rtstruct.dcm',
    });
    await expect(ipcMainMock.invoke(IPC.EXPORT_SAVE_DICOM, Buffer.from('dcm').toString('base64'))).resolves.toEqual({
      ok: true,
      path: '/tmp/image.dcm',
    });

    expect(writeFileMock).toHaveBeenCalledWith('/tmp/report.csv', 'a,b,c', 'utf-8');
    expect(writeFileMock).toHaveBeenCalledWith('/tmp/seg.dcm', expect.any(Buffer));
    expect(writeFileMock).toHaveBeenCalledWith('/tmp/rtstruct.dcm', expect.any(Buffer));
    expect(writeFileMock).toHaveBeenCalledWith('/tmp/image.dcm', expect.any(Buffer));
  });

  it('surfaces clipboard/capture/save errors via { ok:false, error } payloads', async () => {
    registerExportHandlers();

    createFromDataURLMock.mockImplementationOnce(() => {
      throw new Error('bad image');
    });
    await expect(ipcMainMock.invoke(IPC.EXPORT_COPY_CLIPBOARD, 'data:image/png;base64,BBB')).resolves.toEqual({
      ok: false,
      error: 'bad image',
    });

    capturePageMock.mockRejectedValueOnce(new Error('capture failed'));
    await expect(
      ipcMainMock.invoke(IPC.EXPORT_COPY_VIEWPORT_CAPTURE, { x: 1, y: 1, width: 10, height: 10 }),
    ).resolves.toEqual({
      ok: false,
      error: 'capture failed',
    });

    writeFileMock.mockRejectedValueOnce(new Error('disk full'));
    await expect(
      ipcMainMock.invoke(IPC.EXPORT_SAVE_SCREENSHOT, 'data:image/png;base64,AAA', 'capture.png'),
    ).resolves.toEqual({
      ok: false,
      error: 'disk full',
    });
  });
});
