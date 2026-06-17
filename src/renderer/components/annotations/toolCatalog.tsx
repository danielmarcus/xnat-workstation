/**
 * Tool catalog (Rebuild Phase 3, R3.6) — the per-kind tool lists the ContextToolbox
 * renders (frozen mockup §4). "In scope = every registered Cornerstone3D tool for
 * the active kind"; AI/auto-seg deferred. `planned: true` = registered-but-not-yet
 * wired (renders flat-greyed); the live FoR-disable (D3, dashed+slash) is applied
 * by the toolbox from runtime state, not encoded here. Icons are lifted from the
 * mockup so the grid pixel-matches.
 */
import type { ReactNode } from 'react';
import type { ContainerKind } from '@shared/types/annotation';
import { ToolName } from '@shared/types/viewer';

export interface ToolDef {
  id: string;
  label: string;
  title: string;
  /** Registered but not yet implemented — renders flat-greyed (temporary). */
  planned?: boolean;
  icon: ReactNode;
}

const S = (children: ReactNode, extra?: Record<string, unknown>) => (
  <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.4} {...extra}>
    {children}
  </svg>
);

const SEG_TOOLS: ToolDef[] = [
  { id: 'brush', label: 'Brush', title: 'Brush (B)', icon: <svg viewBox="0 0 16 16" width={14} height={14} fill="currentColor" stroke="none"><circle cx="8" cy="8" r="3.2" /></svg> },
  { id: 'eraser', label: 'Eraser', title: 'Eraser (E)', icon: S(<rect x="3" y="6" width="8" height="6" rx="1" transform="rotate(-25 8 8)" />) },
  { id: 'threshold', label: 'Threshold', title: 'Threshold brush', icon: S(<><circle cx="8" cy="8" r="3.8" /><path d="M5 8h6" /></>) },
  { id: 'dynamicThreshold', label: 'Dyn. Thresh', title: 'Dynamic threshold — planned (coming soon)', planned: true, icon: S(<><circle cx="8" cy="8" r="3.8" /><path d="M5 8h6" strokeDasharray="1.5 1" /></>) },
  { id: 'sphereBrush', label: 'Sph. Brush', title: 'Spherical brush (3D) — planned', planned: true, icon: S(<><circle cx="8" cy="8" r="4" /><ellipse cx="8" cy="8" rx="4" ry="1.7" /></>) },
  { id: 'sphereEraser', label: 'Sph. Eraser', title: 'Spherical eraser (3D) — planned', planned: true, icon: S(<><circle cx="8" cy="8" r="4" /><ellipse cx="8" cy="8" rx="4" ry="1.7" /><path d="M5 11l6-6" /></>) },
  { id: 'sphereThreshold', label: 'Sph. Thresh', title: 'Spherical threshold — planned', planned: true, icon: S(<><circle cx="8" cy="8" r="4" /><ellipse cx="8" cy="8" rx="4" ry="1.7" /></>) },
  { id: 'circleScissors', label: 'Circle', title: 'Circle scissors', icon: S(<circle cx="8" cy="8" r="5" />) },
  { id: 'rectangleScissors', label: 'Rectangle', title: 'Rectangle scissors', icon: S(<rect x="3" y="4" width="10" height="8" rx="1" />) },
  { id: 'sphereScissors', label: 'Sphere', title: 'Sphere scissors', icon: S(<><circle cx="8" cy="8" r="5" /><ellipse cx="8" cy="8" rx="5" ry="2" /></>) },
  { id: 'paintFill', label: 'Paint Fill', title: 'Paint fill / hole fill (F)', icon: S(<><path d="M3 8l5-5 5 5-5 5z" /><path d="M11 11c1 1 1 2 0 2" /></>) },
  { id: 'region', label: 'Region', title: 'Region (smart brush)', icon: S(<><circle cx="8" cy="8" r="4" strokeDasharray="2 1.3" /><circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none" /></>) },
  { id: 'regionPlus', label: 'Region+', title: 'Region+ (adaptive smart brush)', icon: S(<><circle cx="8" cy="8" r="4" strokeDasharray="2 1.3" /><path d="M8 6v4M6 8h4" /></>) },
  { id: 'rectMulti', label: 'Rect Multi', title: 'Rectangle threshold (multi-slice) — planned', planned: true, icon: S(<><rect x="4.5" y="2.5" width="9" height="7" rx="1" /><path d="M2.5 5.5v8h9" /></>) },
  { id: 'circleMulti', label: 'Circle Multi', title: 'Circle threshold (multi-slice)', icon: S(<><circle cx="9" cy="6" r="3.5" /><path d="M2.5 7.5v6h6" /></>) },
  { id: 'contourFill', label: 'Contour Fill', title: 'Contour fill (draw boundary → fill)', icon: S(<path d="M4 8c0-3 8-3 8 0s-8 3-8 0z" fill="currentColor" fillOpacity={0.25} />) },
  { id: 'select', label: 'Select', title: 'Select segment', icon: S(<path d="M4 3l8 5-3.5 1.2L7 13z" />) },
  { id: 'segBidirectional', label: 'Bidir.', title: 'Segment bidirectional measure — disabled (crashes on multi-layer-group segmentations; pending a group-aware fix)', planned: true, icon: S(<path d="M3 8h10M8 3v10" />) },
];

const STRUCTURE_TOOLS: ToolDef[] = [
  { id: 'freehand', label: 'Freehand', title: 'Freehand', icon: S(<path d="M3 11c1-4 4-6 6-3s5 1 4-3" />) },
  { id: 'spline', label: 'Spline', title: 'Spline', icon: S(<path d="M2 11c3 0 3-6 6-6s3 6 6 6" />) },
  { id: 'livewire', label: 'Livewire', title: 'Livewire', icon: S(<path d="M3 12c2-6 8-6 10 0" />, { strokeDasharray: '2 1.3' }) },
  { id: 'sculptor', label: 'Sculptor', title: 'Sculptor (push/pull boundary)', icon: S(<><circle cx="8" cy="8" r="5" /><path d="M8 3v10" /></>) },
];

const MEASUREMENT_TOOLS: ToolDef[] = [
  { id: 'length', label: 'Length', title: 'Length', icon: S(<path d="M3 13L13 3M4 10l2 2M7 7l2 2M10 4l2 2" />) },
  { id: 'angle', label: 'Angle', title: 'Angle', icon: S(<path d="M3 13L13 13M3 13L11 4" />) },
  { id: 'bidirectional', label: 'Bidir.', title: 'Bidirectional', icon: S(<path d="M3 8h10M8 3v10" />) },
  { id: 'ellipse', label: 'Ellipse', title: 'Elliptical ROI', icon: S(<ellipse cx="8" cy="8" rx="5.5" ry="3.5" />) },
  { id: 'rectROI', label: 'Rect ROI', title: 'Rectangle ROI', icon: S(<rect x="3" y="4.5" width="10" height="7" rx="1" />) },
  { id: 'circleROI', label: 'Circle', title: 'Circle ROI', icon: S(<circle cx="8" cy="8" r="5" />) },
  { id: 'probe', label: 'Probe', title: 'Probe', icon: S(<><circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none" /><path d="M8 2v3M8 11v3M2 8h3M11 8h3" /></>) },
  { id: 'arrow', label: 'Arrow', title: 'Arrow annotate', icon: S(<path d="M3 13L13 3M9 3h4v4" />) },
  { id: 'freehandROI', label: 'Freehand', title: 'Freehand ROI', icon: S(<path d="M3 10c1-4 4-5 6-2s4 0 4-3" />) },
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
 * rest activate once they're registered. `planned` tools have no mapping.
 */
export const CATALOG_TO_TOOLNAME: Record<string, ToolName> = {
  // Segmentation
  brush: ToolName.Brush,
  eraser: ToolName.Eraser,
  threshold: ToolName.ThresholdBrush,
  circleScissors: ToolName.CircleScissors,
  rectangleScissors: ToolName.RectangleScissors,
  sphereScissors: ToolName.SphereScissors,
  paintFill: ToolName.PaintFill,
  region: ToolName.RegionSegment,
  regionPlus: ToolName.RegionSegmentPlus,
  circleMulti: ToolName.CircleROIThreshold,
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
