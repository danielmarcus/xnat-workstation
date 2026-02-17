/**
 * Viewer domain types: tool names, W/L presets, viewport state, cine, layouts.
 */

/** Tool names available for left-click activation */
export enum ToolName {
  WindowLevel = 'WindowLevel',
  Pan = 'Pan',
  Zoom = 'Zoom',
  StackScroll = 'StackScroll',
  Length = 'Length',
  Angle = 'Angle',
  Bidirectional = 'Bidirectional',
  EllipticalROI = 'EllipticalROI',
  RectangleROI = 'RectangleROI',
  CircleROI = 'CircleROI',
  Probe = 'Probe',
  ArrowAnnotate = 'ArrowAnnotate',
  PlanarFreehandROI = 'PlanarFreehandROI',
  Crosshairs = 'Crosshairs',
  Brush = 'Brush',
  Eraser = 'Eraser',
  ThresholdBrush = 'ThresholdBrush',
  FreehandContour = 'FreehandContour',
  SplineContour = 'SplineContour',
  LivewireContour = 'LivewireContour',
  CircleScissors = 'CircleScissors',
  RectangleScissors = 'RectangleScissors',
  PaintFill = 'PaintFill',
  Sculptor = 'Sculptor',
  SphereScissors = 'SphereScissors',
  SegmentSelect = 'SegmentSelect',
  RegionSegment = 'RegionSegment',
  RegionSegmentPlus = 'RegionSegmentPlus',
  SegmentBidirectional = 'SegmentBidirectional',
  RectangleROIThreshold = 'RectangleROIThreshold',
  CircleROIThreshold = 'CircleROIThreshold',
  LabelmapEditWithContour = 'LabelmapEditWithContour',
}

/** Set of all annotation/measurement tool names */
export const ANNOTATION_TOOLS = new Set<ToolName>([
  ToolName.Length,
  ToolName.Angle,
  ToolName.Bidirectional,
  ToolName.EllipticalROI,
  ToolName.RectangleROI,
  ToolName.CircleROI,
  ToolName.Probe,
  ToolName.ArrowAnnotate,
  ToolName.PlanarFreehandROI,
]);

/** Set of all segmentation/painting tool names */
export const SEGMENTATION_TOOLS = new Set<ToolName>([
  ToolName.Brush,
  ToolName.Eraser,
  ToolName.ThresholdBrush,
  ToolName.FreehandContour,
  ToolName.SplineContour,
  ToolName.LivewireContour,
  ToolName.CircleScissors,
  ToolName.RectangleScissors,
  ToolName.PaintFill,
  ToolName.Sculptor,
  ToolName.SphereScissors,
  ToolName.SegmentSelect,
  ToolName.RegionSegment,
  ToolName.RegionSegmentPlus,
  ToolName.SegmentBidirectional,
  ToolName.RectangleROIThreshold,
  ToolName.CircleROIThreshold,
  ToolName.LabelmapEditWithContour,
]);

/** Contour-based segmentation tools (create annotation-like persistent objects) */
export const CONTOUR_SEG_TOOLS = new Set<ToolName>([
  ToolName.FreehandContour,
  ToolName.SplineContour,
  ToolName.LivewireContour,
  ToolName.Sculptor,
  ToolName.LabelmapEditWithContour,
]);

/** Labelmap-based segmentation tools (directly modify labelmap pixel data) */
export const LABELMAP_SEG_TOOLS = new Set<ToolName>([
  ToolName.Brush,
  ToolName.Eraser,
  ToolName.ThresholdBrush,
  ToolName.CircleScissors,
  ToolName.RectangleScissors,
  ToolName.SphereScissors,
  ToolName.PaintFill,
  ToolName.RegionSegment,
  ToolName.RegionSegmentPlus,
  ToolName.RectangleROIThreshold,
  ToolName.CircleROIThreshold,
]);

/** Human-readable display names for all tools */
export const TOOL_DISPLAY_NAMES: Record<ToolName, string> = {
  [ToolName.WindowLevel]: 'W/L',
  [ToolName.Pan]: 'Pan',
  [ToolName.Zoom]: 'Zoom',
  [ToolName.StackScroll]: 'Scroll',
  [ToolName.Length]: 'Length',
  [ToolName.Angle]: 'Angle',
  [ToolName.Bidirectional]: 'Bidirectional',
  [ToolName.EllipticalROI]: 'Ellipse ROI',
  [ToolName.RectangleROI]: 'Rectangle ROI',
  [ToolName.CircleROI]: 'Circle ROI',
  [ToolName.Probe]: 'Probe',
  [ToolName.ArrowAnnotate]: 'Arrow',
  [ToolName.PlanarFreehandROI]: 'Freehand ROI',
  [ToolName.Crosshairs]: 'Crosshairs',
  [ToolName.Brush]: 'Brush',
  [ToolName.Eraser]: 'Eraser',
  [ToolName.ThresholdBrush]: 'Threshold Brush',
  [ToolName.FreehandContour]: 'Freehand Contour',
  [ToolName.SplineContour]: 'Spline Contour',
  [ToolName.LivewireContour]: 'Livewire Contour',
  [ToolName.CircleScissors]: 'Circle Scissors',
  [ToolName.RectangleScissors]: 'Rectangle Scissors',
  [ToolName.PaintFill]: 'Paint Fill',
  [ToolName.Sculptor]: 'Sculptor',
  [ToolName.SphereScissors]: 'Sphere Scissors',
  [ToolName.SegmentSelect]: 'Segment Select',
  [ToolName.RegionSegment]: 'Region Segment',
  [ToolName.RegionSegmentPlus]: 'Region Segment+',
  [ToolName.SegmentBidirectional]: 'Segment Bidir.',
  [ToolName.RectangleROIThreshold]: 'Rect Threshold',
  [ToolName.CircleROIThreshold]: 'Circle Threshold',
  [ToolName.LabelmapEditWithContour]: 'Contour Edit',
};

/** Window/Level preset definition */
export interface WLPreset {
  name: string;
  window: number;
  level: number;
}

/** Standard CT window/level presets */
export const WL_PRESETS: WLPreset[] = [
  { name: 'CT Soft Tissue', window: 400, level: 40 },
  { name: 'CT Lung', window: 1500, level: -600 },
  { name: 'CT Bone', window: 2500, level: 480 },
  { name: 'CT Brain', window: 80, level: 40 },
  { name: 'CT Abdomen', window: 400, level: 60 },
];

/** Cine playback state */
export interface CineState {
  isPlaying: boolean;
  fps: number;
}

/** Viewport display state tracked in the Zustand store */
export interface ViewportState {
  viewportId: string | null;
  imageIndex: number;
  /** User-requested stack index while image decode/load is still in-flight */
  requestedImageIndex: number | null;
  totalImages: number;
  windowWidth: number;
  windowCenter: number;
  zoomPercent: number;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  invert: boolean;
  imageWidth: number;
  imageHeight: number;
}

// ─── Multi-Panel Layout ───────────────────────────────────────

/** Available grid layout configurations */
export type LayoutType = '1x1' | '1x2' | '2x1' | '2x2';

/** Grid dimensions for a layout */
export interface PanelConfig {
  rows: number;
  cols: number;
  panelCount: number;
}

/** Layout → grid configuration lookup */
export const LAYOUT_CONFIGS: Record<LayoutType, PanelConfig> = {
  '1x1': { rows: 1, cols: 1, panelCount: 1 },
  '1x2': { rows: 1, cols: 2, panelCount: 2 },
  '2x1': { rows: 2, cols: 1, panelCount: 2 },
  '2x2': { rows: 2, cols: 2, panelCount: 4 },
};

/** Generate panel ID from index: panel_0, panel_1, etc. */
export function panelId(index: number): string {
  return `panel_${index}`;
}

/** Generate MPR panel ID from index: mpr_panel_0, mpr_panel_1, etc. */
export function mprPanelId(index: number): string {
  return `mpr_panel_${index}`;
}

// ─── MPR (Multiplanar Reconstruction) ─────────────────────────

/** Orientation axis for MPR planes */
export type MPRPlane = 'AXIAL' | 'SAGITTAL' | 'CORONAL';

/** Fixed MPR panel assignments: 3 orthogonal planes */
export const MPR_PANELS: { panelIndex: number; plane: MPRPlane; label: string }[] = [
  { panelIndex: 0, plane: 'AXIAL', label: 'Axial' },
  { panelIndex: 1, plane: 'SAGITTAL', label: 'Sagittal' },
  { panelIndex: 2, plane: 'CORONAL', label: 'Coronal' },
];

/** MPR-specific viewport state tracked in the Zustand store */
export interface MPRViewportState {
  sliceIndex: number;
  totalSlices: number;
  plane: MPRPlane;
}

/** Volume loading progress */
export interface VolumeLoadProgress {
  loaded: number;
  total: number;
  percent: number;
}
