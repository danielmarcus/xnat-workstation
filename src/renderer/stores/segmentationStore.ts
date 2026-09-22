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
import { defaultThresholdRangeForModality } from '@shared/types/viewer';

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

  /** Contour outline thickness in pixels (RTSTRUCT/contour representation) */
  contourLineWidth: number;

  /** Contour outline opacity (0-1) */
  contourOpacity: number;

  /** Brush tool radius in pixels */
  brushSize: number;

  /** Threshold range for ThresholdBrush [min, max] in source intensity (HU on CT) */
  thresholdRange: [number, number];
  /** Radius in VOXELS sampled around the first click by the dynamic-threshold brush to
   *  derive its window. Its only control; without one the tool ran on a hidden default. */
  samplingRadius: number;
  /**
   * Whether tools ADD to or REMOVE from the segment.
   *
   * Session state, deliberately NOT persisted. It was a saved preference, so an app
   * launched after any session that ended in erase came up erasing — a destructive mode,
   * silently, with no action by the user. Every launch starts at fill.
   */
  editMode: 'fill' | 'erase';
  /**
   * Whether Shift is currently inverting the mode. Lives in the store so the toolbox can
   * show the EFFECTIVE mode: showing the underlying one let the toggle disagree with
   * what a stroke would actually do.
   */
  editModeShiftHeld: boolean;

  /**
   * The DICOM modality `thresholdRange` was seeded for, or null before any scan has
   * been seen. A CT HU window is meaningless on MR/PT, so the panel reseeds the range
   * whenever the active scan's modality differs from this. Edits made within one
   * modality stick (no reseed while it is unchanged).
   */
  thresholdRangeModality: string | null;

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

  /** Current auto-save status */
  autoSaveStatus: 'idle' | 'saving' | 'saved' | 'error';

  /** Timestamp of last successful auto-save */
  lastAutoSaveTime: number | null;

  /**
   * Monotonic counter bumped whenever labelmap pixel data changes. Lets the UI
   * recompute derived-but-expensive values (per-segment volume/HU statistics run a
   * Cornerstone worker) after edits settle, without hooks subscribing to
   * Cornerstone events directly.
   */
  editEpoch: number;

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
  /** Set outline rendering */
  setRenderOutline: (enabled: boolean) => void;

  /** Set contour line thickness */
  setContourLineWidth: (width: number) => void;

  /** Set contour opacity */
  setContourOpacity: (opacity: number) => void;

  /** Set brush size */
  setBrushSize: (size: number) => void;

  /** Set threshold range */
  setThresholdRange: (range: [number, number]) => void;
  setSamplingRadius: (radius: number) => void;
  setEditMode: (mode: 'fill' | 'erase') => void;
  setEditModeShiftHeld: (held: boolean) => void;

  /** Reseed the threshold window for a newly-active modality (records the modality). */
  seedThresholdRangeForModality: (modality: string, range: [number, number]) => void;

  /** Set the active segmentation tool */
  setActiveSegTool: (tool: string | null) => void;

  /** Set spline type for SplineContour tool */
  setSplineType: (type: 'CARDINAL' | 'BSPLINE' | 'CATMULLROM' | 'LINEAR') => void;

  /** Toggle panel visibility */
  togglePanel: () => void;

  /** Internal: refresh undo/redo availability from HistoryMemo */
  _refreshUndoState: (canUndo: boolean, canRedo: boolean) => void;

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

  /** Whether viewport context metadata overlay is displayed */
  showViewportContextOverlay: boolean;

  /** Set viewport context metadata visibility */
  setShowViewportContextOverlay: (enabled: boolean) => void;

  // ─── Unsaved Changes Tracking ─────────────────────────────────

  /** Whether any segmentation has unsaved changes */
  hasUnsavedChanges: boolean;

  /** Mark that unsaved changes exist */
  _markDirty: () => void;
  /** Internal: note that labelmap pixel data changed (bumps editEpoch). */
  _bumpEditEpoch: () => void;

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
  contourLineWidth: 2,
  contourOpacity: 1,
  brushSize: 5,
  thresholdRange: defaultThresholdRangeForModality('CT'),
  samplingRadius: 3,
  editMode: 'fill',
  editModeShiftHeld: false,
  thresholdRangeModality: null,
  activeSegTool: null,
  splineType: 'CATMULLROM',
  canUndo: false,
  canRedo: false,
  autoSaveStatus: 'idle',
  editEpoch: 0,
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
  setRenderOutline: (enabled) => set({ renderOutline: enabled }),

  setContourLineWidth: (width) => set({ contourLineWidth: width }),

  setContourOpacity: (opacity) => set({ contourOpacity: opacity }),

  setBrushSize: (size) => set({ brushSize: size }),

  setThresholdRange: (range) => set({ thresholdRange: range }),
  setSamplingRadius: (radius) => set({ samplingRadius: Math.max(1, Math.round(radius)) }),
  setEditMode: (mode) => set({ editMode: mode }),
  setEditModeShiftHeld: (held) => set({ editModeShiftHeld: held }),

  seedThresholdRangeForModality: (modality, range) =>
    set({ thresholdRange: range, thresholdRangeModality: modality }),

  setActiveSegTool: (tool) => set({ activeSegTool: tool }),

  setSplineType: (type) => set({ splineType: type }),

  togglePanel: () => set((s) => ({ showPanel: !s.showPanel })),

  _refreshUndoState: (canUndo, canRedo) => set({ canUndo, canRedo }),

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

  showViewportContextOverlay: true,

  setShowViewportContextOverlay: (enabled) => set({ showViewportContextOverlay: enabled }),

  hasUnsavedChanges: false,

  _markDirty: () => set({ hasUnsavedChanges: true }),

  _bumpEditEpoch: () => set((s) => ({ editEpoch: s.editEpoch + 1 })),

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
