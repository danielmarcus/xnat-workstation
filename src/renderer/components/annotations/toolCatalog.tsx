/**
 * Tool catalog (Rebuild Phase 3, R3.6) — the per-kind tool lists the ContextToolbox
 * renders (frozen mockup §4). "In scope = every registered Cornerstone3D tool for the
 * active kind"; AI/auto-seg deferred. The live FoR-disable (D3, dashed+slash) is applied
 * by the toolbox from runtime state, not encoded here.
 *
 * Four things are stated per tool, and all four are part of the contract:
 *
 *  - **label** — unique across the whole catalog, not merely within a kind. Two tools
 *    called "Circle" or "Bidir." are indistinguishable in a screenshot, a bug report or a
 *    test locator, even when they never appear side by side.
 *  - **icon** — likewise unique. Sphere Brush and Sphere Threshold once shared a glyph,
 *    as did Circle and Circle ROI.
 *  - **title** — what the tool DOES, in a sentence, plus its hotkey when it has one.
 *    A tooltip that repeats the label ("Spline" → "Spline") earns nothing. Hotkeys come
 *    from `defaultHotkeyMap`; `toolCatalog.test` fails if a tooltip claims one the map
 *    does not define, or omits one it does.
 *  - **needs** — the controls the tool cannot be used without. The toolbox renders
 *    exactly these, so selecting Threshold reveals the intensity window and selecting
 *    Circle does not offer a brush radius it ignores.
 */
import type { ReactNode } from 'react';
import type { ContainerKind } from '@shared/types/annotation';
import { ToolName } from '@shared/types/viewer';

/** A control a tool cannot be operated without. */
export type ToolControl =
  /** Brush radius, in screen pixels. */
  | 'brushSize'
  /** Intensity window the edit is confined to. */
  | 'intensityWindow'
  /** Radius, in voxels, sampled around the first click to derive a window. */
  | 'samplingRadius'
  /** Whether the shape tool adds to or removes from the segment (Shift inverts). */
  | 'scissorMode';

export interface ToolDef {
  id: string;
  label: string;
  title: string;
  icon: ReactNode;
  /** Controls the toolbox must show while this tool is active. */
  needs?: ToolControl[];
}

const S = (children: ReactNode, extra?: Record<string, unknown>) => (
  <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.4} {...extra}>
    {children}
  </svg>
);

const SEG_TOOLS: ToolDef[] = [
  { id: 'brush', label: 'Brush', title: 'Paint the active segment on this slice (B)', needs: ['brushSize'], icon: <svg viewBox="0 0 16 16" width={14} height={14} fill="currentColor" stroke="none"><circle cx="8" cy="8" r="3.2" /></svg> },
  { id: 'eraser', label: 'Eraser', title: 'Erase the active segment on this slice (E)', needs: ['brushSize'], icon: S(<rect x="3" y="6" width="8" height="6" rx="1" transform="rotate(-25 8 8)" />) },
  { id: 'threshold', label: 'Threshold', title: 'Paint only where intensity falls inside the window', needs: ['brushSize', 'intensityWindow'], icon: S(<><circle cx="8" cy="8" r="3.8" /><path d="M5 8h6" /></>) },
  { id: 'dynamicThreshold', label: 'Dyn. Thresh', title: 'Paint within a window sampled from the voxel you click, not a preset one', needs: ['brushSize', 'samplingRadius'], icon: S(<><circle cx="8" cy="8" r="3.8" /><path d="M5 8h6" strokeDasharray="1.5 1" /><circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" /></>) },
  { id: 'sphereBrush', label: 'Sph. Brush', title: 'Paint with a 3D kernel — one stroke also reaches neighbouring slices', needs: ['brushSize'], icon: S(<><circle cx="8" cy="8" r="4" /><ellipse cx="8" cy="8" rx="4" ry="1.7" /></>) },
  { id: 'sphereEraser', label: 'Sph. Eraser', title: 'Erase with a 3D kernel — also clears neighbouring slices', needs: ['brushSize'], icon: S(<><circle cx="8" cy="8" r="4" /><ellipse cx="8" cy="8" rx="4" ry="1.7" /><path d="M4.5 11.5l7-7" /></>) },
  { id: 'sphereThreshold', label: 'Sph. Thresh', title: 'Paint with a 3D kernel, limited to the intensity window', needs: ['brushSize', 'intensityWindow'], icon: S(<><circle cx="8" cy="8" r="4" /><ellipse cx="8" cy="8" rx="4" ry="1.7" /><path d="M5.5 8h5" /></>) },
  { id: 'circleScissors', label: 'Circle', title: 'Drag a circle; everything inside it is added to or removed from the segment (hold Shift to invert)', needs: ['scissorMode'], icon: S(<circle cx="8" cy="8" r="5" fill="currentColor" fillOpacity={0.25} />) },
  { id: 'rectangleScissors', label: 'Rect', title: 'Drag a rectangle; everything inside it is added to or removed from the segment (hold Shift to invert)', needs: ['scissorMode'], icon: S(<rect x="3" y="4" width="10" height="8" rx="1" fill="currentColor" fillOpacity={0.25} />) },
  { id: 'sphereScissors', label: 'Sphere', title: 'Drag a sphere; everything inside it is added to or removed from the segment, across slices (hold Shift to invert)', needs: ['scissorMode'], icon: S(<><circle cx="8" cy="8" r="5" fill="currentColor" fillOpacity={0.25} /><ellipse cx="8" cy="8" rx="5" ry="2" /></>) },
  { id: 'paintFill', label: 'Paint Fill', title: 'Flood-fill the enclosed region under the cursor (F)', icon: S(<><path d="M3 8l5-5 5 5-5 5z" /><path d="M11 11c1 1 1 2 0 2" /></>) },
  { id: 'region', label: 'Region', title: 'Grow a region outward from the voxel you click', needs: ['brushSize'], icon: S(<><circle cx="8" cy="8" r="4" strokeDasharray="2 1.3" /><circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none" /></>) },
  { id: 'regionPlus', label: 'Region+', title: 'Grow a region outward, adapting the boundary as it goes', needs: ['brushSize'], icon: S(<><circle cx="8" cy="8" r="4" strokeDasharray="2 1.3" /><path d="M8 6v4M6 8h4" /></>) },
  { id: 'rectMulti', label: 'Rect Multi', title: 'Drag a rectangle; everything inside it within the intensity window joins the segment', needs: ['intensityWindow'], icon: S(<><rect x="4.5" y="2.5" width="9" height="7" rx="1" /><path d="M2.5 5.5v8h9" /></>) },
  { id: 'contourFill', label: 'Contour Fill', title: 'Draw a boundary; the area it encloses joins the segment', icon: S(<path d="M4 8c0-3 8-3 8 0s-8 3-8 0z" fill="currentColor" fillOpacity={0.25} />) },
  { id: 'select', label: 'Select', title: 'Click a painted region to make its segment the active one', icon: S(<path d="M4 3l8 5-3.5 1.2L7 13z" />) },
  { id: 'segBidirectional', label: 'Seg Bidir.', title: 'Measure the active segment\u2019s longest axis and its perpendicular', icon: S(<><ellipse cx="8" cy="8" rx="6" ry="4" strokeDasharray="2 1.3" /><path d="M3.5 8h9M8 4.5v7" /></>) },
];

const STRUCTURE_TOOLS: ToolDef[] = [
  { id: 'freehand', label: 'Freehand', title: 'Trace a boundary freehand', icon: S(<path d="M3 11c1-4 4-6 6-3s5 1 4-3" />) },
  { id: 'spline', label: 'Spline', title: 'Place points; a smooth curve is fitted through them', icon: S(<path d="M2 11c3 0 3-6 6-6s3 6 6 6" />) },
  { id: 'livewire', label: 'Livewire', title: 'Trace a boundary that snaps to the nearest image edge', icon: S(<path d="M3 12c2-6 8-6 10 0" />, { strokeDasharray: '2 1.3' }) },
  { id: 'sculptor', label: 'Sculptor', title: 'Push or pull an existing boundary into shape', needs: ['brushSize'], icon: S(<><circle cx="8" cy="8" r="5" /><path d="M8 3v10" /></>) },
];

const MEASUREMENT_TOOLS: ToolDef[] = [
  { id: 'length', label: 'Length', title: 'Measure a straight-line distance (L)', icon: S(<path d="M3 13L13 3M4 10l2 2M7 7l2 2M10 4l2 2" />) },
  { id: 'angle', label: 'Angle', title: 'Measure the angle between two lines (A)', icon: S(<path d="M3 13L13 13M3 13L11 4" />) },
  { id: 'bidirectional', label: 'Bidir.', title: 'Measure a long axis and its perpendicular', icon: S(<path d="M3 8h10M8 3v10" />) },
  { id: 'ellipse', label: 'Ellipse', title: 'Measure an elliptical region and its statistics', icon: S(<ellipse cx="8" cy="8" rx="5.5" ry="3.5" />) },
  { id: 'rectROI', label: 'Rect ROI', title: 'Measure a rectangular region and its statistics', icon: S(<rect x="3" y="4.5" width="10" height="7" rx="1" />) },
  { id: 'circleROI', label: 'Circle ROI', title: 'Measure a circular region and its statistics', icon: S(<circle cx="8" cy="8" r="5" />) },
  { id: 'probe', label: 'Probe', title: 'Read the intensity at a single point (D)', icon: S(<><circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none" /><path d="M8 2v3M8 11v3M2 8h3M11 8h3" /></>) },
  { id: 'arrow', label: 'Arrow', title: 'Point at a feature and label it (T)', icon: S(<path d="M3 13L13 3M9 3h4v4" />) },
  { id: 'freehandROI', label: 'Freehand ROI', title: 'Measure a freehand region and its statistics', icon: S(<path d="M3 10c1-4 4-5 6-2s4 0 4-3" />) },
];

export function toolsForKind(kind: ContainerKind): ToolDef[] {
  if (kind === 'SEG') return SEG_TOOLS;
  if (kind === 'RTSTRUCT') return STRUCTURE_TOOLS;
  return MEASUREMENT_TOOLS;
}

export const KIND_TOOLS_LABEL: Record<ContainerKind, string> = {
  SEG: 'Segmentation tools',
  RTSTRUCT: 'Structure tools',
  SR: 'Measurement tools',
};

/**
 * Catalog tool id → Cornerstone ToolName. Drives toolbox → tool activation. Not
 * every mapping is registered on the unified path yet (unifiedToolService
 * .isToolSupported gates that — currently Brush / FreehandContour / Length); the
 * rest activate once they're registered.
 */
/** Catalog id of the threshold brush — the one tool whose intensity-window control
 *  the toolbox shows conditionally. Exported so that check isn't a magic string. */
export const THRESHOLD_TOOL_ID = 'threshold';

export const CATALOG_TO_TOOLNAME: Record<string, ToolName> = {
  // Segmentation
  brush: ToolName.Brush,
  sphereBrush: ToolName.SphereBrush,
  sphereEraser: ToolName.SphereEraser,
  sphereThreshold: ToolName.SphereThreshold,
  dynamicThreshold: ToolName.DynamicThreshold,
  eraser: ToolName.Eraser,
  [THRESHOLD_TOOL_ID]: ToolName.ThresholdBrush,
  circleScissors: ToolName.CircleScissors,
  rectangleScissors: ToolName.RectangleScissors,
  sphereScissors: ToolName.SphereScissors,
  paintFill: ToolName.PaintFill,
  region: ToolName.RegionSegment,
  regionPlus: ToolName.RegionSegmentPlus,
  rectMulti: ToolName.RectangleROIThreshold,
  contourFill: ToolName.LabelmapEditWithContour,
  select: ToolName.SegmentSelect,
  segBidirectional: ToolName.SegmentBidirectional,
  // Structure
  freehand: ToolName.FreehandContour,
  spline: ToolName.SplineContour,
  livewire: ToolName.LivewireContour,
  sculptor: ToolName.Sculptor,
  // Measurement
  length: ToolName.Length,
  angle: ToolName.Angle,
  bidirectional: ToolName.Bidirectional,
  ellipse: ToolName.EllipticalROI,
  rectROI: ToolName.RectangleROI,
  circleROI: ToolName.CircleROI,
  probe: ToolName.Probe,
  arrow: ToolName.ArrowAnnotate,
  freehandROI: ToolName.PlanarFreehandROI,
};

/** Reverse map: Cornerstone ToolName → catalog id (for toolbox active highlight). */
export const TOOLNAME_TO_CATALOG: Partial<Record<ToolName, string>> = Object.fromEntries(
  Object.entries(CATALOG_TO_TOOLNAME).map(([catalogId, toolName]) => [toolName, catalogId]),
) as Partial<Record<ToolName, string>>;
