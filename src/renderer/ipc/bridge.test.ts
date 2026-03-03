import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { IPC } from '@shared/ipcChannels';
import type { IpcInvokeResponse } from '@shared/ipc/channels';
import {
  browserLogin,
  dicomwebFetch,
  downloadScanFile,
  onSessionExpired,
  saveViewportCapture,
} from './bridge';
import { createWindowElectronApiMock } from '../../test/ipc/ipcMocks';

describe('renderer ipc bridge', () => {
  beforeEach(() => {
    const api = createWindowElectronApiMock();
    Object.defineProperty(window, 'electronAPI', {
      value: api,
      configurable: true,
      writable: true,
    });
    vi.clearAllMocks();
  });

  it('browserLogin forwards payload to window.electronAPI.xnat.browserLogin', async () => {
    const expected = { success: true };
    window.electronAPI.xnat.browserLogin.mockResolvedValue(expected);

    await expect(browserLogin({ serverUrl: 'https://xnat.example.org' })).resolves.toEqual(expected);
    expect(window.electronAPI.xnat.browserLogin).toHaveBeenCalledWith('https://xnat.example.org');
  });

  it('dicomwebFetch and downloadScanFile forward contract payloads', async () => {
    const fetchResponse = { ok: true, status: 200, data: [{ id: '1' }] };
    const downloadResponse = { ok: true, data: 'ZmFrZS1kaWNvbQ==' };
    window.electronAPI.xnat.dicomwebFetch.mockResolvedValue(fetchResponse);
    window.electronAPI.xnat.downloadScanFile.mockResolvedValue(downloadResponse);

    await expect(
      dicomwebFetch({ path: '/studies', options: { accept: 'application/dicom+json' } }),
    ).resolves.toEqual(fetchResponse);
    await expect(
      downloadScanFile({ sessionId: 'XNAT_E0001', scanId: '3' }),
    ).resolves.toEqual(downloadResponse);

    expect(window.electronAPI.xnat.dicomwebFetch).toHaveBeenCalledWith('/studies', {
      accept: 'application/dicom+json',
    });
    expect(window.electronAPI.xnat.downloadScanFile).toHaveBeenCalledWith('XNAT_E0001', '3');
  });

  it('saveViewportCapture forwards bounds/defaultName', async () => {
    window.electronAPI.export.saveViewportCapture.mockResolvedValue({ ok: true, path: '/tmp/vp.png' });

    await expect(
      saveViewportCapture({
        bounds: { x: 10, y: 20, width: 300, height: 200 },
        defaultName: 'capture.png',
      }),
    ).resolves.toEqual({ ok: true, path: '/tmp/vp.png' });

    expect(window.electronAPI.export.saveViewportCapture).toHaveBeenCalledWith(
      { x: 10, y: 20, width: 300, height: 200 },
      'capture.png',
    );
  });

  it('onSessionExpired subscribes to the expected channel and returns unsubscribe', () => {
    const unsubscribe = vi.fn();
    window.electronAPI.on.mockReturnValue(unsubscribe);
    const callback = vi.fn();

    const off = onSessionExpired(callback);

    expect(window.electronAPI.on).toHaveBeenCalledWith(IPC.XNAT_SESSION_EXPIRED, callback);
    expect(off).toBe(unsubscribe);
  });

  it('throws when electron bridge is unavailable', async () => {
    Object.defineProperty(window, 'electronAPI', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    await expect(browserLogin({ serverUrl: 'https://xnat.example.org' })).rejects.toThrow(
      'electronAPI bridge is unavailable',
    );
  });

  it('stays type-aligned with shared channel contracts', () => {
    expectTypeOf<Awaited<ReturnType<typeof browserLogin>>>().toEqualTypeOf<
      IpcInvokeResponse<typeof IPC.XNAT_BROWSER_LOGIN>
    >();
    expectTypeOf<Awaited<ReturnType<typeof dicomwebFetch>>>().toEqualTypeOf<
      IpcInvokeResponse<typeof IPC.XNAT_DICOMWEB_FETCH>
    >();
    expectTypeOf<Awaited<ReturnType<typeof downloadScanFile>>>().toEqualTypeOf<
      IpcInvokeResponse<typeof IPC.XNAT_DOWNLOAD_SCAN_FILE>
    >();
    expectTypeOf<Awaited<ReturnType<typeof saveViewportCapture>>>().toEqualTypeOf<
      IpcInvokeResponse<typeof IPC.EXPORT_SAVE_VIEWPORT_CAPTURE>
    >();
  });
});
