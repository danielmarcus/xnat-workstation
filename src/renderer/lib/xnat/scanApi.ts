/**
 * xnatScanApi — the renderer's seam for the two XNAT scan calls the derived-object
 * load paths make: listing a session's scans and downloading a scan's file.
 *
 * Production routes straight to `electronAPI.xnat` (IPC → main process). The seam
 * exists because `electronAPI` is a contextBridge object and therefore immutable, so
 * an offline test cannot swap those calls out at the boundary — the same reason
 * `segmentationService.setSaveTransport` exists for the save path. Tests inject a
 * fake here and drive the REAL load logic above it.
 */
import type { XnatScan } from '@shared/types/xnat';

export interface ScanFileResult {
  ok: boolean;
  data?: string;
  error?: string;
}

export interface XnatScanApi {
  getScans(sessionId: string): Promise<XnatScan[]>;
  downloadScanFile(sessionId: string, scanId: string): Promise<ScanFileResult>;
}

const electronScanApi: XnatScanApi = {
  getScans: (sessionId) => window.electronAPI.xnat.getScans(sessionId),
  downloadScanFile: (sessionId, scanId) => window.electronAPI.xnat.downloadScanFile(sessionId, scanId),
};

let current: XnatScanApi = electronScanApi;

/** Stable facade — callers hold this, not the current implementation. */
export const xnatScanApi: XnatScanApi = {
  getScans: (sessionId) => current.getScans(sessionId),
  downloadScanFile: (sessionId, scanId) => current.downloadScanFile(sessionId, scanId),
};

/** Inject an implementation (pass null to restore the real IPC one). */
export function setXnatScanApi(api: XnatScanApi | null): void {
  current = api ?? electronScanApi;
}
