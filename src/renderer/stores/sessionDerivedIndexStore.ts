/**
 * Session Derived Index Store — maps source scans to their derived overlays.
 *
 * When session scans are loaded from XNAT, this store builds a lookup index
 * so that for any source imaging scan, we can instantly find associated SEG
 * and RTSTRUCT scans without re-scanning the full list.
 *
 * The index is built using the scan ID convention (30xx→source xx) and can
 * be augmented lazily with Referenced Series UID resolution.
 */
import { create } from 'zustand';
import type { XnatScan } from '@shared/types/xnat';

export interface DerivedScanIndex {
  segScans: XnatScan[];
  rtStructScans: XnatScan[];
}

interface SessionDerivedIndexState {
  /** Maps sourceScanId → { segScans, rtStructScans } */
  derivedIndex: Record<string, DerivedScanIndex>;

  /** Derived scans that couldn't be mapped to a source scan yet */
  unmapped: XnatScan[];

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

  /** Clear the index (e.g., on session change) */
  clear: () => void;
}

function isSegScan(scan: XnatScan): boolean {
  return scan.type?.toUpperCase() === 'SEG';
}

function isRtStructScan(scan: XnatScan): boolean {
  const t = scan.type?.toUpperCase();
  return t === 'RTSTRUCT' || t === 'RT';
}

function isDerivedScan(scan: XnatScan): boolean {
  return isSegScan(scan) || isRtStructScan(scan);
}

const EMPTY_INDEX: DerivedScanIndex = { segScans: [], rtStructScans: [] };

export const useSessionDerivedIndexStore = create<SessionDerivedIndexState>((set, get) => ({
  derivedIndex: {},
  unmapped: [],

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

  clear: () => set({ derivedIndex: {}, unmapped: [] }),
}));
