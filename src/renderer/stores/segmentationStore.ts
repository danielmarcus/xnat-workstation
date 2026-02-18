/**
 * Segmentation Store — reactive UI state for segmentation overlays.
 *
 * Cornerstone3D's segmentation state is the source of truth.
 * This store holds lightweight summaries synced from Cornerstone events
 * via segmentationService, enabling React components to reactively display
 * the segmentation panel without polling Cornerstone directly.
 *
 * Follows the same pattern as annotationStore.ts.
 */
import { create } from 'zustand';

/** Represents a single segment within a segmentation */
export interface SegmentSummary {
  segmentIndex: number;      // 1-based (0 = background)
  label: string;             // e.g. "Liver", "Tumor"
  color: [number, number, number, number]; // RGBA 0-255
  visible: boolean;
  locked: boolean;
}

/** Represents one segmentation (can have multiple segments) */
export interface SegmentationSummary {
  segmentationId: string;
  label: string;             // e.g. "Segmentation 1" or DICOM SEG series description
  segments: SegmentSummary[];
  isActive: boolean;         // Is this the active segmentation for editing?
}

export type SegmentationDicomType = 'SEG' | 'RTSTRUCT';

interface SegmentationStore {
  /** All segmentation summaries, synced from Cornerstone state */
  segmentations: SegmentationSummary[];

  /** Currently active segmentation ID (the one being edited) */
  activeSegmentationId: string | null;

  /** Currently active segment index within the active segmentation (1-based, 0=background) */
  activeSegmentIndex: number;

  /** Global labelmap overlay opacity (0-1) */
  fillAlpha: number;

  /** Whether the segmentation panel is visible */
  showPanel: boolean;

  /** Whether outline rendering is enabled */
  renderOutline: boolean;

  /** Whether between-slice interpolation is enabled for annotations */
  interpolationEnabled: boolean;

  /** Brush tool radius in pixels */
  brushSize: number;

  /** Threshold range for ThresholdBrush [min, max] in HU */
  thresholdRange: [number, number];

  /** Active segmentation tool (any seg tool name, or null if none) */
  activeSegTool: string | null;

  /** Spline type for SplineContourSegmentationTool */
  splineType: 'CARDINAL' | 'BSPLINE' | 'CATMULLROM' | 'LINEAR';

  // ─── Undo/Redo State ──────────────────────────────────────

  /** Whether undo is available (from Cornerstone HistoryMemo) */
  canUndo: boolean;

  /** Whether redo is available (from Cornerstone HistoryMemo) */
  canRedo: boolean;

  // ─── Auto-Save State ──────────────────────────────────────

  /** Whether auto-save to XNAT is enabled */
  autoSaveEnabled: boolean;

  /** Current auto-save status */
  autoSaveStatus: 'idle' | 'saving' | 'saved' | 'error';

  /** Timestamp of last successful auto-save */
  lastAutoSaveTime: number | null;

  // ─── XNAT Origin Tracking ─────────────────────────────────

  /**
   * Maps segmentationId → the XNAT scan it was loaded from.
   * Used to overwrite the same scan on manual save instead of creating a new one.
   * Entries absent for locally-created segmentations (first save creates new 30xx scan).
   */
  xnatOriginMap: Record<string, { scanId: string; sourceScanId: string; projectId: string; sessionId: string }>;

  /** Per-row DICOM object type used for export/upload/download actions. */
  dicomTypeBySegmentationId: Record<string, SegmentationDicomType>;

  // ─── Actions ─────────────────────────────────────────────

  /** Internal: sync segmentation list from segmentationService */
  _sync: (segmentations: SegmentationSummary[]) => void;

  /** Set the active segmentation for editing */
  setActiveSegmentation: (id: string | null) => void;

  /** Set the active segment index */
  setActiveSegmentIndex: (index: number) => void;

  /** Set fill alpha (opacity) */
  setFillAlpha: (alpha: number) => void;

  /** Toggle outline rendering */
  toggleOutline: () => void;

  /** Enable/disable between-slice interpolation */
  setInterpolationEnabled: (enabled: boolean) => void;

  /** Set brush size */
  setBrushSize: (size: number) => void;

  /** Set threshold range */
  setThresholdRange: (range: [number, number]) => void;

  /** Set the active segmentation tool */
  setActiveSegTool: (tool: string | null) => void;

  /** Set spline type for SplineContour tool */
  setSplineType: (type: 'CARDINAL' | 'BSPLINE' | 'CATMULLROM' | 'LINEAR') => void;

  /** Toggle panel visibility */
  togglePanel: () => void;

  /** Internal: refresh undo/redo availability from HistoryMemo */
  _refreshUndoState: (canUndo: boolean, canRedo: boolean) => void;

  /** Enable or disable auto-save */
  setAutoSaveEnabled: (enabled: boolean) => void;

  /** Internal: update auto-save status */
  _setAutoSaveStatus: (status: 'idle' | 'saving' | 'saved' | 'error') => void;

  /** Set the XNAT origin scan for a segmentation (called after load or first save) */
  setXnatOrigin: (segmentationId: string, origin: { scanId: string; sourceScanId: string; projectId: string; sessionId: string }) => void;

  /** Clear the XNAT origin for a segmentation (e.g. when deleted) */
  clearXnatOrigin: (segmentationId: string) => void;

  /** Set export/upload DICOM type for a segmentation row */
  setDicomType: (segmentationId: string, type: SegmentationDicomType) => void;

  /** Clear stored DICOM type for a segmentation row */
  clearDicomType: (segmentationId: string) => void;

  // ─── Auto-Load Preference ────────────────────────────────────

  /** Whether to auto-load associated SEG/RTSTRUCT when clicking a regular scan */
  autoLoadSegOnScanClick: boolean;

  /** Set auto-load preference */
  setAutoLoadSegOnScanClick: (enabled: boolean) => void;

  // ─── Unsaved Changes Tracking ─────────────────────────────────

  /** Whether any segmentation has unsaved changes */
  hasUnsavedChanges: boolean;

  /** Mark that unsaved changes exist */
  _markDirty: () => void;

  /** Mark that all changes have been saved */
  _markClean: () => void;
}

export const useSegmentationStore = create<SegmentationStore>((set) => ({
  segmentations: [],
  activeSegmentationId: null,
  activeSegmentIndex: 1,
  fillAlpha: 0.5,
  showPanel: false,
  renderOutline: true,
  interpolationEnabled: true,
  brushSize: 5,
  thresholdRange: [-200, 200],
  activeSegTool: null,
  splineType: 'CATMULLROM',
  canUndo: false,
  canRedo: false,
  autoSaveEnabled: true,
  autoSaveStatus: 'idle',
  lastAutoSaveTime: null,
  xnatOriginMap: {},
  dicomTypeBySegmentationId: {},

  _sync: (segmentations) =>
    set((s) => {
      const keep = new Set(segmentations.map((seg) => seg.segmentationId));
      const nextDicomType: Record<string, SegmentationDicomType> = {};
      for (const [segId, type] of Object.entries(s.dicomTypeBySegmentationId)) {
        if (keep.has(segId)) nextDicomType[segId] = type;
      }
      return { segmentations, dicomTypeBySegmentationId: nextDicomType };
    }),

  setActiveSegmentation: (id) => set({ activeSegmentationId: id }),

  setActiveSegmentIndex: (index) => set({ activeSegmentIndex: index }),

  setFillAlpha: (alpha) => set({ fillAlpha: alpha }),

  toggleOutline: () => set((s) => ({ renderOutline: !s.renderOutline })),

  setInterpolationEnabled: (enabled) => set({ interpolationEnabled: enabled }),

  setBrushSize: (size) => set({ brushSize: size }),

  setThresholdRange: (range) => set({ thresholdRange: range }),

  setActiveSegTool: (tool) => set({ activeSegTool: tool }),

  setSplineType: (type) => set({ splineType: type }),

  togglePanel: () => set((s) => ({ showPanel: !s.showPanel })),

  _refreshUndoState: (canUndo, canRedo) => set({ canUndo, canRedo }),

  setAutoSaveEnabled: (enabled) => set({ autoSaveEnabled: enabled }),

  _setAutoSaveStatus: (status) =>
    set({
      autoSaveStatus: status,
      ...(status === 'saved' ? { lastAutoSaveTime: Date.now() } : {}),
    }),

  setXnatOrigin: (segmentationId, origin) =>
    set((s) => ({
      xnatOriginMap: { ...s.xnatOriginMap, [segmentationId]: origin },
    })),

  clearXnatOrigin: (segmentationId) =>
    set((s) => {
      const { [segmentationId]: _, ...rest } = s.xnatOriginMap;
      return { xnatOriginMap: rest };
    }),

  setDicomType: (segmentationId, type) =>
    set((s) => ({
      dicomTypeBySegmentationId: { ...s.dicomTypeBySegmentationId, [segmentationId]: type },
    })),

  clearDicomType: (segmentationId) =>
    set((s) => {
      const { [segmentationId]: _, ...rest } = s.dicomTypeBySegmentationId;
      return { dicomTypeBySegmentationId: rest };
    }),

  autoLoadSegOnScanClick: true,

  setAutoLoadSegOnScanClick: (enabled) => set({ autoLoadSegOnScanClick: enabled }),

  hasUnsavedChanges: false,

  _markDirty: () => set({ hasUnsavedChanges: true }),

  _markClean: () => {
    set({ hasUnsavedChanges: false });
    // Also clear the per-segmentation dirty tracking in segmentationManagerStore
    // so the two stores stay in sync. Without this, App.tsx checks like
    //   segStore.hasUnsavedChanges || manager.hasDirtySegmentations()
    // could show stale unsaved-changes warnings after a successful save.
    import('./segmentationManagerStore').then(({ useSegmentationManagerStore }) => {
      useSegmentationManagerStore.getState().clearAllDirty();
    });
  },
}));
