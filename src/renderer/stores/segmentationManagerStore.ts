/**
 * Segmentation Manager Store — Zustand state for the SegmentationManager orchestrator.
 *
 * Holds per-panel segmentation state, overlay availability, loaded overlays,
 * presentation cache (colors, visibility, lock), dirty tracking, and
 * active segmentation tracking. Only SegmentationManager writes to this store.
 */
import { create } from 'zustand';
import type { XnatScan } from '@shared/types/xnat';

// ─── Types ──────────────────────────────────────────────────────

export type RGBA = [number, number, number, number];

export interface PanelSegState {
  sourceScanId: string | null;
  epoch: number;
  /** Segmentation IDs that should be displayed on this panel */
  desiredOverlayIds: string[];
}

export type LoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

export interface LoadedOverlayInfo {
  segmentationId: string;
  loadedAt: number;
}

export interface OverlayAvailability {
  segScans: XnatScan[];
  rtStructScans: XnatScan[];
}

export interface PresentationState {
  color: Record<number, RGBA>;        // segmentIndex → RGBA
  visibility: Record<number, boolean>; // segmentIndex → visible
  locked: Record<number, boolean>;     // segmentIndex → locked
}

// ─── Store Shape ────────────────────────────────────────────────

interface SegmentationManagerState {
  /** Per-panel segmentation state */
  panelState: Record<string, PanelSegState>;

  /** Available overlays per source scan (from sessionDerivedIndexStore) */
  overlayAvailability: Record<string, OverlayAvailability>;

  /** Loaded overlays keyed by source scan, then derived scan ID */
  loadedBySourceScan: Record<string, Record<string, LoadedOverlayInfo>>;

  /** Load status per derived scan ID */
  loadStatus: Record<string, LoadStatus>;

  /** Presentation cache: user-chosen colors/visibility/lock per segmentation ID */
  presentation: Record<string, PresentationState>;

  /** Dirty tracking per segmentation ID */
  dirtySegIds: Record<string, boolean>;

  /** Segmentation IDs recovered from backup (for UI highlighting until saved).
   *  Value contains the backup session/filename so the entry can be deleted on save. */
  recoveredSegIds: Record<string, { sessionId: string; filename: string } | true>;

  /** Timestamp of last manual save per segmentation ID */
  lastManualSaveAt: Record<string, number | null>;

  /** Timestamp of last temp auto-save per source scan ID */
  lastTempSaveAtBySourceScan: Record<string, number | null>;

  /** Active segmentation ID per panel */
  activeSegmentationIdByPanel: Record<string, string | null>;

  /** Active segment index per panel */
  activeSegmentIndexByPanel: Record<string, number>;

  /** Maps segmentationId → composite key (projectId/sessionId/scanId) for locally-created segmentations */
  localOriginBySegId: Record<string, string>;

  // ─── Actions ──────────────────────────────────────────────────

  setPanelSourceScan: (panelId: string, sourceScanId: string | null, epoch: number) => void;
  setDesiredOverlays: (panelId: string, segmentationIds: string[]) => void;
  setOverlayAvailability: (sourceScanId: string, availability: OverlayAvailability) => void;
  setLoadStatus: (derivedScanId: string, status: LoadStatus) => void;
  recordLoaded: (sourceScanId: string, derivedScanId: string, info: LoadedOverlayInfo) => void;
  setPresentation: (segId: string, segIdx: number, patch: Partial<{ color: RGBA; visible: boolean; locked: boolean }>) => void;
  markDirty: (segId: string) => void;
  clearDirty: (segId: string) => void;
  markRecovered: (segId: string, backupInfo?: { sessionId: string; filename: string }) => void;
  clearRecovered: (segId: string) => void;
  recordManualSave: (segId: string) => void;
  recordTempSaved: (sourceScanId: string) => void;
  setActiveSegmentationForPanel: (panelId: string, segId: string | null) => void;
  setActiveSegmentIndexForPanel: (panelId: string, segIdx: number) => void;
  setLocalOrigin: (segId: string, compositeKey: string) => void;
  /** Remove a loaded overlay entry and clean up associated state for a deleted segmentation */
  cleanupRemovedSegmentation: (segmentationId: string) => void;
  clearPanel: (panelId: string) => void;
  /** Check if any segmentation is dirty */
  hasDirtySegmentations: () => boolean;
  /** Clear all dirty flags (called by segmentationStore._markClean to keep stores in sync) */
  clearAllDirty: () => void;
  /** Reset all state (e.g., on session change) */
  reset: () => void;
}

const INITIAL_STATE = {
  panelState: {} as Record<string, PanelSegState>,
  overlayAvailability: {} as Record<string, OverlayAvailability>,
  loadedBySourceScan: {} as Record<string, Record<string, LoadedOverlayInfo>>,
  loadStatus: {} as Record<string, LoadStatus>,
  presentation: {} as Record<string, PresentationState>,
  dirtySegIds: {} as Record<string, boolean>,
  recoveredSegIds: {} as Record<string, { sessionId: string; filename: string } | true>,
  lastManualSaveAt: {} as Record<string, number | null>,
  lastTempSaveAtBySourceScan: {} as Record<string, number | null>,
  activeSegmentationIdByPanel: {} as Record<string, string | null>,
  activeSegmentIndexByPanel: {} as Record<string, number>,
  localOriginBySegId: {} as Record<string, string>,
};

export const useSegmentationManagerStore = create<SegmentationManagerState>((set, get) => ({
  ...INITIAL_STATE,

  setPanelSourceScan: (panelId, sourceScanId, epoch) =>
    set((s) => ({
      panelState: {
        ...s.panelState,
        [panelId]: {
          sourceScanId,
          epoch,
          // desired overlays are source-scan specific; clear when source changes
          desiredOverlayIds:
            s.panelState[panelId]?.sourceScanId === sourceScanId
              ? (s.panelState[panelId]?.desiredOverlayIds ?? [])
              : [],
        },
      },
    })),

  setDesiredOverlays: (panelId, segmentationIds) =>
    set((s) => ({
      panelState: {
        ...s.panelState,
        [panelId]: {
          ...s.panelState[panelId],
          sourceScanId: s.panelState[panelId]?.sourceScanId ?? null,
          epoch: s.panelState[panelId]?.epoch ?? 0,
          desiredOverlayIds: segmentationIds,
        },
      },
    })),

  setOverlayAvailability: (sourceScanId, availability) =>
    set((s) => ({
      overlayAvailability: { ...s.overlayAvailability, [sourceScanId]: availability },
    })),

  setLoadStatus: (derivedScanId, status) =>
    set((s) => ({
      loadStatus: { ...s.loadStatus, [derivedScanId]: status },
    })),

  recordLoaded: (sourceScanId, derivedScanId, info) =>
    set((s) => ({
      loadedBySourceScan: {
        ...s.loadedBySourceScan,
        [sourceScanId]: {
          ...(s.loadedBySourceScan[sourceScanId] ?? {}),
          [derivedScanId]: info,
        },
      },
    })),

  setPresentation: (segId, segIdx, patch) =>
    set((s) => {
      const existing = s.presentation[segId] ?? { color: {}, visibility: {}, locked: {} };
      return {
        presentation: {
          ...s.presentation,
          [segId]: {
            color: patch.color !== undefined
              ? { ...existing.color, [segIdx]: patch.color }
              : existing.color,
            visibility: patch.visible !== undefined
              ? { ...existing.visibility, [segIdx]: patch.visible }
              : existing.visibility,
            locked: patch.locked !== undefined
              ? { ...existing.locked, [segIdx]: patch.locked }
              : existing.locked,
          },
        },
      };
    }),

  markDirty: (segId) =>
    set((s) => ({ dirtySegIds: { ...s.dirtySegIds, [segId]: true } })),

  clearDirty: (segId) =>
    set((s) => {
      const { [segId]: _, ...rest } = s.dirtySegIds;
      return { dirtySegIds: rest };
    }),

  markRecovered: (segId, backupInfo) =>
    set((s) => ({ recoveredSegIds: { ...s.recoveredSegIds, [segId]: backupInfo ?? true } })),

  clearRecovered: (segId) =>
    set((s) => {
      const { [segId]: _, ...rest } = s.recoveredSegIds;
      return { recoveredSegIds: rest };
    }),

  recordManualSave: (segId) =>
    set((s) => ({
      dirtySegIds: (() => { const { [segId]: _, ...rest } = s.dirtySegIds; return rest; })(),
      recoveredSegIds: (() => { const { [segId]: _, ...rest } = s.recoveredSegIds; return rest; })(),
      lastManualSaveAt: { ...s.lastManualSaveAt, [segId]: Date.now() },
    })),

  recordTempSaved: (sourceScanId) =>
    set((s) => ({
      lastTempSaveAtBySourceScan: {
        ...s.lastTempSaveAtBySourceScan,
        [sourceScanId]: Date.now(),
      },
    })),

  setActiveSegmentationForPanel: (panelId, segId) =>
    set((s) => ({
      activeSegmentationIdByPanel: { ...s.activeSegmentationIdByPanel, [panelId]: segId },
    })),

  setActiveSegmentIndexForPanel: (panelId, segIdx) =>
    set((s) => ({
      activeSegmentIndexByPanel: { ...s.activeSegmentIndexByPanel, [panelId]: segIdx },
    })),

  setLocalOrigin: (segId, compositeKey) =>
    set((s) => ({
      localOriginBySegId: { ...s.localOriginBySegId, [segId]: compositeKey },
    })),

  cleanupRemovedSegmentation: (segmentationId) =>
    set((s) => {
      // Remove from loadedBySourceScan — iterate all source scans and remove
      // entries whose segmentationId matches the deleted one.
      const nextLoaded: Record<string, Record<string, LoadedOverlayInfo>> = {};
      for (const [sourceKey, derivedMap] of Object.entries(s.loadedBySourceScan)) {
        const filtered: Record<string, LoadedOverlayInfo> = {};
        for (const [derivedId, info] of Object.entries(derivedMap)) {
          if (info.segmentationId !== segmentationId) {
            filtered[derivedId] = info;
          }
        }
        if (Object.keys(filtered).length > 0) {
          nextLoaded[sourceKey] = filtered;
        }
      }

      // Remove presentation cache
      const { [segmentationId]: _p, ...restPresentation } = s.presentation;

      // Remove local origin
      const { [segmentationId]: _l, ...restLocalOrigin } = s.localOriginBySegId;

      // Remove dirty state
      const { [segmentationId]: _d, ...restDirty } = s.dirtySegIds;

      // Remove recovered state
      const { [segmentationId]: _r, ...restRecovered } = s.recoveredSegIds;

      // Remove manual save timestamp
      const { [segmentationId]: _m, ...restManualSave } = s.lastManualSaveAt;

      return {
        loadedBySourceScan: nextLoaded,
        presentation: restPresentation,
        localOriginBySegId: restLocalOrigin,
        dirtySegIds: restDirty,
        recoveredSegIds: restRecovered,
        lastManualSaveAt: restManualSave,
      };
    }),

  clearPanel: (panelId) =>
    set((s) => {
      const { [panelId]: _, ...restPanel } = s.panelState;
      const { [panelId]: _a, ...restActive } = s.activeSegmentationIdByPanel;
      const { [panelId]: _b, ...restIdx } = s.activeSegmentIndexByPanel;
      return {
        panelState: restPanel,
        activeSegmentationIdByPanel: restActive,
        activeSegmentIndexByPanel: restIdx,
      };
    }),

  hasDirtySegmentations: () => Object.values(get().dirtySegIds).some(Boolean),

  clearAllDirty: () => set({ dirtySegIds: {} }),

  reset: () => set(INITIAL_STATE),
}));
