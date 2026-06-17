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
  ToolName.LabelmapEditWithContour,
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
  [ToolName.LabelmapEditWithContour]: 'Contour Fill',
};

/** Window/Level preset definition */
export interface WLPreset {
  name: string;
  window: number;
  level: number;
}

/** Standard CT window/level presets (HU-based). */
export const CT_WL_PRESETS: WLPreset[] = [
  { name: 'Soft Tissue', window: 400, level: 40 },
  { name: 'Lung', window: 1500, level: -600 },
  { name: 'Bone', window: 2500, level: 480 },
  { name: 'Brain', window: 80, level: 40 },
  { name: 'Abdomen', window: 400, level: 60 },
  { name: 'Mediastinum', window: 350, level: 40 },
];

/** MR window/level presets. MR pixel intensity is acquisition-dependent (no universal
 *  HU scale), so these are reasonable starting points, not absolutes. */
export const MR_WL_PRESETS: WLPreset[] = [
  { name: 'Default', window: 1000, level: 500 },
  { name: 'Brain', window: 600, level: 300 },
  { name: 'T2 / Fluid', window: 1400, level: 700 },
  { name: 'Spine', window: 800, level: 400 },
];

/** PET window/level presets (raw stored values; SUV scaling is acquisition-dependent). */
export const PT_WL_PRESETS: WLPreset[] = [
  { name: 'Default', window: 10000, level: 5000 },
  { name: 'Hot', window: 6000, level: 3000 },
];

/** Window/level presets grouped by DICOM modality. */
export const WL_PRESET_GROUPS: Record<string, WLPreset[]> = {
  CT: CT_WL_PRESETS,
  MR: MR_WL_PRESETS,
  PT: PT_WL_PRESETS,
};

/** The W/L presets appropriate to a DICOM modality. Unknown / other modalities fall
 *  back to the CT set (the most broadly useful HU presets, and the safe default before
 *  a scan's metadata is available). */
export function presetsForModality(modality?: string | null): WLPreset[] {
  const key = (modality ?? '').trim().toUpperCase();
  return WL_PRESET_GROUPS[key] ?? CT_WL_PRESETS;
}

/** Back-compat default export (the CT set). Prefer presetsForModality(). */
export const WL_PRESETS: WLPreset[] = CT_WL_PRESETS;

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

/** Orientation axis for MPR planes (orthogonal anatomical reformats) */
export type MPRPlane = 'AXIAL' | 'SAGITTAL' | 'CORONAL';

/**
 * A volume viewport's user-selectable display orientation: the three orthogonal MPR
 * planes plus ACQUISITION — the scan's native acquisition plane (1:1 with the source
 * slices + any loaded SEG). ACQUISITION is the default for a single series; the
 * orthogonal planes are reformats. (An obliquely-acquired scan reformatted onto an
 * orthogonal plane re-slices the volume, so a single-slice segmentation would span
 * multiple display slices — ACQUISITION avoids that.)
 */
export type DisplayPlane = MPRPlane | 'ACQUISITION';

/** Per-viewport viewing orientation (stack/original, acquisition, or orthographic plane) */
export type ViewportOrientation = 'STACK' | DisplayPlane;

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
