/**
 * Session Derived Index Store — maps source scans to their derived overlays.
 *
 * When session scans are loaded from XNAT, this store builds a lookup index
 * so that for any source imaging scan, we can instantly find associated SEG
 * and RTSTRUCT scans without re-scanning the full list.
 *
 * Primary resolution uses DICOM UID matching (SeriesInstanceUID from source
 * scans matched against ReferencedSeriesSequence UIDs from derived scans).
 * Scan ID conventions are not used for authoritative linkage.
 */
import { create } from 'zustand';
import { metaData } from '@cornerstonejs/core';
import { wadouri } from '@cornerstonejs/dicom-image-loader';
import type { XnatScan } from '@shared/types/xnat';
import { getSegReferenceInfo } from '../lib/dicom/segReferencedSeriesUid';
import { rtStructService } from '../lib/cornerstone/rtStructService';
import { pLimit } from '../lib/util/pLimit';

export interface DerivedScanIndex {
  segScans: XnatScan[];
  rtStructScans: XnatScan[];
}

const SEG_SOP_CLASS_UID = '1.2.840.10008.5.1.4.1.1.66.4';
const RTSTRUCT_SOP_CLASS_UID = '1.2.840.10008.5.1.4.1.1.481.3';

export function isSegScan(scan: XnatScan): boolean {
  return scan.sopClassUID === SEG_SOP_CLASS_UID;
}

export function isRtStructScan(scan: XnatScan): boolean {
  return scan.sopClassUID === RTSTRUCT_SOP_CLASS_UID;
}

export function isDerivedScan(scan: XnatScan): boolean {
  return isSegScan(scan) || isRtStructScan(scan);
}

interface SessionDerivedIndexState {
  /** Maps sourceScanId → { segScans, rtStructScans } */
  derivedIndex: Record<string, DerivedScanIndex>;

  /** Derived scans that couldn't be mapped to a source scan yet */
  unmapped: XnatScan[];

  /** Maps sessionId/scanId → SeriesInstanceUID (for source imaging scans) */
  sourceSeriesUidByScanId: Record<string, string>;

  /** Maps sessionId/derivedScanId → referenced SeriesInstanceUID */
  derivedRefSeriesUidByScanId: Record<string, string>;

  /** Sessions that have completed UID resolution */
  resolvedSessionIds: Set<string>;

  /**
   * Build a baseline derived index from a list of scans without any scan-number
   * conventions. Derived scans remain unmapped until UID associations are resolved.
   */
  buildDerivedIndex: (scans: XnatScan[]) => void;

  /**
   * Add a lazily-resolved mapping (e.g., after downloading and parsing a SEG file).
   */
  addMapping: (sourceScanId: string, derivedScan: XnatScan) => void;

  /** Get derived overlays for a source scan */
  getForSource: (sourceScanId: string) => DerivedScanIndex;

  /** Set the SeriesInstanceUID for a source scan */
  setSourceSeriesUid: (sessionId: string, scanId: string, seriesUid: string) => void;

  /** Set the referenced SeriesInstanceUID for a derived scan */
  setDerivedReferencedSeriesUid: (sessionId: string, derivedScanId: string, refSeriesUid: string) => void;

  /**
   * Rebuild derivedIndex using UID-based matching.
   * Unresolved derived scans remain unmapped until UIDs are available.
   */
  rebuildFromUids: (sessionId: string, allScans: XnatScan[]) => void;

  /**
   * Ensure we have the SeriesInstanceUID for a source scan (lazy, cached).
   * Loads one representative image to read its metadata.
   */
  ensureSourceSeriesUid: (
    sessionId: string,
    scanId: string,
    getScanImageIds: (sessionId: string, scanId: string) => Promise<string[]>,
  ) => Promise<string | null>;

  /**
   * Ensure we have the referenced SeriesInstanceUID for a derived scan (lazy, cached).
   * Downloads the DICOM file and parses its referenced series info.
   */
  ensureDerivedReferencedSeriesUid: (
    sessionId: string,
    derivedScanId: string,
    derivedScan: XnatScan,
    downloadScanFile: (sessionId: string, scanId: string) => Promise<ArrayBuffer>,
    sourceSopUidToSeriesUid?: Map<string, string>,
  ) => Promise<string | null>;

  /**
   * Resolve all UID associations for a session (idempotent).
   * Phase 1: Resolve source scan UIDs.
   * Phase 2: Resolve derived scan UIDs.
   * Phase 3: Rebuild index from UIDs.
   */
  resolveAssociationsForSession: (
    sessionId: string,
    scans: XnatScan[],
    getScanImageIds: (sessionId: string, scanId: string) => Promise<string[]>,
    downloadScanFile: (sessionId: string, scanId: string) => Promise<ArrayBuffer>,
  ) => Promise<void>;

  /** Clear the index (e.g., on session change) */
  clear: () => void;
}

const EMPTY_INDEX: DerivedScanIndex = { segScans: [], rtStructScans: [] };

/** Track in-progress resolution promises per session to handle concurrent calls */
const resolutionInProgress = new Map<string, Promise<void>>();

function toWadouriUri(imageId: string): string {
  return imageId.startsWith('wadouri:') ? imageId.slice('wadouri:'.length) : imageId;
}

function extractObjectUidFromImageId(imageId: string): string | null {
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

function sessionScanKey(sessionId: string, scanId: string): string {
  return `${sessionId}/${scanId}`;
}

export const useSessionDerivedIndexStore = create<SessionDerivedIndexState>((set, get) => ({
  derivedIndex: {},
  unmapped: [],
  sourceSeriesUidByScanId: {},
  derivedRefSeriesUidByScanId: {},
  resolvedSessionIds: new Set(),

  buildDerivedIndex: (scans) => {
    const index: Record<string, DerivedScanIndex> = {};
    const unmapped: XnatScan[] = [];

    // Initialize index entries for all non-derived scans
    for (const scan of scans) {
      if (!isDerivedScan(scan)) {
        if (!index[scan.id]) {
          index[scan.id] = { segScans: [], rtStructScans: [] };
        }
      }
    }

    // Map derived scans to their sources
    for (const scan of scans) {
      if (!isDerivedScan(scan)) continue;

      unmapped.push(scan);
    }

    set({ derivedIndex: index, unmapped });
    console.log(
      `[sessionDerivedIndex] Built baseline index: ${Object.keys(index).length} sources, ${unmapped.length} unmapped`
    );
  },

  addMapping: (sourceScanId, derivedScan) =>
    set((s) => {
      const existing = s.derivedIndex[sourceScanId] ?? { segScans: [], rtStructScans: [] };
      const updated = { ...existing };
      if (isSegScan(derivedScan)) {
        // Avoid duplicates
        if (!updated.segScans.some((sc) => sc.id === derivedScan.id)) {
          updated.segScans = [...updated.segScans, derivedScan];
        }
      } else if (isRtStructScan(derivedScan)) {
        if (!updated.rtStructScans.some((sc) => sc.id === derivedScan.id)) {
          updated.rtStructScans = [...updated.rtStructScans, derivedScan];
        }
      }
      // Remove from unmapped
      const unmapped = s.unmapped.filter((sc) => sc.id !== derivedScan.id);
      return {
        derivedIndex: { ...s.derivedIndex, [sourceScanId]: updated },
        unmapped,
      };
    }),

  getForSource: (sourceScanId) => {
    return get().derivedIndex[sourceScanId] ?? EMPTY_INDEX;
  },

  setSourceSeriesUid: (sessionId, scanId, seriesUid) =>
    set((s) => ({
      sourceSeriesUidByScanId: {
        ...s.sourceSeriesUidByScanId,
        [sessionScanKey(sessionId, scanId)]: seriesUid,
      },
    })),

  setDerivedReferencedSeriesUid: (sessionId, derivedScanId, refSeriesUid) =>
    set((s) => ({
      derivedRefSeriesUidByScanId: {
        ...s.derivedRefSeriesUidByScanId,
        [sessionScanKey(sessionId, derivedScanId)]: refSeriesUid,
      },
    })),

  rebuildFromUids: (sessionId, allScans) => {
    const state = get();
    const { sourceSeriesUidByScanId, derivedRefSeriesUidByScanId } = state;

    // Build reverse map: seriesUid → sourceScanId
    const seriesUidToSourceScanId: Record<string, string> = {};
    for (const scanId of allScans.map((s) => s.id)) {
      const uid = sourceSeriesUidByScanId[sessionScanKey(sessionId, scanId)];
      if (!uid) continue;
      seriesUidToSourceScanId[uid] = scanId;
    }

    const index: Record<string, DerivedScanIndex> = {};
    const unmapped: XnatScan[] = [];

    // Initialize index entries for all non-derived scans
    for (const scan of allScans) {
      if (!isDerivedScan(scan)) {
        if (!index[scan.id]) {
          index[scan.id] = { segScans: [], rtStructScans: [] };
        }
      }
    }

    let uidMatches = 0;
    // Map derived scans to their sources
    for (const scan of allScans) {
      if (!isDerivedScan(scan)) continue;

      let sourceScanId: string | null = null;

      // Primary: UID-based matching
      const refUid = derivedRefSeriesUidByScanId[sessionScanKey(sessionId, scan.id)];
      if (refUid && seriesUidToSourceScanId[refUid]) {
        sourceScanId = seriesUidToSourceScanId[refUid];
        uidMatches++;
      }

      if (sourceScanId) {
        if (!index[sourceScanId]) {
          index[sourceScanId] = { segScans: [], rtStructScans: [] };
        }
        if (isSegScan(scan)) {
          index[sourceScanId].segScans.push(scan);
        } else if (isRtStructScan(scan)) {
          index[sourceScanId].rtStructScans.push(scan);
        }
      } else {
        unmapped.push(scan);
      }
    }

    set({ derivedIndex: index, unmapped });
    console.log(
      `[sessionDerivedIndex] Rebuilt index from UIDs: ${uidMatches} UID matches, ${unmapped.length} unmapped`
    );
  },

  ensureSourceSeriesUid: async (sessionId, scanId, getScanImageIds) => {
    const cacheKey = sessionScanKey(sessionId, scanId);
    // Return cached value if present
    const cached = get().sourceSeriesUidByScanId[cacheKey];
    if (cached) return cached;

    try {
      const imageIds = await getScanImageIds(sessionId, scanId);
      if (imageIds.length === 0) return null;

      // Probe a few images without decoding pixel data (safe for non-pixel SOPs).
      // We only need SeriesInstanceUID, which is in the dataset header.
      const probeIds = imageIds.slice(0, Math.min(imageIds.length, 5));
      let firstError: unknown = null;

      for (const imageId of probeIds) {
        // Fast path: metadata may already be present from prior loads.
        const existingSeriesMeta = metaData.get('generalSeriesModule', imageId) as
          | { seriesInstanceUID?: string } | undefined;
        if (existingSeriesMeta?.seriesInstanceUID) {
          get().setSourceSeriesUid(sessionId, scanId, existingSeriesMeta.seriesInstanceUID);
          return existingSeriesMeta.seriesInstanceUID;
        }

        try {
          const uri = toWadouriUri(imageId);
          if (!wadouri.dataSetCacheManager.isLoaded(uri)) {
            await wadouri.dataSetCacheManager.load(uri, undefined as any, imageId);
          }
          const dataSet = wadouri.dataSetCacheManager.get(uri);
          const uid =
            dataSet?.string?.('x0020000e') ??
            (metaData.get('generalSeriesModule', imageId) as { seriesInstanceUID?: string } | undefined)
              ?.seriesInstanceUID ??
            null;
          if (uid) {
            get().setSourceSeriesUid(sessionId, scanId, uid);
            return uid;
          }
        } catch (err) {
          if (!firstError) firstError = err;
        }
      }

      if (firstError) {
        console.debug(`[sessionDerivedIndex] Could not resolve SeriesInstanceUID for source scan #${scanId}:`, firstError);
      }
      return null;
    } catch (err) {
      console.warn(`[sessionDerivedIndex] Failed to get SeriesInstanceUID for source scan #${scanId}:`, err);
      return null;
    }
  },

  ensureDerivedReferencedSeriesUid: async (
    sessionId,
    derivedScanId,
    derivedScan,
    downloadScanFile,
    sourceSopUidToSeriesUid,
  ) => {
    const cacheKey = sessionScanKey(sessionId, derivedScanId);
    // Return cached value if present
    const cached = get().derivedRefSeriesUidByScanId[cacheKey];
    if (cached) return cached;

    try {
      const arrayBuffer = await downloadScanFile(sessionId, derivedScanId);

      let refUid: string | null = null;

      if (isSegScan(derivedScan)) {
        const refInfo = getSegReferenceInfo(arrayBuffer);
        refUid = refInfo.referencedSeriesUID;

        if (!refUid && sourceSopUidToSeriesUid && refInfo.referencedSOPInstanceUIDs.length > 0) {
          for (const sopUid of refInfo.referencedSOPInstanceUIDs) {
            const mappedSeriesUid = sourceSopUidToSeriesUid.get(sopUid);
            if (mappedSeriesUid) {
              refUid = mappedSeriesUid;
              console.log(
                `[sessionDerivedIndex] SEG #${derivedScanId} resolved via SOP Instance UID fallback -> SeriesInstanceUID ${mappedSeriesUid}`,
              );
              break;
            }
          }
        }
      } else if (isRtStructScan(derivedScan)) {
        const parsed = rtStructService.parseRtStruct(arrayBuffer);
        refUid = parsed.referencedSeriesUID;
      }

      if (refUid) {
        get().setDerivedReferencedSeriesUid(sessionId, derivedScanId, refUid);
      }

      return refUid;
    } catch (err) {
      console.warn(`[sessionDerivedIndex] Failed to get referenced SeriesUID for derived scan #${derivedScanId}:`, err);
      return null;
    }
  },

  resolveAssociationsForSession: async (sessionId, scans, getScanImageIds, downloadScanFile) => {
    // Idempotent + context refresh: if already resolved, rebuild current
    // derivedIndex from cached UID associations for this session.
    if (get().resolvedSessionIds.has(sessionId)) {
      get().rebuildFromUids(sessionId, scans);
      return;
    }

    // Handle concurrent calls for the same session
    const existing = resolutionInProgress.get(sessionId);
    if (existing) {
      await existing;
      return;
    }

    const promise = (async () => {
      const startTime = Date.now();
      const sourceScans = scans.filter((s) => !isDerivedScan(s));
      const derivedScans = scans.filter((s) => isDerivedScan(s));

      console.log(
        `[sessionDerivedIndex] Resolving UID associations for session ${sessionId}: ` +
        `${sourceScans.length} source scans, ${derivedScans.length} derived scans`
      );

      // Phase 1: Resolve source scan SeriesInstanceUIDs (concurrency 5)
      const limit5 = pLimit(5);
      await Promise.all(
        sourceScans.map((s) =>
          limit5(() => get().ensureSourceSeriesUid(sessionId, s.id, getScanImageIds))
        )
      );

      // Build SOP Instance UID -> source SeriesInstanceUID lookup for SEG fallback.
      const sourceSopUidToSeriesUid = new Map<string, string>();
      await Promise.all(
        sourceScans.map((s) =>
          limit5(async () => {
            const seriesUid = get().sourceSeriesUidByScanId[sessionScanKey(sessionId, s.id)];
            if (!seriesUid) return;
            const imageIds = await getScanImageIds(sessionId, s.id);
            for (const imageId of imageIds) {
              const sopUid = extractObjectUidFromImageId(imageId);
              if (sopUid && !sourceSopUidToSeriesUid.has(sopUid)) {
                sourceSopUidToSeriesUid.set(sopUid, seriesUid);
              }
            }
          })
        )
      );

      // Phase 2: Resolve derived scan referenced SeriesInstanceUIDs (concurrency 3),
      // including SOP Instance UID fallback for SEG files.
      const limit3 = pLimit(3);
      await Promise.all(
        derivedScans.map((s) =>
          limit3(() =>
            get().ensureDerivedReferencedSeriesUid(
              sessionId,
              s.id,
              s,
              downloadScanFile,
              sourceSopUidToSeriesUid,
            )
          )
        )
      );

      // Phase 3: Rebuild index from UIDs
      get().rebuildFromUids(sessionId, scans);

      // Mark session as resolved
      set((s) => ({
        resolvedSessionIds: new Set([...s.resolvedSessionIds, sessionId]),
      }));

      const elapsed = Date.now() - startTime;
      console.log(`[sessionDerivedIndex] UID resolution complete for session ${sessionId} in ${elapsed}ms`);
    })();

    resolutionInProgress.set(sessionId, promise);

    try {
      await promise;
    } finally {
      resolutionInProgress.delete(sessionId);
    }
  },

  clear: () => set({
    derivedIndex: {},
    unmapped: [],
    sourceSeriesUidByScanId: {},
    derivedRefSeriesUidByScanId: {},
    resolvedSessionIds: new Set(),
  }),
}));
