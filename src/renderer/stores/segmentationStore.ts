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

  /** Brush tool radius in pixels */
  brushSize: number;

  /** Threshold range for ThresholdBrush [min, max] in HU */
  thresholdRange: [number, number];

  /** Active segmentation tool (any seg tool name, or null if none) */
  activeSegTool: string | null;

  /** Spline type for SplineContourSegmentationTool */
  splineType: 'CARDINAL' | 'BSPLINE' | 'CATMULLROM' | 'LINEAR';

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
}

export const useSegmentationStore = create<SegmentationStore>((set) => ({
  segmentations: [],
  activeSegmentationId: null,
  activeSegmentIndex: 1,
  fillAlpha: 0.5,
  showPanel: false,
  renderOutline: true,
  brushSize: 15,
  thresholdRange: [-200, 200],
  activeSegTool: null,
  splineType: 'CATMULLROM',

  _sync: (segmentations) => set({ segmentations }),

  setActiveSegmentation: (id) => set({ activeSegmentationId: id }),

  setActiveSegmentIndex: (index) => set({ activeSegmentIndex: index }),

  setFillAlpha: (alpha) => set({ fillAlpha: alpha }),

  toggleOutline: () => set((s) => ({ renderOutline: !s.renderOutline })),

  setBrushSize: (size) => set({ brushSize: size }),

  setThresholdRange: (range) => set({ thresholdRange: range }),

  setActiveSegTool: (tool) => set({ activeSegTool: tool }),

  setSplineType: (type) => set({ splineType: type }),

  togglePanel: () => set((s) => ({ showPanel: !s.showPanel })),
}));
