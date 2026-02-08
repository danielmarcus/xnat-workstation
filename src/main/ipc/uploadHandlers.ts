/**
 * Upload & Download IPC Handlers — handles uploading DICOM SEG files to XNAT
 * and downloading raw DICOM scan files from XNAT.
 *
 * Upload: Renderer sends DICOM SEG data as base64 through IPC → main process
 * creates a new scan on the session (bypassing Session Importer).
 *
 * Download: Renderer requests raw DICOM bytes for a scan → main process
 * fetches via authenticated HTTP and returns base64.
 */
import { ipcMain } from 'electron';
import { IPC } from '../../shared/ipcChannels';
import * as sessionManager from '../xnat/sessionManager';

export function registerUploadHandlers(): void {
  console.log('[ipc] Upload handlers registered');

  // ─── Download raw DICOM file from a scan ──────────────────────
  ipcMain.handle(
    IPC.XNAT_DOWNLOAD_SCAN_FILE,
    async (
      _event,
      sessionId: string,
      scanId: string,
    ) => {
      const client = sessionManager.getClient();
      if (!client) {
        return { ok: false, error: 'Not connected to XNAT' };
      }

      try {
        console.log(`[uploadHandlers] Downloading scan file: session=${sessionId} scan=${scanId}`);
        const buffer = await client.downloadScanFile(sessionId, scanId);
        console.log(`[uploadHandlers] Downloaded ${buffer.length} bytes`);
        return { ok: true, data: buffer.toString('base64') };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[uploadHandlers] Download failed:', msg);
        return { ok: false, error: msg };
      }
    },
  );

  // ─── Upload DICOM SEG to XNAT (as a scan) ─────────────────────
  ipcMain.handle(
    IPC.XNAT_UPLOAD_DICOM_SEG,
    async (
      _event,
      projectId: string,
      subjectId: string,
      sessionId: string,
      sessionLabel: string,
      sourceScanId: string,
      dicomSegBase64: string,
    ) => {
      const client = sessionManager.getClient();
      if (!client) {
        return { ok: false, error: 'Not connected to XNAT' };
      }

      try {
        const buffer = Buffer.from(dicomSegBase64, 'base64');
        console.log(
          `[uploadHandlers] Uploading DICOM SEG (${buffer.length} bytes)`,
          `to ${projectId}/${subjectId}/${sessionLabel} (source scan: ${sourceScanId})`,
        );

        const result = await client.uploadDicomSegAsScan(
          projectId,
          subjectId,
          sessionId,
          sessionLabel,
          sourceScanId,
          buffer,
        );

        return { ok: true, url: result.url, scanId: result.scanId };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[uploadHandlers] Upload failed:', msg);
        return { ok: false, error: msg };
      }
    },
  );
}
