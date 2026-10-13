/**
 * Spline with SegWorks' families and editing (parity branch 6, F3; inventory #82–100 —
 * docs/segworks-parity.md §10).
 *
 * Extends Cornerstone's SplineContourSegmentationTool rather than forking it, under the
 * SAME tool name (annotations, RTSTRUCT export, the AnnotationToPointData registration and
 * the tool group are unchanged):
 *
 *  - Families (#93–99): each F1 family is a Cornerstone `Spline` subclass (FamilySpline)
 *    built from `splineSegments`, registered as a spline type; the chosen family is applied
 *    when a spline is created. Cornerstone evaluates splines in CANVAS coordinates.
 *  - Point undo (#83) and clear (#84) are offered to the toolbox through `registerSplineActions`.
 *  - Self-intersection protection (#100): a closing click whose closed curve would cross
 *    itself is refused before Cornerstone sees it (closing completes the drawing there);
 *    any other edit — a new point, a drag — that makes the curve cross is undone at the
 *    render-time rebuild (`_updateSplineInstance`, which every edit goes through).
 *  - Local ROI editing (#90–91): with an ROI limit drawn, points are added and moved only
 *    inside it.
 *  - ROI active spline (#99): the drawn curve is pulled onto image edges inside the ROI, in
 *    image index space (`refineTowardEdges`).
 *
 * Cornerstone declares the members involved `private`; they are replaced on the instance
 * (as the Live Wire subclass does), with the reason here.
 */
import { getEnabledElement, utilities as csUtils, VolumeViewport } from '@cornerstonejs/core';
import { SplineContourSegmentationTool, SplineROITool, utilities as csToolsUtils } from '@cornerstonejs/tools';
import { Spline } from '@cornerstonejs/tools/tools/annotation/splines/Spline';
import { LinearSpline } from '@cornerstonejs/tools/tools/annotation/splines/LinearSpline';
import type { SplineCurveSegment } from '@cornerstonejs/tools/types/SplineCurveSegment';
import { refineTowardEdges, splineSegments, type Point, type SplineAlgorithm } from '../../segmentation/contours/splines';
import { hasSelfIntersection, hasSelfIntersectionOpen } from '../../segmentation/contours/polygon';
import { getContourRoi, getContourToolSettings, registerSplineActions, type SplineSettings } from './contourToolSettings';

type Point2 = [number, number];

/** Cornerstone's spline click-to-close distance (screen px), SplineROITool.ts. */
const SPLINE_CLICK_CLOSE_CURVE_DIST = 10;

/** Spline type names registered with Cornerstone for each family. */
export const SPLINE_TYPE: Record<SplineSettings['algorithm'], string> = {
  centripetalCR: 'SW_CENTRIPETAL_CR',
  cubicBSpline: 'SW_CUBIC_BSPLINE',
  monotoneCubic: 'SW_MONOTONE_CUBIC',
  akima: 'SW_AKIMA',
  localCR: 'SW_LOCAL_CR',
  tensionSpline: 'SW_TENSION',
  roiActiveSpline: 'SW_ROI_ACTIVE',
  linear: 'LINEAR', // Cornerstone's own
};

function toSegment(points: Point2[], controlPoints: SplineCurveSegment['controlPoints'], previousCurveSegmentsLength: number): SplineCurveSegment {
  const lineSegments: SplineCurveSegment['lineSegments'] = [];
  let length = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 1; i < points.length; i++) {
    const start = points[i - 1], end = points[i];
    const l = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const aabb = { minX: Math.min(start[0], end[0]), maxX: Math.max(start[0], end[0]), minY: Math.min(start[1], end[1]), maxY: Math.max(start[1], end[1]) };
    minX = Math.min(minX, aabb.minX); maxX = Math.max(maxX, aabb.maxX); minY = Math.min(minY, aabb.minY); maxY = Math.max(maxY, aabb.maxY);
    lineSegments.push({ points: { start, end }, aabb, length: l, previousLineSegmentsLength: length });
    length += l;
  }
  return { controlPoints, aabb: { minX, minY, maxX, maxY }, length, previousCurveSegmentsLength, lineSegments };
}

/** A Cornerstone spline whose curve is one of the F1 families (canvas coordinates). */
export abstract class FamilySpline extends Spline {
  protected abstract readonly algorithm: SplineAlgorithm;
  /** Optional per-render refinement of the closed curve (the ROI active spline). */
  refiner: ((pts: Point[]) => Point[]) | null = null;

  protected getTransformMatrix(): number[] {
    return []; // not a fixed-basis cubic; the curve comes from splineSegments
  }

  protected getSplineCurves(): SplineCurveSegment[] {
    return this.build(this.controlPoints, this.closed);
  }

  protected getPreviewCurveSegments(controlPointPreview: Point2, closeSpline: boolean): SplineCurveSegment[] {
    const pts = [...this.controlPoints];
    if (!closeSpline) pts.push(controlPointPreview);
    return this.build(pts, closeSpline);
  }

  private build(cps: Point2[], closed: boolean): SplineCurveSegment[] {
    if (cps.length < 2) return [];
    const n = cps.length;
    let pieces: Point2[][];
    if (n === 2) {
      pieces = closed ? [[cps[0], cps[1]], [cps[1], cps[0]]] : [[cps[0], cps[1]]];
    } else {
      const s = getContourToolSettings().spline;
      const segs = splineSegments(cps.map((p) => ({ x: p[0], y: p[1] })), this.algorithm, { samplesPerSegment: s.samplesPerSegment, tension: s.tension });
      let flat = segs;
      if (closed && this.refiner) {
        // Refine the whole closed curve (normals need neighbours), then cut it back into pieces.
        const sizes = segs.map((g) => g.length);
        const refined = this.refiner(segs.flat());
        flat = [];
        let k = 0;
        for (const size of sizes) { flat.push(refined.slice(k, k + size)); k += size; }
      }
      pieces = flat.map((g) => g.map((p) => [p.x, p.y] as Point2));
      if (!closed) pieces = pieces.slice(0, -1); // an open curve has no closing piece
    }
    const out: SplineCurveSegment[] = [];
    let previous = 0;
    pieces.forEach((pts, i) => {
      const at = (k: number) => cps[((k % n) + n) % n];
      const seg = toSegment(pts, { p0: at(i - 1), p1: cps[i], p2: at(i + 1), p3: at(i + 2) }, previous);
      previous += seg.length;
      out.push(seg);
    });
    return out;
  }
}

function familyClass(algorithm: SplineAlgorithm): new () => FamilySpline {
  return class extends FamilySpline {
    protected readonly algorithm = algorithm;
  };
}

export const FAMILY_CLASSES: Record<SplineAlgorithm, new () => FamilySpline> = {
  centripetalCR: familyClass('centripetalCR'),
  cubicBSpline: familyClass('cubicBSpline'),
  monotoneCubic: familyClass('monotoneCubic'),
  akima: familyClass('akima'),
  localCR: familyClass('localCR'),
  tensionSpline: familyClass('tensionSpline'),
  roiActiveSpline: familyClass('roiActiveSpline'),
};

type Viewport = {
  worldToCanvas(p: number[]): Point2;
  canvasToWorld(p: Point2): number[];
  getImageData(): { dimensions: number[]; scalarData?: ArrayLike<number>; imageData: unknown } | undefined;
};

/** The ROI limit as a canvas rectangle on this element's viewport (null if none here). */
function roiCanvasRect(element: HTMLDivElement): { x0: number; y0: number; x1: number; y1: number } | null {
  const roi = getContourRoi();
  if (!roi) return null;
  const enabled = getEnabledElement(element);
  const viewport = enabled?.viewport as unknown as (Viewport & { id: string }) | undefined;
  if (!viewport || viewport.id !== roi.viewportId) return null;
  const pts = roi.corners.map((c) => viewport.worldToCanvas(c));
  return {
    x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])),
    y0: Math.min(...pts.map((p) => p[1])), y1: Math.max(...pts.map((p) => p[1])),
  };
}

const inRect = (r: { x0: number; y0: number; x1: number; y1: number }, p: Point2) => p[0] >= r.x0 && p[0] <= r.x1 && p[1] >= r.y0 && p[1] <= r.y1;

/**
 * The slice on screen as an image plane, with canvas ↔ plane-index transforms — the same
 * stack / volume split Cornerstone's Live Wire uses to read its pixels.
 */
function slicePlane(element: HTMLDivElement): { width: number; height: number; scalar: ArrayLike<number>; toPlane: (c: Point2) => Point2; toCanvas: (p: Point2) => Point2 } | null {
  const enabled = getEnabledElement(element);
  const viewport = enabled?.viewport as unknown as Viewport | undefined;
  if (!viewport) return null;
  const vid = viewport.getImageData();
  if (!vid) return null;
  if (!(viewport instanceof VolumeViewport)) {
    const scalar = vid.scalarData;
    if (!scalar) return null;
    const image = vid.imageData as never;
    return {
      width: vid.dimensions[0], height: vid.dimensions[1], scalar,
      toPlane: (c) => { const ijk = csUtils.transformWorldToIndex(image, viewport.canvasToWorld(c) as never); return [ijk[0], ijk[1]]; },
      toCanvas: (p) => viewport.worldToCanvas(csUtils.transformIndexToWorld(image, [p[0], p[1], 0]) as number[]),
    };
  }
  const vp = viewport as unknown as Viewport; // past the instanceof check, typed as Cornerstone's
  const slice = csUtils.getCurrentVolumeViewportSlice(viewport as never) as unknown as {
    width: number; height: number; scalarData: ArrayLike<number>; sliceToIndexMatrix: number[]; indexToSliceMatrix: number[];
  };
  const image = vid.imageData as never;
  const mul = (m: number[], v: number[]) => [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r]);
  return {
    width: slice.width, height: slice.height, scalar: slice.scalarData,
    toPlane: (c) => { const ijk = csUtils.transformWorldToIndex(image, vp.canvasToWorld(c) as never); const s = mul(slice.indexToSliceMatrix, ijk as number[]); return [s[0], s[1]]; },
    toCanvas: (p) => vp.worldToCanvas(csUtils.transformIndexToWorld(image, mul(slice.sliceToIndexMatrix, [p[0], p[1], 0]) as never) as number[]),
  };
}

interface Annotation {
  data: {
    handles: { points: number[][] };
    contour: { closed: boolean };
    spline?: { instance?: FamilySpline | Spline; type?: string };
  };
}

type InteractionEvt = { type: string; detail: { element: HTMLDivElement; currentPoints: { canvas: Point2; world: number[] } } };

type SplineBase = abstract new (...args: any[]) => SplineROITool;

/**
 * SegWorks' spline families and editing on a Cornerstone Spline tool — the Structure tool
 * (SplineContourSegmentationTool) and Contour Fill's Spline boundary (the plain
 * SplineROITool, branch 6 F4) both get exactly the same behaviour.
 */
export function withSplineFeatures<TBase extends SplineBase>(Base: TBase) {
  abstract class SplineWithFeatures extends Base {
  /** Where the spline being drawn lives (for the toolbox's undo / clear). */
  private drawingElement: HTMLDivElement | null = null;
  private readonly lastGood = new WeakMap<object, { points: number[][]; closed: boolean }>();

  constructor(...args: any[]) {
    super(...args);
    const config = (this.configuration as { spline: { configuration: Record<string, Record<string, unknown>> } }).spline.configuration;
    for (const [algorithm, Class] of Object.entries(FAMILY_CLASSES)) config[SPLINE_TYPE[algorithm as SplineAlgorithm]] = { Class };
    config.LINEAR = { ...(config.LINEAR ?? {}), Class: LinearSpline };

    const self = this as unknown as {
      _updateSplineInstance: (element: HTMLDivElement, annotation: Annotation) => Spline;
      _mouseDownCallback: (evt: InteractionEvt) => void;
      _dragCallback: (evt: InteractionEvt) => void;
      editData: { annotation: Annotation; handleIndex?: number } | null;
    };

    const rebuild = self._updateSplineInstance.bind(this);
    self._updateSplineInstance = (element, annotation) => this.guardedRebuild(rebuild, element, annotation);

    const mouseDown = self._mouseDownCallback;
    self._mouseDownCallback = (evt) => {
      const annotation = self.editData?.annotation;
      if (annotation && !this.allowClick(evt, annotation)) return;
      mouseDown(evt);
    };

    const drag = self._dragCallback;
    self._dragCallback = (evt) => {
      const s = getContourToolSettings().spline;
      const rect = s.editMode === 'localRoi' ? roiCanvasRect(evt.detail.element) : null;
      if (rect && !inRect(rect, evt.detail.currentPoints.canvas)) return; // #91: stay inside the ROI
      drag(evt);
    };

    registerSplineActions({
      undoLastPoint: () => this.undoLastPoint(),
      clear: () => this.clearDrawing(),
    });
  }

  addNewAnnotation(evt: Parameters<SplineROITool['addNewAnnotation']>[0]) {
    const e = evt as unknown as InteractionEvt;
    const s = getContourToolSettings().spline;
    const rect = s.editMode === 'localRoi' ? roiCanvasRect(e.detail.element) : null;
    if (rect && !inRect(rect, e.detail.currentPoints.canvas)) return undefined as never; // #90: start inside the ROI
    this.drawingElement = e.detail.element;
    return super.addNewAnnotation(evt);
  }

  protected createAnnotation(evt: Parameters<SplineROITool['createAnnotation']>[0]) {
    (this.configuration as { spline: { type: string } }).spline.type = SPLINE_TYPE[getContourToolSettings().spline.algorithm];
    return super.createAnnotation(evt);
  }

  /** A click while drawing: refused outside the ROI (local mode), or if closing would cross. */
  private allowClick(evt: InteractionEvt, annotation: Annotation): boolean {
    const s = getContourToolSettings().spline;
    const rect = s.editMode === 'localRoi' ? roiCanvasRect(evt.detail.element) : null;
    const spline = annotation.data.spline?.instance as Spline | undefined;
    const closing = !!spline && annotation.data.handles.points.length >= 3
      && spline.getClosestControlPointWithinDistance(evt.detail.currentPoints.canvas, SPLINE_CLICK_CLOSE_CURVE_DIST)?.index === 0;
    if (rect && !closing && !inRect(rect, evt.detail.currentPoints.canvas)) return false;
    if (s.preventSelfIntersection && closing && spline) {
      spline.closed = true;
      const crosses = hasSelfIntersection(spline.getPolylinePoints().map((p) => ({ x: p[0], y: p[1] })));
      spline.closed = false;
      if (crosses) return false;
    }
    return true;
  }

  /** Rebuild the curve; undo the edit if it made the curve cross itself (#100). */
  private guardedRebuild(rebuild: (element: HTMLDivElement, annotation: Annotation) => Spline, element: HTMLDivElement, annotation: Annotation): Spline {
    let spline = rebuild(element, annotation);
    const s = getContourToolSettings().spline;
    if (spline instanceof FamilySpline) {
      spline.refiner = s.algorithm === 'roiActiveSpline' ? this.edgeRefiner(element) : null;
    }
    const snapshot = () => ({ points: annotation.data.handles.points.map((p) => [...p]), closed: annotation.data.contour.closed });
    if (!s.preventSelfIntersection) {
      this.lastGood.set(annotation, snapshot());
      return spline;
    }
    const poly = spline.getPolylinePoints().map((p) => ({ x: p[0], y: p[1] }));
    const crosses = annotation.data.contour.closed ? hasSelfIntersection(poly) : hasSelfIntersectionOpen(poly);
    const good = this.lastGood.get(annotation);
    if (crosses && good) {
      annotation.data.handles.points = good.points.map((p) => [...p]);
      annotation.data.contour.closed = good.closed;
      spline = rebuild(element, annotation);
    } else if (!crosses) {
      this.lastGood.set(annotation, snapshot());
    }
    return spline;
  }

  /** The ROI active spline's refinement for this element (null without an ROI here). */
  private edgeRefiner(element: HTMLDivElement): ((pts: Point[]) => Point[]) | null {
    const rect = roiCanvasRect(element);
    const plane = rect ? slicePlane(element) : null;
    if (!rect || !plane) return null;
    const a = plane.toPlane([rect.x0, rect.y0]), b = plane.toPlane([rect.x1, rect.y1]);
    const roi = { x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) };
    return (pts) => {
      const inPlane = pts.map((p) => { const q = plane.toPlane([p.x, p.y]); return { x: q[0], y: q[1] }; });
      return refineTowardEdges(inPlane, plane.scalar, plane.width, plane.height, roi).map((p) => {
        const c = plane.toCanvas([p.x, p.y]);
        return { x: c[0], y: c[1] };
      });
    };
  }

  private undoLastPoint(): boolean {
    const editData = (this as unknown as { editData: { annotation: Annotation } | null }).editData;
    const element = this.drawingElement;
    if (!this.isDrawing || !editData?.annotation || !element) return false;
    const points = editData.annotation.data.handles.points;
    if (points.length <= 1) return this.clearDrawing();
    // Not Cornerstone's _deleteControlPointByIndex: it is for editing a finished spline and
    // removes the whole annotation at three points. While drawing, undo drops one point.
    points.pop();
    (editData.annotation as unknown as { invalidated: boolean }).invalidated = true;
    csToolsUtils.triggerAnnotationRenderForViewportIds(csToolsUtils.viewportFilters.getViewportIdsWithToolToRender(element, this.getToolName()));
    return true;
  }

  private clearDrawing(): boolean {
    const element = this.drawingElement;
    if (!this.isDrawing || !element) return false;
    this.cancel(element);
    return true;
  }
}
  return SplineWithFeatures;
}

/** The Structure Spline — Cornerstone's tool name, so everything keyed on it still finds it. */
export class AppSplineContourTool extends withSplineFeatures(SplineContourSegmentationTool) {
  static toolName = SplineContourSegmentationTool.toolName;
}

/**
 * Contour Fill's Spline boundary (D3): a plain (non-segmentation) Spline whose closed curve
 * the fill listener rasterizes into the active segment and then removes.
 */
export class ContourFillSplineTool extends withSplineFeatures(SplineROITool) {
  static toolName = 'ContourFillSpline';
}
