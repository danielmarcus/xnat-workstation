/**
 * Export IPC Handlers — handles save-to-file, clipboard copy, and DICOM
 * export requests from the renderer process.
 *
 * All file I/O stays in the main process; the renderer sends base64 data
 * through the IPC bridge.
 */
import {
  ipcMain,
  dialog,
  clipboard,
  nativeImage,
  BrowserWindow,
} from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { IPC } from '../../shared/ipcChannels';

export function registerExportHandlers(): void {
  console.log('[ipc] Export handlers registered');

  // ─── Save Screenshot to File ──────────────────────────────────
  ipcMain.handle(
    IPC.EXPORT_SAVE_SCREENSHOT,
    async (_event, dataUrl: string, defaultName?: string) => {
      try {
        const win = BrowserWindow.getFocusedWindow();
        if (!win) return { ok: false, error: 'No focused window' };

        const result = await dialog.showSaveDialog(win, {
          defaultPath: defaultName ?? 'screenshot.png',
          filters: [
            { name: 'PNG Image', extensions: ['png'] },
            { name: 'JPEG Image', extensions: ['jpg', 'jpeg'] },
          ],
        });

        if (result.canceled || !result.filePath) {
          return { ok: false };
        }

        // For JPEG: re-encode through nativeImage for proper format conversion
        const ext = path.extname(result.filePath).toLowerCase();
        let buffer: Buffer;

        if (ext === '.jpg' || ext === '.jpeg') {
          const img = nativeImage.createFromDataURL(dataUrl);
          buffer = img.toJPEG(92);
        } else {
          const img = nativeImage.createFromDataURL(dataUrl);
          buffer = img.toPNG();
        }

        await fs.writeFile(result.filePath, buffer);
        return { ok: true, path: result.filePath };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[exportHandlers] saveScreenshot error:', msg);
        return { ok: false, error: msg };
      }
    },
  );

  // ─── Copy to Clipboard ────────────────────────────────────────
  ipcMain.handle(
    IPC.EXPORT_COPY_CLIPBOARD,
    async (_event, dataUrl: string) => {
      try {
        const img = nativeImage.createFromDataURL(dataUrl);
        clipboard.writeImage(img);
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[exportHandlers] copyToClipboard error:', msg);
        return { ok: false, error: msg };
      }
    },
  );

  // ─── Save All Slices to Folder ───────────────────────────────
  ipcMain.handle(
    IPC.EXPORT_SAVE_ALL_SLICES,
    async (
      _event,
      slices: Array<{ dataUrl: string; filename: string }>,
    ) => {
      try {
        const win = BrowserWindow.getFocusedWindow();
        if (!win) return { ok: false, error: 'No focused window' };

        const result = await dialog.showOpenDialog(win, {
          title: 'Select folder to save all slices',
          properties: ['openDirectory', 'createDirectory'],
        });

        if (result.canceled || !result.filePaths[0]) {
          return { ok: false };
        }

        const dir = result.filePaths[0];
        let count = 0;

        for (const slice of slices) {
          const img = nativeImage.createFromDataURL(slice.dataUrl);
          const buffer = img.toPNG();
          await fs.writeFile(path.join(dir, slice.filename), buffer);
          count++;
        }

        return { ok: true, path: dir, count };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[exportHandlers] saveAllSlices error:', msg);
        return { ok: false, error: msg };
      }
    },
  );

  // ─── Save Annotation Report ─────────────────────────────────
  ipcMain.handle(
    IPC.EXPORT_SAVE_REPORT,
    async (_event, text: string, defaultName?: string) => {
      try {
        const win = BrowserWindow.getFocusedWindow();
        if (!win) return { ok: false, error: 'No focused window' };

        const result = await dialog.showSaveDialog(win, {
          defaultPath: defaultName ?? 'annotations-report.csv',
          filters: [
            { name: 'CSV File', extensions: ['csv'] },
            { name: 'Text File', extensions: ['txt'] },
            { name: 'All Files', extensions: ['*'] },
          ],
        });

        if (result.canceled || !result.filePath) {
          return { ok: false };
        }

        await fs.writeFile(result.filePath, text, 'utf-8');
        return { ok: true, path: result.filePath };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[exportHandlers] saveReport error:', msg);
        return { ok: false, error: msg };
      }
    },
  );

  // ─── Save DICOM SEG File ──────────────────────────────────────
  ipcMain.handle(
    IPC.EXPORT_SAVE_DICOM_SEG,
    async (_event, dicomBase64: string, defaultName?: string) => {
      try {
        const win = BrowserWindow.getFocusedWindow();
        if (!win) return { ok: false, error: 'No focused window' };

        const result = await dialog.showSaveDialog(win, {
          defaultPath: defaultName ?? 'segmentation.dcm',
          filters: [
            { name: 'DICOM SEG File', extensions: ['dcm'] },
            { name: 'All Files', extensions: ['*'] },
          ],
        });

        if (result.canceled || !result.filePath) {
          return { ok: false };
        }

        const buffer = Buffer.from(dicomBase64, 'base64');
        await fs.writeFile(result.filePath, buffer);
        console.log(`[exportHandlers] Saved DICOM SEG (${buffer.length} bytes) to ${result.filePath}`);
        return { ok: true, path: result.filePath };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[exportHandlers] saveDicomSeg error:', msg);
        return { ok: false, error: msg };
      }
    },
  );

  // ─── Save DICOM RTSTRUCT File ───────────────────────────────────
  ipcMain.handle(
    IPC.EXPORT_SAVE_DICOM_RTSTRUCT,
    async (_event, dicomBase64: string, defaultName?: string) => {
      try {
        const win = BrowserWindow.getFocusedWindow();
        if (!win) return { ok: false, error: 'No focused window' };

        const result = await dialog.showSaveDialog(win, {
          defaultPath: defaultName ?? 'rtstruct.dcm',
          filters: [
            { name: 'DICOM RTSTRUCT File', extensions: ['dcm'] },
            { name: 'All Files', extensions: ['*'] },
          ],
        });

        if (result.canceled || !result.filePath) {
          return { ok: false };
        }

        const buffer = Buffer.from(dicomBase64, 'base64');
        await fs.writeFile(result.filePath, buffer);
        console.log(`[exportHandlers] Saved DICOM RTSTRUCT (${buffer.length} bytes) to ${result.filePath}`);
        return { ok: true, path: result.filePath };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[exportHandlers] saveDicomRtStruct error:', msg);
        return { ok: false, error: msg };
      }
    },
  );

  // ─── Save DICOM File ─────────────────────────────────────────
  ipcMain.handle(
    IPC.EXPORT_SAVE_DICOM,
    async (_event, dicomBase64: string) => {
      try {
        const win = BrowserWindow.getFocusedWindow();
        if (!win) return { ok: false, error: 'No focused window' };

        const result = await dialog.showSaveDialog(win, {
          defaultPath: 'image.dcm',
          filters: [
            { name: 'DICOM File', extensions: ['dcm'] },
            { name: 'All Files', extensions: ['*'] },
          ],
        });

        if (result.canceled || !result.filePath) {
          return { ok: false };
        }

        const buffer = Buffer.from(dicomBase64, 'base64');
        await fs.writeFile(result.filePath, buffer);
        return { ok: true, path: result.filePath };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[exportHandlers] saveDicom error:', msg);
        return { ok: false, error: msg };
      }
    },
  );
}
