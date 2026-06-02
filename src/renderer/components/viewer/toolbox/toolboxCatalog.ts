/**
 * Tool catalog for the Annotations panel toolbox.
 * Spec §4.8.3.
 *
 * Each catalog is a strict 3-column grid laid out top-to-bottom.
 * `wired` is false for tools that exist in Cornerstone but aren't
 * yet registered in this codebase — those buttons render with a
 * dashed border and a `*` suffix in their tooltip.
 *
 * `controlsFamily` keys into the `Controls` switch in the toolbox
 * (§4.8.4) so families of tools share a single control panel
 * (brush family → brush-size slider, threshold family → HU range,
 * etc).
 *
 * Naming notes:
 *  - `id` is the stable identifier we use in tests + state.
 *  - `tool` is the `ToolName` enum value Cornerstone activates;
 *    `null` for unwired entries.
 *  - `label` is the short button label; `fullName` is the tooltip
 *    (matches the verbose name in the spec).
 */
import { ToolName } from '@shared/types/viewer';

export type ToolboxKind = 'SEG' | 'STRUCT' | 'MEAS';

export type ControlsFamily =
  | 'brush'
  | 'sphere-brush'
  | 'threshold-range'
  | 'dynamic-threshold'
  | 'region-strength'
  | 'spline-type'
  | 'struct-contour'
  | 'meas-hint'
  | 'none';

export interface ToolboxEntry {
  id: string;
  label: string;
  fullName: string;
  tool: ToolName | null;
  wired: boolean;
  controlsFamily: ControlsFamily;
}

/**
 * Segmentation toolbox — 21 tools in a 3×7 grid (spec §4.8.3).
 * Row-major; reading top-to-bottom by column groups the like-by-like
 * tools (per spec: "ordered top-to-bottom, no formal group labels").
 */
export const SEG_TOOLBOX: ReadonlyArray<ToolboxEntry> = [
  // Row 1
  { id: 'brush',         label: 'Brush',        fullName: 'Brush',                       tool: ToolName.Brush,                   wired: true,  controlsFamily: 'brush' },
  { id: 'eraser',        label: 'Eraser',       fullName: 'Eraser',                      tool: ToolName.Eraser,                  wired: true,  controlsFamily: 'brush' },
  { id: 'threshold',     label: 'Threshold',    fullName: 'Threshold Brush',             tool: ToolName.ThresholdBrush,          wired: true,  controlsFamily: 'threshold-range' },
  // Row 2 (sphere variants, unwired)
  { id: 'dyn-thresh',    label: 'Dyn. Thresh',  fullName: 'Dynamic Threshold Brush',     tool: null,                             wired: false, controlsFamily: 'dynamic-threshold' },
  { id: 'sph-brush',     label: 'Sph. Brush',   fullName: 'Sphere Brush (3D)',           tool: null,                             wired: false, controlsFamily: 'sphere-brush' },
  { id: 'sph-eraser',    label: 'Sph. Eraser',  fullName: 'Sphere Eraser (3D)',          tool: null,                             wired: false, controlsFamily: 'sphere-brush' },
  // Row 3
  { id: 'sph-thresh',    label: 'Sph. Thresh',  fullName: 'Sphere Threshold (3D)',       tool: null,                             wired: false, controlsFamily: 'threshold-range' },
  { id: 'circle',        label: 'Circle',       fullName: 'Circle Scissors',             tool: ToolName.CircleScissors,          wired: true,  controlsFamily: 'none' },
  { id: 'rectangle',     label: 'Rectangle',    fullName: 'Rectangle Scissors',          tool: ToolName.RectangleScissors,       wired: true,  controlsFamily: 'none' },
  // Row 4
  { id: 'sphere',        label: 'Sphere',       fullName: 'Sphere Scissors (3D)',        tool: ToolName.SphereScissors,          wired: true,  controlsFamily: 'none' },
  { id: 'paint-fill',    label: 'Paint Fill',   fullName: 'Paint Fill (Flood)',          tool: ToolName.PaintFill,               wired: true,  controlsFamily: 'none' },
  { id: 'rect-roi',      label: 'Rect ROI',     fullName: 'Rectangle ROI Threshold',     tool: ToolName.RectangleROIThreshold,   wired: true,  controlsFamily: 'threshold-range' },
  // Row 5
  { id: 'rect-multi',    label: 'Rect Multi',   fullName: 'Rectangle ROI (Multi-slice)', tool: null,                             wired: false, controlsFamily: 'threshold-range' },
  { id: 'circle-multi',  label: 'Circle Multi', fullName: 'Circle ROI Threshold',        tool: ToolName.CircleROIThreshold,      wired: true,  controlsFamily: 'threshold-range' },
  { id: 'contour-fill',  label: 'Contour Fill', fullName: 'Labelmap Edit with Contour',  tool: ToolName.LabelmapEditWithContour, wired: true,  controlsFamily: 'none' },
  // Row 6
  { id: 'region',        label: 'Region',       fullName: 'Region Segment',              tool: ToolName.RegionSegment,           wired: true,  controlsFamily: 'region-strength' },
  { id: 'region-plus',   label: 'Region+',      fullName: 'Region Segment Plus',         tool: ToolName.RegionSegmentPlus,       wired: true,  controlsFamily: 'region-strength' },
  { id: 'select',        label: 'Select',       fullName: 'Segment Select',              tool: ToolName.SegmentSelect,           wired: true,  controlsFamily: 'none' },
  // Row 7
  { id: 'label',         label: 'Label',        fullName: 'Labelmap Annotation',         tool: null,                             wired: false, controlsFamily: 'none' },
  { id: 'bidir',         label: 'Bidir.',       fullName: 'Segment Bidirectional',       tool: ToolName.SegmentBidirectional,    wired: true,  controlsFamily: 'none' },
  { id: 'intersect',     label: 'Intersect',    fullName: 'Segment Intersect',           tool: null,                             wired: false, controlsFamily: 'none' },
];

/**
 * Structure toolbox — 4 wired tools in a 3×2 grid with 2 empty
 * cells (spec §4.8.3).
 */
export const STRUCT_TOOLBOX: ReadonlyArray<ToolboxEntry> = [
  { id: 'freehand',  label: 'Freehand',  fullName: 'Freehand Contour',  tool: ToolName.FreehandContour, wired: true, controlsFamily: 'struct-contour' },
  { id: 'spline',    label: 'Spline',    fullName: 'Spline Contour',    tool: ToolName.SplineContour,   wired: true, controlsFamily: 'spline-type' },
  { id: 'livewire',  label: 'Livewire',  fullName: 'Livewire Contour',  tool: ToolName.LivewireContour, wired: true, controlsFamily: 'struct-contour' },
  { id: 'sculptor',  label: 'Sculptor',  fullName: 'Contour Sculptor',  tool: ToolName.Sculptor,        wired: true, controlsFamily: 'struct-contour' },
];

/**
 * Measurement toolbox — 9 tools in a 3×3 grid (spec §4.8.3).
 */
export const MEAS_TOOLBOX: ReadonlyArray<ToolboxEntry> = [
  { id: 'length',     label: 'Length',     fullName: 'Length',                tool: ToolName.Length,            wired: true, controlsFamily: 'meas-hint' },
  { id: 'bidir',      label: 'Bidir.',     fullName: 'Bidirectional',         tool: ToolName.Bidirectional,     wired: true, controlsFamily: 'meas-hint' },
  { id: 'angle',      label: 'Angle',      fullName: 'Angle',                 tool: ToolName.Angle,             wired: true, controlsFamily: 'meas-hint' },
  { id: 'rectangle',  label: 'Rectangle',  fullName: 'Rectangle ROI',         tool: ToolName.RectangleROI,      wired: true, controlsFamily: 'meas-hint' },
  { id: 'ellipse',    label: 'Ellipse',    fullName: 'Elliptical ROI',        tool: ToolName.EllipticalROI,     wired: true, controlsFamily: 'meas-hint' },
  { id: 'circle',     label: 'Circle',     fullName: 'Circle ROI',            tool: ToolName.CircleROI,         wired: true, controlsFamily: 'meas-hint' },
  { id: 'freehand',   label: 'Freehand',   fullName: 'Planar Freehand ROI',   tool: ToolName.PlanarFreehandROI, wired: true, controlsFamily: 'meas-hint' },
  { id: 'probe',      label: 'Probe',      fullName: 'Probe',                 tool: ToolName.Probe,             wired: true, controlsFamily: 'meas-hint' },
  { id: 'arrow',      label: 'Arrow',      fullName: 'Arrow Annotate',        tool: ToolName.ArrowAnnotate,     wired: true, controlsFamily: 'meas-hint' },
];

export function catalogFor(kind: ToolboxKind): ReadonlyArray<ToolboxEntry> {
  switch (kind) {
    case 'SEG':
      return SEG_TOOLBOX;
    case 'STRUCT':
      return STRUCT_TOOLBOX;
    case 'MEAS':
      return MEAS_TOOLBOX;
  }
}

/**
 * Map a `ContainerKind` to the matching toolbox.
 * `POI` containers carry measurement-style members.
 */
export function toolboxKindForContainerKind(kind: 'SEG' | 'RTSTRUCT' | 'POI'): ToolboxKind {
  switch (kind) {
    case 'SEG':
      return 'SEG';
    case 'RTSTRUCT':
      return 'STRUCT';
    case 'POI':
      return 'MEAS';
  }
}

/** Cells per row in each toolbox kind (always 3 per spec §4.8.3). */
export const TOOLBOX_COLUMNS = 3;

/**
 * Resolve the Controls family for a given active tool by scanning
 * every catalog (some tools appear in multiple — for example
 * RectangleROI lives in MEAS only, but the spline family lives in
 * STRUCT only).
 */
export function controlsFamilyForTool(tool: ToolName | null): ControlsFamily {
  if (!tool) return 'none';
  for (const catalog of [SEG_TOOLBOX, STRUCT_TOOLBOX, MEAS_TOOLBOX]) {
    const hit = catalog.find((e) => e.tool === tool);
    if (hit) return hit.controlsFamily;
  }
  return 'none';
}
