import { describe, expect, it } from 'vitest';
import { IPC } from './ipcChannels';

describe('ipcChannels', () => {
  it('uses unique channel names to avoid handler collisions', () => {
    const values = Object.values(IPC);
    const unique = new Set(values);
    expect(values.length).toBe(unique.size);
  });

  it('keeps channel namespaces stable by domain', () => {
    expect(IPC.XNAT_BROWSER_LOGIN).toMatch(/^xnat:/);
    expect(IPC.XNAT_SESSION_EXPIRED).toMatch(/^xnat:/);
    expect(IPC.EXPORT_SAVE_SCREENSHOT).toMatch(/^export:/);
    expect(IPC.EXPORT_SAVE_DICOM_RTSTRUCT).toMatch(/^export:/);
  });

  it('exposes critical auth and upload channels expected by bridge/handlers', () => {
    expect(IPC).toEqual(
      expect.objectContaining({
        XNAT_BROWSER_LOGIN: 'xnat:browser-login',
        XNAT_VALIDATE: 'xnat:validate-session',
        XNAT_GET_PROJECTS: 'xnat:get-projects',
        XNAT_GET_SCANS: 'xnat:get-scans',
        XNAT_UPLOAD_DICOM_SEG: 'xnat:upload-dicom-seg',
        XNAT_UPLOAD_DICOM_RTSTRUCT: 'xnat:upload-dicom-rtstruct',
        XNAT_AUTOSAVE_TEMP: 'xnat:autosave-temp',
        XNAT_SESSION_EXPIRED: 'xnat:session-expired',
      }),
    );
  });
});
