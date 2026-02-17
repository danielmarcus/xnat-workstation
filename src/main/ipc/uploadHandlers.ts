/**
 * Upload & Download IPC Handlers — handles uploading DICOM SEG and RTSTRUCT
 * files to XNAT and downloading raw DICOM scan files from XNAT.
 *
 * Upload: Renderer sends DICOM data as base64 through IPC → main process
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
      label?: string,
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
          label ? `label: "${label}"` : '',
        );

        const result = await client.uploadDicomSegAsScan(
          projectId,
          subjectId,
          sessionId,
          sessionLabel,
          sourceScanId,
          buffer,
          label,
        );

        return { ok: true, url: result.url, scanId: result.scanId };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[uploadHandlers] Upload failed:', msg);
        return { ok: false, error: msg };
      }
    },
  );

  // ─── Overwrite DICOM SEG in existing scan ──────────────────────
  ipcMain.handle(
    IPC.XNAT_OVERWRITE_DICOM_SEG,
    async (
      _event,
      sessionId: string,
      targetScanId: string,
      dicomSegBase64: string,
      seriesDescription?: string,
    ) => {
      const client = sessionManager.getClient();
      if (!client) {
        return { ok: false, error: 'Not connected to XNAT' };
      }

      try {
        const buffer = Buffer.from(dicomSegBase64, 'base64');
        console.log(
          `[uploadHandlers] Overwriting DICOM SEG in scan ${targetScanId} (${buffer.length} bytes)`,
        );

        const result = await client.overwriteDicomSegInScan(
          sessionId,
          targetScanId,
          buffer,
          seriesDescription,
        );
        return { ok: true, url: result.url, scanId: result.scanId };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[uploadHandlers] Overwrite failed:', msg);
        return { ok: false, error: msg };
      }
    },
  );

  // ─── Overwrite DICOM RTSTRUCT in existing scan ─────────────────
  ipcMain.handle(
    IPC.XNAT_OVERWRITE_DICOM_RTSTRUCT,
    async (
      _event,
      sessionId: string,
      targetScanId: string,
      dicomRtStructBase64: string,
      seriesDescription?: string,
    ) => {
      const client = sessionManager.getClient();
      if (!client) {
        return { ok: false, error: 'Not connected to XNAT' };
      }

      try {
        const buffer = Buffer.from(dicomRtStructBase64, 'base64');
        console.log(
          `[uploadHandlers] Overwriting DICOM RTSTRUCT in scan ${targetScanId} (${buffer.length} bytes)`,
        );

        const result = await client.overwriteDicomRtStructInScan(
          sessionId,
          targetScanId,
          buffer,
          seriesDescription,
        );
        return { ok: true, url: result.url, scanId: result.scanId };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[uploadHandlers] RTSTRUCT overwrite failed:', msg);
        return { ok: false, error: msg };
      }
    },
  );

  // ─── Prepare DICOM bytes exactly as upload would store them ───
  ipcMain.handle(
    IPC.XNAT_PREPARE_DICOM_UPLOAD,
    async (
      _event,
      type: 'SEG' | 'RTSTRUCT',
      projectId: string,
      subjectId: string,
      sessionId: string,
      sessionLabel: string,
      sourceScanId: string,
      dicomBase64: string,
      targetScanId?: string,
      seriesDescription?: string,
    ) => {
      const client = sessionManager.getClient();
      if (!client) {
        return { ok: false, error: 'Not connected to XNAT' };
      }

      try {
        const buffer = Buffer.from(dicomBase64, 'base64');
        const prepared = await client.prepareDicomForUpload(
          type,
          projectId,
          subjectId,
          sessionId,
          sessionLabel,
          sourceScanId,
          buffer,
          targetScanId,
          seriesDescription,
        );
        return {
          ok: true,
          scanId: prepared.scanId,
          data: prepared.dicomBuffer.toString('base64'),
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[uploadHandlers] Prepare DICOM upload failed:', msg);
        return { ok: false, error: msg };
      }
    },
  );

  // ─── Auto-save to session-level temp resource ──────────────────
  ipcMain.handle(
    IPC.XNAT_AUTOSAVE_TEMP,
    async (
      _event,
      sessionId: string,
      sourceScanId: string,
      dicomSegBase64: string,
      tempFilename?: string,
    ) => {
      const client = sessionManager.getClient();
      if (!client) {
        return { ok: false, error: 'Not connected to XNAT' };
      }

      try {
        const buffer = Buffer.from(dicomSegBase64, 'base64');
        console.log(
          `[uploadHandlers] Auto-saving to temp resource (${buffer.length} bytes, source scan: ${sourceScanId})`,
          tempFilename ? `filename: ${tempFilename}` : '',
        );

        const result = await client.autoSaveToTemp(sessionId, sourceScanId, buffer, tempFilename);
        return { ok: true, url: result.url };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[uploadHandlers] Auto-save to temp failed:', msg);
        return { ok: false, error: msg };
      }
    },
  );

  // ─── List temp resource files ──────────────────────────────────
  ipcMain.handle(
    IPC.XNAT_LIST_TEMP_FILES,
    async (_event, sessionId: string) => {
      const client = sessionManager.getClient();
      if (!client) {
        return { ok: false, error: 'Not connected to XNAT' };
      }

      try {
        const files = await client.listTempFiles(sessionId);
        return { ok: true, files };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[uploadHandlers] List temp files failed:', msg);
        return { ok: false, error: msg };
      }
    },
  );

  // ─── Delete temp resource file ─────────────────────────────────
  ipcMain.handle(
    IPC.XNAT_DELETE_TEMP_FILE,
    async (_event, sessionId: string, filename: string) => {
      const client = sessionManager.getClient();
      if (!client) {
        return { ok: false, error: 'Not connected to XNAT' };
      }

      try {
        await client.deleteTempFile(sessionId, filename);
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[uploadHandlers] Delete temp file failed:', msg);
        return { ok: false, error: msg };
      }
    },
  );

  // ─── Download temp resource file ───────────────────────────────
  ipcMain.handle(
    IPC.XNAT_DOWNLOAD_TEMP_FILE,
    async (_event, sessionId: string, filename: string) => {
      const client = sessionManager.getClient();
      if (!client) {
        return { ok: false, error: 'Not connected to XNAT' };
      }

      try {
        const buffer = await client.downloadTempFile(sessionId, filename);
        return { ok: true, data: buffer.toString('base64') };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[uploadHandlers] Download temp file failed:', msg);
        return { ok: false, error: msg };
      }
    },
  );

  // ─── Upload DICOM RTSTRUCT to XNAT (as a scan) ─────────────────
  ipcMain.handle(
    IPC.XNAT_UPLOAD_DICOM_RTSTRUCT,
    async (
      _event,
      projectId: string,
      subjectId: string,
      sessionId: string,
      sessionLabel: string,
      sourceScanId: string,
      dicomRtStructBase64: string,
      label?: string,
    ) => {
      const client = sessionManager.getClient();
      if (!client) {
        return { ok: false, error: 'Not connected to XNAT' };
      }

      try {
        const buffer = Buffer.from(dicomRtStructBase64, 'base64');
        console.log(
          `[uploadHandlers] Uploading DICOM RTSTRUCT (${buffer.length} bytes)`,
          `to ${projectId}/${subjectId}/${sessionLabel} (source scan: ${sourceScanId})`,
        );

        const result = await client.uploadDicomRtStructAsScan(
          projectId,
          subjectId,
          sessionId,
          sessionLabel,
          sourceScanId,
          buffer,
          label,
        );

        return { ok: true, url: result.url, scanId: result.scanId };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[uploadHandlers] RTSTRUCT upload failed:', msg);
        return { ok: false, error: msg };
      }
    },
  );
}
