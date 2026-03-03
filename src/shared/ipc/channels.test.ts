import { describe, expect, it } from 'vitest';
import { IPC } from '../ipcChannels';
import { IPC_CHANNELS } from './channels';

describe('shared IPC channel contract', () => {
  it('maps contract aliases to canonical IPC constants', () => {
    expect(IPC_CHANNELS.browserLogin).toBe(IPC.XNAT_BROWSER_LOGIN);
    expect(IPC_CHANNELS.dicomwebFetch).toBe(IPC.XNAT_DICOMWEB_FETCH);
    expect(IPC_CHANNELS.downloadScanFile).toBe(IPC.XNAT_DOWNLOAD_SCAN_FILE);
    expect(IPC_CHANNELS.saveViewportCapture).toBe(IPC.EXPORT_SAVE_VIEWPORT_CAPTURE);
    expect(IPC_CHANNELS.sessionExpired).toBe(IPC.XNAT_SESSION_EXPIRED);
  });
});
