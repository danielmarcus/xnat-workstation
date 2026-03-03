import { wadouri } from '@cornerstonejs/dicom-image-loader';
import { metaData } from '@cornerstonejs/core';
import type { XnatScan } from '@shared/types/xnat';

type MetaDataGet = typeof metaData.get;

type DataSetLike = { string?: (tag: string) => string | null | undefined };
type DataSetCacheManagerLike = {
  isLoaded: (uri: string) => boolean;
  load: (uri: string, ...args: unknown[]) => Promise<unknown>;
  get: (uri: string) => DataSetLike | undefined;
};

type ScanIdsLoader = (sessionId: string, scanId: string) => Promise<string[]>;

const recoveredSessions = new Set<string>();
const segLoadingLock = new Map<string, number>();

export const SEG_LOCK_STALE_MS = 30_000;

const SEG_SOP_CLASS_UID = '1.2.840.10008.5.1.4.1.1.66.4';
const RTSTRUCT_SOP_CLASS_UID = '1.2.840.10008.5.1.4.1.1.481.3';

function norm(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function isSegLikeScan(scan: XnatScan): boolean {
  if (norm(scan.xsiType) === 'xnat:segscandata') return true;
  if (scan.sopClassUID === SEG_SOP_CLASS_UID) return true;
  return norm(scan.type) === 'seg';
}

function isRtStructLikeScan(scan: XnatScan): boolean {
  if (scan.sopClassUID === RTSTRUCT_SOP_CLASS_UID) return true;
  if (norm(scan.xsiType) === 'xnat:rtimagescandata') return true;

  const type = norm(scan.type);
  const desc = norm(scan.seriesDescription);
  if (norm(scan.xsiType) === 'xnat:otherdicomscandata') {
    return (
      type === 'rtstruct' ||
      type === 'rt structure set' ||
      type === 'structure' ||
      type === 'structure set' ||
      desc.includes('rtstruct') ||
      desc.includes('rt structure') ||
      desc.includes('structure set')
    );
  }

  if (type === 'rtstruct' || type === 'rt structure set') return true;
  return false;
}

function isDerivedLikeScan(scan: XnatScan): boolean {
  return isSegLikeScan(scan) || isRtStructLikeScan(scan);
}

function isSrLikeScan(scan: XnatScan): boolean {
  if (norm(scan.xsiType) === 'xnat:srscandata') return true;
  return norm(scan.modality) === 'sr' || norm(scan.type) === 'sr';
}

export function isPrimaryImageScan(scan: XnatScan): boolean {
  if (isDerivedLikeScan(scan) || isSrLikeScan(scan)) return false;
  const xsiType = (scan.xsiType ?? '').trim().toLowerCase();
  if (xsiType === 'xnat:otherdicomscandata') return false;
  return true;
}

export function hasRecoveredSession(sessionId: string): boolean {
  return recoveredSessions.has(sessionId);
}

export function markRecoveredSession(sessionId: string): void {
  recoveredSessions.add(sessionId);
}

export function clearRecoveredSessions(): void {
  recoveredSessions.clear();
}

export function acquireSegLock(scanId: string, now: number = Date.now()): boolean {
  const existing = segLoadingLock.get(scanId);
  if (existing && (now - existing) < SEG_LOCK_STALE_MS) {
    console.warn(`[App] SEG scan #${scanId} already loading — ignoring duplicate click`);
    return false;
  }
  segLoadingLock.set(scanId, now);
  return true;
}

export function releaseSegLock(scanId: string): void {
  segLoadingLock.delete(scanId);
}

export function clearSegLoadingLocks(): void {
  segLoadingLock.clear();
}

export function toWadouriUri(imageId: string): string {
  return imageId.startsWith('wadouri:') ? imageId.slice('wadouri:'.length) : imageId;
}

export function extractObjectUidFromImageId(imageId: string): string | null {
  const uri = toWadouriUri(imageId);
  const queryStart = uri.indexOf('?');
  if (queryStart < 0) return null;
  const params = new URLSearchParams(uri.slice(queryStart + 1));
  return (
    params.get('objectUID') ??
    params.get('objectUid') ??
    params.get('SOPInstanceUID') ??
    params.get('sopInstanceUID')
  );
}

export function findPanelBySeriesUID(
  seriesUID: string,
  panelImageIds: Record<string, string[]>,
  metadataGet: MetaDataGet = metaData.get.bind(metaData),
): { panelId: string; imageIds: string[] } | null {
  for (const [pid, ids] of Object.entries(panelImageIds)) {
    if (ids.length === 0) continue;
    const seriesMeta = metadataGet('generalSeriesModule', ids[0]) as
      | { seriesInstanceUID?: string }
      | undefined;
    if (seriesMeta?.seriesInstanceUID === seriesUID) {
      return { panelId: pid, imageIds: ids };
    }
  }
  return null;
}

export function findPanelByReferencedSopInstanceUIDs(
  referencedSopInstanceUIDs: string[],
  panelImageIds: Record<string, string[]>,
  metadataGet: MetaDataGet = metaData.get.bind(metaData),
): { panelId: string; imageIds: string[] } | null {
  if (referencedSopInstanceUIDs.length === 0) return null;
  const target = new Set(referencedSopInstanceUIDs);

  for (const [pid, ids] of Object.entries(panelImageIds)) {
    if (ids.length === 0) continue;
    for (const imageId of ids) {
      const fromImageId = extractObjectUidFromImageId(imageId);
      if (fromImageId && target.has(fromImageId)) {
        return { panelId: pid, imageIds: ids };
      }

      const sopCommon = metadataGet('sopCommonModule', imageId) as
        | { sopInstanceUID?: string }
        | undefined;
      if (sopCommon?.sopInstanceUID && target.has(sopCommon.sopInstanceUID)) {
        return { panelId: pid, imageIds: ids };
      }
    }
  }

  return null;
}

export async function getSeriesUidForImageId(
  imageId: string,
  opts?: {
    metadataGet?: MetaDataGet;
    dataSetCacheManager?: DataSetCacheManagerLike;
  },
): Promise<string | null> {
  const metadataGet = opts?.metadataGet ?? metaData.get.bind(metaData);
  const dataSetCacheManager = opts?.dataSetCacheManager ?? wadouri.dataSetCacheManager;
  const seriesMeta = metadataGet('generalSeriesModule', imageId) as
    | { seriesInstanceUID?: string }
    | undefined;
  if (seriesMeta?.seriesInstanceUID) return seriesMeta.seriesInstanceUID;

  try {
    const uri = toWadouriUri(imageId);
    if (!dataSetCacheManager.isLoaded(uri)) {
      await dataSetCacheManager.load(uri, undefined, imageId);
    }
    const ds = dataSetCacheManager.get(uri);
    return ds?.string?.('x0020000e') ?? null;
  } catch {
    return null;
  }
}

export async function getSopInstanceUidForImageId(
  imageId: string,
  opts?: {
    metadataGet?: MetaDataGet;
    dataSetCacheManager?: DataSetCacheManagerLike;
  },
): Promise<string | null> {
  const metadataGet = opts?.metadataGet ?? metaData.get.bind(metaData);
  const dataSetCacheManager = opts?.dataSetCacheManager ?? wadouri.dataSetCacheManager;
  const fromImageId = extractObjectUidFromImageId(imageId);
  if (fromImageId) return fromImageId;

  const sopCommon = metadataGet('sopCommonModule', imageId) as
    | { sopInstanceUID?: string }
    | undefined;
  if (sopCommon?.sopInstanceUID) return sopCommon.sopInstanceUID;

  try {
    const uri = toWadouriUri(imageId);
    if (!dataSetCacheManager.isLoaded(uri)) {
      await dataSetCacheManager.load(uri, undefined, imageId);
    }
    const ds = dataSetCacheManager.get(uri);
    return ds?.string?.('x00080018') ?? null;
  } catch {
    return null;
  }
}

export async function findSourceScanBySeriesUID(
  sessionId: string,
  targetSeriesUID: string,
  scans: XnatScan[],
  deps: {
    getScanImageIds: ScanIdsLoader;
    getSeriesUidForImageId?: typeof getSeriesUidForImageId;
  },
): Promise<{ scanId: string; imageIds: string[] } | null> {
  const getScanImageIds = deps.getScanImageIds;
  const getSeriesUid = deps.getSeriesUidForImageId ?? getSeriesUidForImageId;
  const candidates = scans.filter((s) => isPrimaryImageScan(s));

  for (const scan of candidates) {
    try {
      const ids = await getScanImageIds(sessionId, scan.id);
      if (ids.length === 0) continue;

      const seriesUID = await getSeriesUid(ids[0]);
      if (seriesUID === targetSeriesUID) {
        return { scanId: scan.id, imageIds: ids };
      }
    } catch {
      // Skip failed scans and continue searching.
    }
  }
  return null;
}

export async function findSourceScanByReferencedSopInstanceUIDs(
  sessionId: string,
  referencedSopInstanceUIDs: string[],
  scans: XnatScan[],
  deps: {
    getScanImageIds: ScanIdsLoader;
    getSopInstanceUidForImageId?: typeof getSopInstanceUidForImageId;
  },
): Promise<{ scanId: string; imageIds: string[] } | null> {
  if (referencedSopInstanceUIDs.length === 0) return null;
  const getScanImageIds = deps.getScanImageIds;
  const getSopUid = deps.getSopInstanceUidForImageId ?? getSopInstanceUidForImageId;
  const target = new Set(referencedSopInstanceUIDs);
  const candidates = scans.filter((s) => isPrimaryImageScan(s));

  for (const scan of candidates) {
    try {
      const ids = await getScanImageIds(sessionId, scan.id);
      if (ids.length === 0) continue;

      const fastMatch = ids.some((imageId) => {
        const uid = extractObjectUidFromImageId(imageId);
        return !!uid && target.has(uid);
      });
      if (fastMatch) {
        return { scanId: scan.id, imageIds: ids };
      }

      const probeIds = ids.slice(0, Math.min(ids.length, 8));
      for (const imageId of probeIds) {
        const uid = await getSopUid(imageId);
        if (uid && target.has(uid)) {
          return { scanId: scan.id, imageIds: ids };
        }
      }
    } catch {
      // Skip failed scans and continue searching.
    }
  }

  return null;
}
