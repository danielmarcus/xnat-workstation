/**
 * Session Derived Index Store — maps source scans to their derived overlays.
 *
 * When session scans are loaded from XNAT, this store builds a lookup index
 * so that for any source imaging scan, we can instantly find associated SEG
 * and RTSTRUCT scans without re-scanning the full list.
 *
 * Primary resolution uses DICOM UID matching (SeriesInstanceUID from source
 * scans matched against ReferencedSeriesSequence UIDs from derived scans).
 * Falls back to scan ID convention (30xx→source xx) when UIDs are unavailable.
 */
import { create } from 'zustand';
import { imageLoader, cache, metaData } from '@cornerstonejs/core';
import type { XnatScan } from '@shared/types/xnat';
import { getReferencedSeriesUID } from '../lib/dicom/segReferencedSeriesUid';
import { getSourceScanId } from '../lib/dicom/scanIdConvention';
import { rtStructService } from '../lib/cornerstone/rtStructService';
import { pLimit } from '../lib/util/pLimit';

export interface DerivedScanIndex {
  segScans: XnatScan[];
  rtStructScans: XnatScan[];
}

export function isSegScan(scan: XnatScan): boolean {
  return scan.type?.toUpperCase() === 'SEG';
}

export function isRtStructScan(scan: XnatScan): boolean {
  const t = scan.type?.toUpperCase();
  return t === 'RTSTRUCT' || t === 'RT';
}

export function isDerivedScan(scan: XnatScan): boolean {
  return isSegScan(scan) || isRtStructScan(scan);
}

interface SessionDerivedIndexState {
  /** Maps sourceScanId → { segScans, rtStructScans } */
  derivedIndex: Record<string, DerivedScanIndex>;

  /** Derived scans that couldn't be mapped to a source scan yet */
  unmapped: XnatScan[];

  /** Maps scanId → SeriesInstanceUID (for source imaging scans) */
  sourceSeriesUidByScanId: Record<string, string>;

  /** Maps derivedScanId → referenced SeriesInstanceUID */
  derivedRefSeriesUidByScanId: Record<string, string>;

  /** Sessions that have completed UID resolution */
  resolvedSessionIds: Set<string>;

  /**
   * Build the derived index from a list of scans.
   * @param scans All scans in the session
   * @param resolveSourceScanId Function that maps a derived scan to its source scan ID.
   *   Returns null if the mapping can't be determined.
   */
  buildDerivedIndex: (
    scans: XnatScan[],
    resolveSourceScanId: (derivedScan: XnatScan) => string | null,
  ) => void;

  /**
   * Add a lazily-resolved mapping (e.g., after downloading and parsing a SEG file).
   */
  addMapping: (sourceScanId: string, derivedScan: XnatScan) => void;

  /** Get derived overlays for a source scan */
  getForSource: (sourceScanId: string) => DerivedScanIndex;

  /** Set the SeriesInstanceUID for a source scan */
  setSourceSeriesUid: (scanId: string, seriesUid: string) => void;

  /** Set the referenced SeriesInstanceUID for a derived scan */
  setDerivedReferencedSeriesUid: (derivedScanId: string, refSeriesUid: string) => void;

  /**
   * Rebuild derivedIndex using UID-based matching.
   * Falls back to scan ID convention when UID miss.
   */
  rebuildFromUids: (allScans: XnatScan[]) => void;

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

export const useSessionDerivedIndexStore = create<SessionDerivedIndexState>((set, get) => ({
  derivedIndex: {},
  unmapped: [],
  sourceSeriesUidByScanId: {},
  derivedRefSeriesUidByScanId: {},
  resolvedSessionIds: new Set(),

  buildDerivedIndex: (scans, resolveSourceScanId) => {
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

      const sourceScanId = resolveSourceScanId(scan);
      if (sourceScanId && index[sourceScanId]) {
        if (isSegScan(scan)) {
          index[sourceScanId].segScans.push(scan);
        } else if (isRtStructScan(scan)) {
          index[sourceScanId].rtStructScans.push(scan);
        }
      } else if (sourceScanId) {
        // Source scan exists by ID convention but wasn't in the imaging scans list
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
      `[sessionDerivedIndex] Built index: ${Object.keys(index).length} sources, ${unmapped.length} unmapped`
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

  setSourceSeriesUid: (scanId, seriesUid) =>
    set((s) => ({
      sourceSeriesUidByScanId: { ...s.sourceSeriesUidByScanId, [scanId]: seriesUid },
    })),

  setDerivedReferencedSeriesUid: (derivedScanId, refSeriesUid) =>
    set((s) => ({
      derivedRefSeriesUidByScanId: { ...s.derivedRefSeriesUidByScanId, [derivedScanId]: refSeriesUid },
    })),

  rebuildFromUids: (allScans) => {
    const state = get();
    const { sourceSeriesUidByScanId, derivedRefSeriesUidByScanId } = state;

    // Build reverse map: seriesUid → sourceScanId
    const seriesUidToSourceScanId: Record<string, string> = {};
    for (const [scanId, uid] of Object.entries(sourceSeriesUidByScanId)) {
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
    let conventionFallbacks = 0;

    // Map derived scans to their sources
    for (const scan of allScans) {
      if (!isDerivedScan(scan)) continue;

      let sourceScanId: string | null = null;

      // Primary: UID-based matching
      const refUid = derivedRefSeriesUidByScanId[scan.id];
      if (refUid && seriesUidToSourceScanId[refUid]) {
        sourceScanId = seriesUidToSourceScanId[refUid];
        uidMatches++;
      }

      // Fallback: scan ID convention
      if (!sourceScanId) {
        sourceScanId = getSourceScanId(scan.id);
        if (sourceScanId) {
          console.log(`[sessionDerivedIndex] Fallback to convention for derived scan #${scan.id} → source #${sourceScanId}`);
          conventionFallbacks++;
        }
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
      `[sessionDerivedIndex] Rebuilt index from UIDs: ${uidMatches} UID matches, ${conventionFallbacks} convention fallbacks, ${unmapped.length} unmapped`
    );
  },

  ensureSourceSeriesUid: async (sessionId, scanId, getScanImageIds) => {
    // Return cached value if present
    const cached = get().sourceSeriesUidByScanId[scanId];
    if (cached) return cached;

    try {
      const imageIds = await getScanImageIds(sessionId, scanId);
      if (imageIds.length === 0) return null;

      const firstImageId = imageIds[0];

      // Load + cache the first image so metadata is available
      await imageLoader.loadAndCacheImage(firstImageId);

      const seriesMeta = metaData.get('generalSeriesModule', firstImageId) as
        | { seriesInstanceUID?: string } | undefined;
      const uid = seriesMeta?.seriesInstanceUID ?? null;

      if (uid) {
        get().setSourceSeriesUid(scanId, uid);
      }

      return uid;
    } catch (err) {
      console.warn(`[sessionDerivedIndex] Failed to get SeriesInstanceUID for source scan #${scanId}:`, err);
      return null;
    }
  },

  ensureDerivedReferencedSeriesUid: async (sessionId, derivedScanId, derivedScan, downloadScanFile) => {
    // Return cached value if present
    const cached = get().derivedRefSeriesUidByScanId[derivedScanId];
    if (cached) return cached;

    try {
      const arrayBuffer = await downloadScanFile(sessionId, derivedScanId);

      let refUid: string | null = null;

      if (isSegScan(derivedScan)) {
        refUid = getReferencedSeriesUID(arrayBuffer);
      } else if (isRtStructScan(derivedScan)) {
        const parsed = rtStructService.parseRtStruct(arrayBuffer);
        refUid = parsed.referencedSeriesUID;
      }

      if (refUid) {
        get().setDerivedReferencedSeriesUid(derivedScanId, refUid);
      }

      return refUid;
    } catch (err) {
      console.warn(`[sessionDerivedIndex] Failed to get referenced SeriesUID for derived scan #${derivedScanId}:`, err);
      return null;
    }
  },

  resolveAssociationsForSession: async (sessionId, scans, getScanImageIds, downloadScanFile) => {
    // Idempotent: skip if already resolved
    if (get().resolvedSessionIds.has(sessionId)) return;

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

      // Phase 2: Resolve derived scan referenced SeriesInstanceUIDs (concurrency 3)
      const limit3 = pLimit(3);
      await Promise.all(
        derivedScans.map((s) =>
          limit3(() => get().ensureDerivedReferencedSeriesUid(sessionId, s.id, s, downloadScanFile))
        )
      );

      // Phase 3: Rebuild index from UIDs
      get().rebuildFromUids(scans);

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
