/**
 * xnatScanApi — the renderer's seam for the two XNAT scan calls the derived-object
 * load paths make: listing a session's scans and downloading a scan's file. Derived-scan
 * files are downloaded through downloadDerivedScanFile, which shares one download.
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
  data?: Uint8Array;
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
  forgetDerivedScanFiles();
}

const derivedScanFiles = new Map<string, Promise<Uint8Array>>();
/** The session a load is under way for (keepOnlyDerivedScanFilesOf); its files are never evicted by another's. */
let loadingSessionId: string | null = null;

const derivedScanFileKey = (sessionId: string, scanId: string) => `${sessionId}|${scanId}`;

/**
 * The file of a derived scan (SEG, RTSTRUCT, SR), downloaded once for a session or scan
 * load: resolving the session's derived index and loading the overlays both need it.
 * Only the loading session's files and the latest other session's are kept. Every caller
 * gets its own copy of the bytes.
 */
export function downloadDerivedScanFile(sessionId: string, scanId: string): Promise<ArrayBuffer> {
  const key = derivedScanFileKey(sessionId, scanId);
  let file = derivedScanFiles.get(key);
  if (!file) {
    // Expanding sessions in the XNAT browser downloads their files too: keep only this
    // session's, plus those of a session being loaded (a browser expansion during its load
    // must not throw away files the load is about to use).
    dropDerivedScanFilesExcept(sessionId, loadingSessionId);
    const download = fetchScanFile(sessionId, scanId);
    download.catch(() => {
      if (derivedScanFiles.get(key) === download) derivedScanFiles.delete(key);
    });
    derivedScanFiles.set(key, download);
    file = download;
  }
  return file.then((bytes) => bytes.slice().buffer);
}

/**
 * Drop downloaded derived-scan files: one session's after the app writes to its scans,
 * or all of them when a load ends or the connection changes.
 */
export function forgetDerivedScanFiles(sessionId?: string): void {
  if (!sessionId) {
    derivedScanFiles.clear();
    loadingSessionId = null;
    return;
  }
  const prefix = derivedScanFileKey(sessionId, '');
  for (const key of Array.from(derivedScanFiles.keys())) {
    if (key.startsWith(prefix)) derivedScanFiles.delete(key);
  }
}

/**
 * Drop every session's files but this one's, when its load starts. Its own stay: selecting
 * the session in the XNAT browser may already be downloading them for this load.
 */
export function keepOnlyDerivedScanFilesOf(sessionId: string): void {
  loadingSessionId = sessionId;
  dropDerivedScanFilesExcept(sessionId, null);
}

function dropDerivedScanFilesExcept(sessionId: string, alsoKeep: string | null): void {
  const keep = [sessionId, alsoKeep].filter((id): id is string => !!id).map((id) => derivedScanFileKey(id, ''));
  for (const key of Array.from(derivedScanFiles.keys())) {
    if (!keep.some((prefix) => key.startsWith(prefix))) derivedScanFiles.delete(key);
  }
}

async function fetchScanFile(sessionId: string, scanId: string): Promise<Uint8Array> {
  const result = await current.downloadScanFile(sessionId, scanId);
  if (!result.ok || !result.data?.byteLength) {
    throw new Error(result.error || 'Failed to download scan file');
  }
  return result.data;
}
