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
const XSI_SEG = 'xnat:segscandata';
const XSI_SR = 'xnat:srscandata';
const XSI_OTHER_DICOM = 'xnat:otherdicomscandata';
const XSI_RT_IMAGE = 'xnat:rtimagescandata';

function norm(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function isSegScan(scan: XnatScan): boolean {
  const xsiType = norm(scan.xsiType);
  if (xsiType === XSI_SEG) return true;
  if (scan.sopClassUID === SEG_SOP_CLASS_UID) return true;
  return norm(scan.type) === 'seg';
}

export function isRtStructScan(scan: XnatScan): boolean {
  const xsiType = norm(scan.xsiType);
  if (scan.sopClassUID === RTSTRUCT_SOP_CLASS_UID) return true;

  // Our uploads create scans with xnat:rtImageScanData — recognise this directly.
  if (xsiType === XSI_RT_IMAGE) return true;

  // Metadata-first path requested by product:
  // RTSTRUCT rows are expected to arrive as xnat:otherDicomScanData.
  // Guard with type/description heuristics so other DICOM objects under the same
  // xsiType are filtered out for now.
  if (xsiType === XSI_OTHER_DICOM) {
    const type = norm(scan.type);
    const desc = norm(scan.seriesDescription);
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

  // Fallback: type/description heuristics regardless of xsiType, so that
  // scans created by external tools with unexpected xsiTypes are still caught.
  const type = norm(scan.type);
  if (type === 'rtstruct' || type === 'rt structure set') return true;

  return false;
}

export function isDerivedScan(scan: XnatScan): boolean {
  return isSegScan(scan) || isRtStructScan(scan);
}

export function isSrScan(scan: XnatScan): boolean {
  const xsiType = norm(scan.xsiType);
  if (xsiType === XSI_SR) return true;
  return norm(scan.modality) === 'sr' || norm(scan.type) === 'sr';
}

/**
 * Infer the source scan ID from the derived scan's ID using the app's naming
 * convention: SEG scans use prefix 3x (30xx, 31xx, …) and RTSTRUCT scans use
 * prefix 4x (40xx, 41xx, …), where the suffix is the zero-padded source scan
 * number. Returns null if the scan doesn't match the convention or isn't
 * classified as the expected type.
 */
export function inferSourceScanIdFromConvention(scan: XnatScan): string | null {
  const id = scan.id;
  // Must be at least 3 digits (prefix digit + suffix of 2+)
  if (!/^\d{3,}$/.test(id)) return null;

  const firstDigit = id.charCodeAt(0) - 48; // '0' = 48

  if (firstDigit === 3 && isSegScan(scan)) {
    // SEG convention: 3Nxx where N is 0-9, xx is zero-padded source scan ID
    const suffix = id.slice(2); // skip the 2-char prefix (e.g. "30", "31")
    return String(parseInt(suffix, 10)); // strip leading zeros
  }

  if (firstDigit === 4 && isRtStructScan(scan)) {
    // RTSTRUCT convention: 4Nxx where N is 0-9, xx is zero-padded source scan ID
    const suffix = id.slice(2);
    return String(parseInt(suffix, 10));
  }

  return null;
}

const PROVISIONAL_UID_PREFIX = 'provisional:';

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

  /** Derived scans mapped via scan-ID convention heuristic (sessionId/derivedScanId → sourceScanId) */
  provisionalMappings: Record<string, string>;

  /**
   * Build a baseline derived index from a list of scans without any scan-number
   * conventions. Derived scans remain unmapped until UID associations are resolved.
   */
  buildDerivedIndex: (scans: XnatScan[]) => void;

  /**
   * Instantly map derived scans to source scans using the scan-ID naming
   * convention (30xx→SEG, 40xx→RTSTRUCT). Seeds provisional placeholder UIDs
   * into the UID maps so overlay counts render immediately. UID resolution
   * later overwrites these with real UIDs and corrects any mismatches.
   */
  buildProvisionalIndex: (sessionId: string, scans: XnatScan[]) => void;

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
  provisionalMappings: {},

  buildProvisionalIndex: (sessionId, scans) => {
    const sourceIds = new Set(scans.filter((s) => !isDerivedScan(s)).map((s) => s.id));
    const derivedScans = scans.filter((s) => isDerivedScan(s));
    const newProvisional: Record<string, string> = {};
    const newSourceUids: Record<string, string> = {};
    const newDerivedRefUids: Record<string, string> = {};

    for (const derived of derivedScans) {
      const inferredSourceId = inferSourceScanIdFromConvention(derived);
      if (!inferredSourceId || !sourceIds.has(inferredSourceId)) continue;

      const derivedKey = sessionScanKey(sessionId, derived.id);
      const sourceKey = sessionScanKey(sessionId, inferredSourceId);

      // Track as provisional so UID resolution can correct if wrong
      newProvisional[derivedKey] = inferredSourceId;

      // Seed placeholder UIDs so overlayCountsBySessionSourceScanId picks them up
      const placeholderUid = `${PROVISIONAL_UID_PREFIX}${inferredSourceId}`;
      if (!get().sourceSeriesUidByScanId[sourceKey]) {
        newSourceUids[sourceKey] = placeholderUid;
      }
      newDerivedRefUids[derivedKey] = placeholderUid;
    }

    if (Object.keys(newProvisional).length === 0) return;

    set((s) => ({
      provisionalMappings: { ...s.provisionalMappings, ...newProvisional },
      sourceSeriesUidByScanId: { ...s.sourceSeriesUidByScanId, ...newSourceUids },
      derivedRefSeriesUidByScanId: { ...s.derivedRefSeriesUidByScanId, ...newDerivedRefUids },
    }));

    // Also populate the derivedIndex for overlayCountsBySourceScanId consumers
    for (const derived of derivedScans) {
      const derivedKey = sessionScanKey(sessionId, derived.id);
      const inferredSourceId = newProvisional[derivedKey];
      if (inferredSourceId) {
        get().addMapping(inferredSourceId, derived);
      }
    }

    console.log(
      `[sessionDerivedIndex] Provisional index: ${Object.keys(newProvisional).length} convention-based mappings for session ${sessionId}`,
    );
  },

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

    // Build reverse map: seriesUid → sourceScanId (skip provisional placeholders)
    const seriesUidToSourceScanId: Record<string, string> = {};
    for (const scanId of allScans.map((s) => s.id)) {
      const uid = sourceSeriesUidByScanId[sessionScanKey(sessionId, scanId)];
      if (!uid || uid.startsWith(PROVISIONAL_UID_PREFIX)) continue;
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

      // Primary: UID-based matching (skip provisional placeholders)
      const refUid = derivedRefSeriesUidByScanId[sessionScanKey(sessionId, scan.id)];
      if (refUid && !refUid.startsWith(PROVISIONAL_UID_PREFIX) && seriesUidToSourceScanId[refUid]) {
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
    // Return cached value if present (provisional placeholders don't count)
    const cached = get().sourceSeriesUidByScanId[cacheKey];
    if (cached && !cached.startsWith(PROVISIONAL_UID_PREFIX)) return cached;

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
    // Return cached value if present (provisional placeholders don't count)
    const cached = get().derivedRefSeriesUidByScanId[cacheKey];
    if (cached && !cached.startsWith(PROVISIONAL_UID_PREFIX)) return cached;

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
    const state = get();
    const sourceScans = scans.filter((s) => !isDerivedScan(s));
    const derivedScans = scans.filter((s) => isDerivedScan(s));

    const hasRealUid = (uid: string | undefined): boolean =>
      Boolean(uid) && !uid!.startsWith(PROVISIONAL_UID_PREFIX);

    const hasMissingSourceUid = sourceScans.some(
      (scan) => !hasRealUid(state.sourceSeriesUidByScanId[sessionScanKey(sessionId, scan.id)]),
    );
    const hasMissingDerivedRefUid = derivedScans.some(
      (scan) => !hasRealUid(state.derivedRefSeriesUidByScanId[sessionScanKey(sessionId, scan.id)]),
    );

    // Idempotent + context refresh:
    // - If fully resolved, just rebuild from cached UIDs.
    // - If marked resolved but missing UID state, retry resolution.
    if (state.resolvedSessionIds.has(sessionId) && !hasMissingSourceUid && !hasMissingDerivedRefUid) {
      state.rebuildFromUids(sessionId, scans);
      return;
    }

    if (state.resolvedSessionIds.has(sessionId) && (hasMissingSourceUid || hasMissingDerivedRefUid)) {
      console.warn(
        `[sessionDerivedIndex] Session ${sessionId} marked resolved but has missing UID state ` +
        `(missingSource=${hasMissingSourceUid}, missingDerived=${hasMissingDerivedRefUid}); retrying`,
      );
    }

    // Handle concurrent calls for the same session
    const existing = resolutionInProgress.get(sessionId);
    if (existing) {
      await existing;
      return;
    }

    const promise = (async () => {
      const startTime = Date.now();

      // Instant provisional mapping from scan ID convention — renders badge
      // counts immediately while real UID resolution runs in the background.
      get().buildProvisionalIndex(sessionId, scans);

      console.log(
        `[sessionDerivedIndex] Resolving UID associations for session ${sessionId}: ` +
        `${sourceScans.length} source scans, ${derivedScans.length} derived scans`
      );

      const limitSource = pLimit(8);
      const limitDerived = pLimit(8);

      // Reuse downloaded derived files across phases.
      const derivedFileCache = new Map<string, ArrayBuffer>();
      const downloadDerivedCached = async (sid: string, scanId: string): Promise<ArrayBuffer> => {
        const key = sessionScanKey(sid, scanId);
        const cached = derivedFileCache.get(key);
        if (cached) return cached;
        const buf = await downloadScanFile(sid, scanId);
        derivedFileCache.set(key, buf);
        return buf;
      };

      // Helper: try to incrementally map a derived scan to its source as soon
      // as its referenced UID resolves. If the matching source UID hasn't been
      // resolved yet (phases run in parallel), the final rebuildFromUids catches it.
      const tryIncrementalMap = (derivedScan: XnatScan) => {
        const refUid = get().derivedRefSeriesUidByScanId[sessionScanKey(sessionId, derivedScan.id)];
        if (!refUid) return;
        const { sourceSeriesUidByScanId } = get();
        for (const src of sourceScans) {
          const srcUid = sourceSeriesUidByScanId[sessionScanKey(sessionId, src.id)];
          if (srcUid === refUid) {
            get().addMapping(src.id, derivedScan);
            return;
          }
        }
      };

      // Phases 1 & 2a run in parallel — source UID resolution and derived file
      // downloads are independent. Derived scans are incrementally mapped to
      // source scans as their UIDs resolve.
      await Promise.all([
        // Phase 1: Resolve source scan SeriesInstanceUIDs
        Promise.all(
          sourceScans.map((s) =>
            limitSource(() => get().ensureSourceSeriesUid(sessionId, s.id, getScanImageIds))
          )
        ),
        // Phase 2a: Resolve derived scan referenced SeriesInstanceUIDs
        Promise.all(
          derivedScans.map((s) =>
            limitDerived(async () => {
              await get().ensureDerivedReferencedSeriesUid(
                sessionId,
                s.id,
                s,
                downloadDerivedCached,
              );
              tryIncrementalMap(s);
            })
          )
        ),
      ]);

      // Phase 2b (conditional): only if there are SEG scans that still lack
      // referenced series UIDs, build SOP->Series lookup and retry those scans.
      const unresolvedSegScans = derivedScans.filter((s) => {
        if (!isSegScan(s)) return false;
        const refUid = get().derivedRefSeriesUidByScanId[sessionScanKey(sessionId, s.id)];
        return !refUid || refUid.startsWith(PROVISIONAL_UID_PREFIX);
      });

      if (unresolvedSegScans.length > 0) {
        console.log(
          `[sessionDerivedIndex] ${unresolvedSegScans.length} SEG scan(s) missing ReferencedSeriesSequence UID; ` +
          `building SOP fallback map`,
        );

        const sourceSopUidToSeriesUid = new Map<string, string>();
        await Promise.all(
          sourceScans.map((s) =>
            limitSource(async () => {
              const seriesUid = get().sourceSeriesUidByScanId[sessionScanKey(sessionId, s.id)];
              if (!seriesUid) return;
              const imageIds = await getScanImageIds(sessionId, s.id);
              for (const imageId of imageIds) {
                const sopUid = extractObjectUidFromImageId(imageId);
                if (sopUid && !sourceSopUidToSeriesUid.has(sopUid)) {
                  sourceSopUidToSeriesUid.set(sopUid, seriesUid);
                }
              }
            }),
          ),
        );

        await Promise.all(
          unresolvedSegScans.map((s) =>
            limitDerived(async () => {
              await get().ensureDerivedReferencedSeriesUid(
                sessionId,
                s.id,
                s,
                downloadDerivedCached,
                sourceSopUidToSeriesUid,
              );
              tryIncrementalMap(s);
            }),
          ),
        );
      }

      // Final rebuild: catches any derived scans that resolved before their
      // matching source scan (due to parallel execution) and ensures consistency.
      // rebuildFromUids uses only real UIDs, so it naturally corrects any
      // provisional mappings that were wrong.
      get().rebuildFromUids(sessionId, scans);

      // Clean up provisional tracking and any leftover placeholder UIDs for
      // this session. Real UIDs from ensureSourceSeriesUid/ensureDerivedReferencedSeriesUid
      // have already overwritten provisionals; remove any that weren't overwritten.
      set((s) => {
        const nextProvisional = { ...s.provisionalMappings };
        const nextSourceUids = { ...s.sourceSeriesUidByScanId };
        const nextDerivedRefUids = { ...s.derivedRefSeriesUidByScanId };
        for (const scan of scans) {
          const key = sessionScanKey(sessionId, scan.id);
          delete nextProvisional[key];
          if (nextSourceUids[key]?.startsWith(PROVISIONAL_UID_PREFIX)) {
            delete nextSourceUids[key];
          }
          if (nextDerivedRefUids[key]?.startsWith(PROVISIONAL_UID_PREFIX)) {
            delete nextDerivedRefUids[key];
          }
        }
        return {
          provisionalMappings: nextProvisional,
          sourceSeriesUidByScanId: nextSourceUids,
          derivedRefSeriesUidByScanId: nextDerivedRefUids,
        };
      });

      // Mark as resolved only when all derived scans have referenced SeriesInstanceUIDs.
      // This avoids "sticky partial" sessions where one transient failure suppresses retries.
      const missingDerivedAfter = derivedScans.some(
        (scan) => !get().derivedRefSeriesUidByScanId[sessionScanKey(sessionId, scan.id)],
      );
      if (!missingDerivedAfter) {
        set((s) => ({
          resolvedSessionIds: new Set([...s.resolvedSessionIds, sessionId]),
        }));
      } else {
        set((s) => {
          const next = new Set(s.resolvedSessionIds);
          next.delete(sessionId);
          return { resolvedSessionIds: next };
        });
        console.warn(
          `[sessionDerivedIndex] Session ${sessionId} remains unresolved: ` +
          `missing referenced SeriesInstanceUID for one or more derived scans`,
        );
      }

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

  clear: () => set((s) => ({
    derivedIndex: {},
    unmapped: [],
    // Preserve UID caches so re-expanding a session skips expensive downloads.
    sourceSeriesUidByScanId: s.sourceSeriesUidByScanId,
    derivedRefSeriesUidByScanId: s.derivedRefSeriesUidByScanId,
    resolvedSessionIds: new Set(),
    provisionalMappings: {},
  })),
}));
