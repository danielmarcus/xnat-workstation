/**
 * The spline slice workflow (SegWorks parity branch 6, F5; inventory #85–89 —
 * docs/segworks-parity.md §10, "F5 design").
 *
 * One mechanism for both annotation types: the SPLINE IN HAND — a closed spline on a slice,
 * placed from control points by the mode's own Spline tool (the Structure Spline on the active
 * member, or Contour Fill's Spline boundary) exactly as its first click would create it, and
 * editable by its handles. It is the preview: ⏎ commits it along the path a drawn spline takes
 * when it closes (a Structure's union, Contour Fill's fill — one undo step), ⎋ discards it.
 *
 *  - Undo & edit (#85): undo the last spline commit (while it is still the newest edit) and
 *    hold its control points again.
 *  - Copy nearby (#86): hold the active member's outline from the nearest other slice,
 *    projected onto this one — nothing is written.
 *  - Propagate ◀ ▶ (#87–89): carry the spline (or the member's outline here) to the previous /
 *    next slice — deformed onto that slice's edges, or propagated as a mask (optionally refined
 *    by the morphological snake) — move there and hold the result.
 */
import { Enums as CoreEnums, eventTarget, getEnabledElementByViewportId, metaData, utilities as csUtils } from '@cornerstonejs/core';
import { annotation as csAnnotation, Enums as ToolEnums, ToolGroupManager } from '@cornerstonejs/tools';
import { ToolName } from '@shared/types/viewer';
import { beginTransaction, type MemberRef } from './labelmapTransaction';
import { sliceAxisFor } from './maskIslands';
import { indexToWorld, worldToIndex, type Vec3 } from './segmentationService/voxelClipboard';
import { getAnnotationUIDs } from './contourRepresentation';
import { segmentationService } from './segmentationService';
import { viewportService } from './viewportService';
import { getContourToolSettings } from './tools/contourToolSettings';
import { slicePlane } from './tools/AppSplineContourTool';
import { type Axis, planeAxes } from '../segmentation/maskOps/planeIO';
import { outlineControlPoints, rasterize, resampleClosed } from '../segmentation/contours/polygon';
import { refineTowardEdges, splinePath, type Point } from '../segmentation/contours/splines';
import { snakeRefine } from '../segmentation/contours/snake';
import { DEFAULT_PROPAGATE, intensityReference, propagateStep } from '../segmentation/interpolation/propagate';
import { hotkeyService } from '../hotkeys/hotkeyService';
import { showToast } from '../../stores/toastStore';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { useSplineSliceStore } from '../../stores/splineSliceStore';
import { useViewerStore } from '../../stores/viewerStore';

/** The Spline tools, by the app's tool name → Cornerstone's. */
const SPLINE_TOOLS: Partial<Record<ToolName, string>> = {
  [ToolName.SplineContour]: 'SplineContourSegmentationTool',
  [ToolName.ContourFillSpline]: 'ContourFillSpline',
};
const SPLINE_TOOL_NAMES = new Set(Object.values(SPLINE_TOOLS));

/** How far Copy nearby looks for content, in slices. */
const NEARBY_SLICES = 10;

interface SplineToolInstance {
  placeInHand(element: HTMLDivElement, points: number[][]): string | null;
  commitInHand(uid: string): boolean;
  discardInHand(uid: string): boolean;
}

type Viewport = {
  id: string;
  element: HTMLDivElement;
  getCamera(): { focalPoint?: number[]; viewPlaneNormal?: number[]; viewUp?: number[] };
  worldToCanvas(p: number[]): [number, number];
  canvasToWorld(p: [number, number]): number[];
  getSliceIndex?(): number;
  getCurrentImageId?(): string;
  scroll(delta: number): void;
};

interface Context {
  viewportId: string;
  viewport: Viewport;
  toolName: string;
  tool: SplineToolInstance;
  member: MemberRef;
  kind: 'SEG' | 'RTSTRUCT';
  focal: number[];
  normal: number[];
  viewUp: number[];
  /** World distance between slices along the view normal. */
  spacing: number;
}

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** The active viewport, Spline tool and member — null unless a Spline tool is the active tool. */
function context(): Context | null {
  const viewer = useViewerStore.getState();
  const toolName = SPLINE_TOOLS[viewer.activeTool];
  const viewportId = viewer.activeViewportId;
  if (!toolName || !viewportId) return null;
  let viewport: Viewport | undefined;
  try {
    viewport = getEnabledElementByViewportId(viewportId)?.viewport as unknown as Viewport | undefined;
  } catch {
    return null;
  }
  const tool = ToolGroupManager.getToolGroupForViewport(viewportId)?.getToolInstance(toolName) as unknown as SplineToolInstance | undefined;
  const seg = useSegmentationStore.getState();
  const containerId = seg.activeSegmentationId;
  const cam = viewport?.getCamera();
  if (!viewport || !tool?.placeInHand || !containerId || !(seg.activeSegmentIndex > 0) || !cam?.focalPoint || !cam.viewPlaneNormal || !cam.viewUp) return null;
  let spacing = 1;
  try {
    spacing = (csUtils.getTargetVolumeAndSpacingInNormalDir(viewport as never, cam as never) as { spacingInNormalDirection?: number }).spacingInNormalDirection || 1;
  } catch { /* 1 mm */ }
  return {
    viewportId, viewport, toolName, tool,
    member: { containerId, segmentIndex: seg.activeSegmentIndex },
    kind: seg.dicomTypeBySegmentationId[containerId] === 'RTSTRUCT' ? 'RTSTRUCT' : 'SEG',
    focal: cam.focalPoint, normal: cam.viewPlaneNormal, viewUp: cam.viewUp, spacing,
  };
}

/** Slices from the current one to a world point, along the view normal (signed, rounded). */
const sliceOffset = (ctx: Context, p: number[]) => Math.round(dot(sub(p, ctx.focal), ctx.normal) / ctx.spacing);
/** A world point moved along the view normal onto the current slice. */
function project(ctx: Context, p: number[]): number[] {
  const d = dot(sub(p, ctx.focal), ctx.normal);
  return [p[0] - d * ctx.normal[0], p[1] - d * ctx.normal[1], p[2] - d * ctx.normal[2]];
}

// ─── The spline in hand ───────────────────────────────────────────────────────

let held: { uid: string; viewportId: string; toolName: string; removeKeys: () => void } | null = null;

function heldTool(): SplineToolInstance | null {
  if (!held) return null;
  return (ToolGroupManager.getToolGroupForViewport(held.viewportId)?.getToolInstance(held.toolName) as unknown as SplineToolInstance | undefined) ?? null;
}

function release(): void {
  held?.removeKeys();
  held = null;
  useSplineSliceStore.setState({ inHand: false });
}

/** Hold a closed spline through `points` (world) on the current slice. */
function hold(ctx: Context, points: number[][]): boolean {
  discardInHand();
  const uid = ctx.tool.placeInHand(ctx.viewport.element, points);
  if (!uid) return false;
  const removeKeys = hotkeyService.pushKeyLayer({
    onKeyDown: (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'z' && !e.shiftKey) { discardInHand(); return true; }
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      if (e.key === 'Enter') { commitInHand(); return true; }
      if (e.key === 'Escape') { discardInHand(); return true; }
      return false;
    },
  });
  held = { uid, viewportId: ctx.viewportId, toolName: ctx.toolName, removeKeys };
  useSplineSliceStore.setState({ inHand: true });
  return true;
}

/** The spline in hand's control points (world), or null. */
function heldPoints(): number[][] | null {
  if (!held) return null;
  const a = csAnnotation.state.getAnnotation(held.uid) as { data?: { handles?: { points?: number[][] } } } | undefined;
  return a?.data?.handles?.points?.map((p) => [...p]) ?? null;
}

/** ⏎: commit the spline in hand (one undo step). */
export function commitInHand(): boolean {
  const tool = heldTool();
  const uid = held?.uid;
  release();
  return !!(tool && uid && tool.commitInHand(uid));
}

/** ⎋: drop the spline in hand. */
export function discardInHand(): boolean {
  const tool = heldTool();
  const uid = held?.uid;
  release();
  return !!(tool && uid && tool.discardInHand(uid));
}

// A spline in hand belongs to the tool it was placed with: picking another tool drops it.
useViewerStore.subscribe((s, prev) => {
  if (held && s.activeTool !== prev.activeTool) discardInHand();
});

// ─── What was committed (Undo & edit, and Copy nearby's exact control points) ──

interface SplineRecord {
  member: MemberRef;
  points: number[][];
  normal: number[];
  viewportId: string;
  sliceIndex: number | null;
}

const remembered: SplineRecord[] = [];
let last: { record: SplineRecord; entry: unknown } | null = null;

eventTarget.addEventListener(ToolEnums.Events.ANNOTATION_COMPLETED, ((evt: CustomEvent) => {
  const a = evt.detail?.annotation as { metadata?: { toolName?: string }; data?: { handles?: { points?: number[][] } } } | undefined;
  const points = a?.data?.handles?.points;
  if (!a || !SPLINE_TOOL_NAMES.has(a.metadata?.toolName ?? '') || !points || points.length < 3) return;
  const seg = useSegmentationStore.getState();
  const viewportId = useViewerStore.getState().activeViewportId;
  let viewport: Viewport | undefined;
  try {
    viewport = getEnabledElementByViewportId(viewportId)?.viewport as unknown as Viewport | undefined;
  } catch { /* none */ }
  const normal = viewport?.getCamera().viewPlaneNormal;
  if (!seg.activeSegmentationId || !normal) return;
  const record: SplineRecord = {
    member: { containerId: seg.activeSegmentationId, segmentIndex: seg.activeSegmentIndex },
    points: points.map((p) => [...p]), normal: [...normal], viewportId, sliceIndex: viewport?.getSliceIndex?.() ?? null,
  };
  remembered.push(record);
  if (remembered.length > 200) remembered.shift();
  // The commit's history entry settles in the same turn (a Structure's union rewrites it).
  setTimeout(() => {
    last = { record, entry: segmentationService.peekUndoEntry() };
    useSplineSliceStore.setState({ canUndoEdit: true });
  }, 0);
}) as EventListener);

const sameMember = (a: MemberRef, b: MemberRef) => a.containerId === b.containerId && a.segmentIndex === b.segmentIndex;

/** Wait until the viewport shows another slice (or give up). */
function waitForSlice(viewport: Viewport, before: { focal: number[]; index: number | null }): Promise<boolean> {
  const moved = () => {
    const f = viewport.getCamera().focalPoint ?? before.focal;
    return Math.hypot(...sub(f, before.focal)) > 1e-3 || (viewport.getSliceIndex?.() ?? null) !== before.index;
  };
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      viewport.element.removeEventListener(CoreEnums.Events.IMAGE_RENDERED, onRendered);
      clearTimeout(timer);
      resolve(ok);
    };
    const onRendered = () => { if (moved()) finish(true); };
    viewport.element.addEventListener(CoreEnums.Events.IMAGE_RENDERED, onRendered);
    const timer = setTimeout(() => finish(moved()), 3000);
  });
}

// ─── The member's outline on a slice ─────────────────────────────────────────

/** A world polyline on the current slice as `count`-free control points (one per ~8 px). */
function polylineControlPoints(ctx: Context, polyline: number[][]): number[][] {
  const right = cross(ctx.viewUp, ctx.normal);
  const flat = polyline.map((p) => { const q = sub(project(ctx, p), ctx.focal); return { x: dot(q, right), y: dot(q, ctx.viewUp) }; });
  let perimeter = 0;
  for (let i = 0; i < flat.length; i++) perimeter += Math.hypot(flat[(i + 1) % flat.length].x - flat[i].x, flat[(i + 1) % flat.length].y - flat[i].y);
  const pixel = inPlaneSpacing(ctx);
  const k = Math.max(6, Math.min(24, Math.round(perimeter / pixel / 8)));
  return resampleClosed(flat, k).map((p) => [0, 1, 2].map((i) => ctx.focal[i] + p.x * right[i] + p.y * ctx.viewUp[i]));
}

function inPlaneSpacing(ctx: Context): number {
  const a = ctx.viewport.canvasToWorld([0, 0]), b = ctx.viewport.canvasToWorld([1, 0]);
  const plane = slicePlane(ctx.viewport.element);
  if (!plane) return 1;
  const pa = plane.toPlane([0, 0]), pb = plane.toPlane([1, 0]);
  const pxPerCanvas = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) || 1;
  return Math.hypot(...sub(b, a)) / pxPerCanvas;
}

/**
 * The member's outlines by slice offset (0 = this slice), each as control points projected
 * onto the current slice: a Structure's contours, a Segmentation's largest island per slice.
 */
function outlinesNear(ctx: Context, maxOffset: number): Map<number, number[][]> {
  const out = new Map<number, number[][]>();
  if (ctx.kind === 'RTSTRUCT') {
    for (const uid of getAnnotationUIDs(ctx.member.containerId, ctx.member.segmentIndex) ?? []) {
      const a = csAnnotation.state.getAnnotation(uid) as { data?: { contour?: { polyline?: number[][] } }; metadata?: { viewPlaneNormal?: number[] } } | undefined;
      const poly = a?.data?.contour?.polyline;
      if (!poly || poly.length < 3) continue;
      const d = sliceOffset(ctx, poly[0]);
      if (Math.abs(d) > maxOffset) continue;
      const pts = polylineControlPoints(ctx, poly);
      // Several contours on one slice: keep the one with the most boundary.
      if (!out.has(d) || pts.length > out.get(d)!.length) out.set(d, pts);
    }
    return out;
  }
  const begun = beginTransaction([ctx.member], undefined, { allowLocked: true });
  if (!begun.ok) return out;
  const { txn } = begun;
  try {
    const grid = txn.grid(ctx.member);
    if (!grid) return out;
    const axis = sliceAxisFor(grid.geometry.direction, ctx.normal) as Axis;
    const [ax, ay] = planeAxes(axis);
    const cur = worldToIndex(grid.geometry, ctx.focal as Vec3)[axis];
    // Offsets count the grid's own slices (an oblique segment's outline is not in the view
    // plane, so its distance along the view normal says little), signed as the view's.
    const step: Vec3 = [0, 0, 0];
    step[axis] = 1;
    const sign = Math.sign(dot(sub(indexToWorld(grid.geometry, step) as number[], indexToWorld(grid.geometry, [0, 0, 0]) as number[]), ctx.normal)) || 1;
    for (let s = cur - maxOffset; s <= cur + maxOffset; s++) {
      if (s < 0 || s >= grid.geometry.dimensions[axis]) continue;
      const plane = txn.readPlane(ctx.member, axis, s);
      if (!plane || !plane.data.some((v) => v)) continue;
      const cps = outlineControlPoints(plane);
      if (cps.length < 3) continue;
      const world = cps.map((p) => {
        const ijk: Vec3 = [0, 0, 0];
        ijk[axis] = s; ijk[ax] = p.x; ijk[ay] = p.y;
        return indexToWorld(grid.geometry, ijk) as number[];
      });
      out.set((s - cur) * sign, world.map((p) => project(ctx, p)));
    }
    return out;
  } finally {
    txn.discard();
  }
}

/** A remembered spline of the member on the slice at `offset`, projected here. */
function rememberedAt(ctx: Context, offset: number): number[][] | null {
  for (let i = remembered.length - 1; i >= 0; i--) {
    const r = remembered[i];
    if (!sameMember(r.member, ctx.member) || Math.abs(dot(r.normal, ctx.normal)) < 0.99) continue;
    if (sliceOffset(ctx, r.points[0]) === offset) return r.points.map((p) => project(ctx, p));
  }
  return null;
}

// ─── The three actions ───────────────────────────────────────────────────────

export type SplineSliceResult = 'ok' | 'no-spline-tool' | 'nothing' | 'stale' | 'no-slice' | 'stopped';

function tell(r: SplineSliceResult, message: string): SplineSliceResult {
  if (r !== 'ok') showToast(message);
  return r;
}

export const splineSliceService = {
  commitInHand,
  discardInHand,

  /** #85: undo the last spline commit and hold its control points again, on its slice. */
  async undoAndEdit(): Promise<SplineSliceResult> {
    const ctx = context();
    if (!ctx) return 'no-spline-tool';
    const l = last;
    if (!l) return tell('nothing', 'No spline to undo');
    if (!l.entry || segmentationService.peekUndoEntry() !== l.entry) {
      last = null;
      useSplineSliceStore.setState({ canUndoEdit: false });
      return tell('stale', 'The last spline is no longer the newest edit');
    }
    discardInHand();
    segmentationService.undo();
    last = null;
    useSplineSliceStore.setState({ canUndoEdit: false });
    const at = remembered.lastIndexOf(l.record);
    if (at >= 0) remembered.splice(at, 1);
    // Back to its slice, if the viewport has moved on.
    if (l.record.viewportId === ctx.viewportId && l.record.sliceIndex !== null && ctx.viewport.getSliceIndex?.() !== l.record.sliceIndex) {
      const before = { focal: ctx.focal, index: ctx.viewport.getSliceIndex?.() ?? null };
      viewportService.scrollToSlice(ctx.viewportId, l.record.sliceIndex);
      await waitForSlice(ctx.viewport, before);
    }
    const here = context();
    return here && hold(here, l.record.points) ? 'ok' : 'nothing';
  },

  /** #86: hold the member's outline from the nearest other slice, projected onto this one. */
  copyNearby(): SplineSliceResult {
    const ctx = context();
    if (!ctx) return 'no-spline-tool';
    const outlines = outlinesNear(ctx, NEARBY_SLICES);
    for (let d = 1; d <= NEARBY_SLICES; d++) {
      for (const offset of [-d, d]) { // the previous slice wins a tie
        const found = outlines.get(offset);
        if (!found) continue;
        return hold(ctx, rememberedAt(ctx, offset) ?? found) ? 'ok' : 'nothing';
      }
    }
    return tell('nothing', `Nothing to copy within ${NEARBY_SLICES} slices`);
  },

  /** #87–89: carry the spline (or the member's outline here) to the next slice and hold it. */
  async propagate(direction: -1 | 1): Promise<SplineSliceResult> {
    const ctx = context();
    if (!ctx || useSplineSliceStore.getState().busy) return 'no-spline-tool';
    const here = heldPoints() ? null : outlinesNear(ctx, 0).get(0) ?? null;
    const source = heldPoints() ?? (here ? (rememberedAt(ctx, 0) ?? here) : null);
    if (!source || source.length < 3) return tell('nothing', 'Draw a spline on this slice first');
    if (held) commitInHand();
    const track = getContourToolSettings().spline.propagateTrack;
    const plane0 = slicePlane(ctx.viewport.element);
    if (!plane0) return 'nothing';
    const canvas = source.map((p) => ctx.viewport.worldToCanvas(p));
    let mask0: { width: number; height: number; data: Uint8Array } | null = null;
    let ref: ReturnType<typeof intensityReference> = null;
    if (track !== 'deform') {
      const s = getContourToolSettings().spline;
      const curve = splinePath(canvas.map((c) => { const q = plane0.toPlane(c); return { x: q[0], y: q[1] }; }),
        s.algorithm === 'linear' ? 'centripetalCR' : s.algorithm, { samplesPerSegment: s.samplesPerSegment, tension: s.tension });
      mask0 = { width: plane0.width, height: plane0.height, data: rasterize(curve.map((p) => [p.x, p.y] as [number, number]), plane0.width, plane0.height) };
      ref = intensityReference(mask0, plane0.scalar, true);
    }
    useSplineSliceStore.setState({ busy: true });
    try {
      const before = { focal: ctx.focal, index: ctx.viewport.getSliceIndex?.() ?? null };
      const moving = waitForSlice(ctx.viewport, before);
      try { ctx.viewport.scroll(direction); } catch { /* at the end */ }
      if (!(await moving)) return tell('no-slice', 'No slice there');
      const next = context();
      const plane1 = slicePlane(ctx.viewport.element);
      if (!next || !plane1) return 'nothing';
      let cps: Point[];
      if (track === 'deform') {
        const inPlane = canvas.map((c) => { const q = plane1.toPlane(c); return { x: q[0], y: q[1] }; });
        cps = refineTowardEdges(inPlane, plane1.scalar, plane1.width, plane1.height, null);
      } else {
        let grown = mask0 && ref ? propagateStep(mask0, plane1.scalar, ref, { ...DEFAULT_PROPAGATE, modality: modalityOf(ctx.viewport) }) : null;
        if (grown && track === 'maskSnake') grown = snakeRefine(grown, plane1.scalar, { variant: 'morph' });
        cps = grown ? outlineControlPoints(grown) : [];
        if (cps.length < 3) return tell('stopped', 'Propagation stopped — nothing similar on that slice');
      }
      const world = cps.map((p) => next.viewport.canvasToWorld(plane1.toCanvas([p.x, p.y])));
      return hold(next, world) ? 'ok' : 'nothing';
    } finally {
      useSplineSliceStore.setState({ busy: false });
    }
  },
};

function modalityOf(viewport: Viewport): 'ct' | 'mr' {
  const id = viewport.getCurrentImageId?.();
  const m = id ? (metaData.get('generalSeriesModule', id) as { modality?: string } | undefined)?.modality : undefined;
  return m && m.toUpperCase() !== 'CT' ? 'mr' : 'ct';
}
