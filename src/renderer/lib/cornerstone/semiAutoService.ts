/**
 * The Smart-tab tools' backend (SegWorks parity branch 4): Level Trace at a clicked point,
 * Smart Brush strokes, the ROI limit, and (C2) Random Walker runs.
 *
 * Everything works on the slice under the pointer, in the plane the viewport looks along
 * (index space, so oblique series behave), writes through a LabelmapTransaction, and shows
 * its result as a preview — Level Trace and Random Walker wait for ⏎; a Smart Brush stroke
 * commits on release (one undo step per stroke).
 */
import { metaData } from '@cornerstonejs/core';
import { viewportService } from './viewportService';
import { beginTransaction, type LabelmapTransaction, type MemberRef } from './labelmapTransaction';
import { OBLIQUE_VIEW_MESSAGE, sliceAxisFor, viewAlignedWithGrid } from './maskIslands';
import { worldToIndex, worldToIndexFloat, type Vec3, type VoxelGridGeometry } from './segmentationService/voxelClipboard';
import { commitPreview, discardPreview, discardPreviewForEdit, refreshPreview, startPreview } from './maskPreview';
import { getSourceImageIds } from './sourceImageTracking';
import { getWorldPointFromClientPoint } from './unifiedCrosshair';
import { semiAutoBridge } from './tools/semiAutoBridge';
import { setContourRoiProvider } from './tools/contourToolSettings';
import { startSemiAutoOverlay } from './semiAutoOverlay';
import { recordSeedRaster } from './seedRasterProbe';
import { seedBrushMm } from './solverService';
import { type Axis, extractValues, planeAxes, planeSize, sliceIndices } from '../segmentation/maskOps/planeIO';
import { guardFromSamples, levelTrace, rasterize } from '../segmentation/semiauto/levelTrace';
import { smartBrushDab, strokeDabs } from '../segmentation/semiauto/smartBrush';
import { computeClient, ComputeCancelled } from '../compute/computeClient';
import { hotkeyService } from '../hotkeys/hotkeyService';
import { useComputeStore } from '../../stores/computeStore';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { useSemiAutoStore, type RoiLimit } from '../../stores/semiAutoStore';
import { useSeedStore } from '../../stores/seedStore';
import { warnMemberLocked } from '../annotations/lockWarning';
import { eventTarget } from '@cornerstonejs/core';
import { annotation as csAnnotation, Enums as ToolEnums, utilities as csToolsUtilities } from '@cornerstonejs/tools';
import { useViewerStore } from '../../stores/viewerStore';

export type SemiAutoResult =
  | { ok: true; added: number; readOnly: boolean }
  | { ok: false; reason: 'no-target' | 'no-viewport' | 'oblique-view' | 'no-labelmap' | 'no-image' | 'outside' | 'no-change' | 'no-seeds' | 'cancelled' | 'failed' };

let runningJob: { cancel: () => void } | null = null;

interface Target {
  txn: LabelmapTransaction;
  member: MemberRef;
  others: MemberRef[];
  lockedMember: MemberRef | null;
}

/** Open a transaction on the active member, or `on` (a locked one opens read-only). */
function openTarget(on?: MemberRef): Target | null {
  const seg = useSegmentationStore.getState();
  const containerId = on?.containerId ?? seg.activeSegmentationId;
  const active = on?.segmentIndex ?? seg.activeSegmentIndex;
  const summary = seg.segmentations.find((s) => s.segmentationId === containerId);
  if (!containerId || !summary || !(active > 0)) return null;
  const member = { containerId, segmentIndex: active };
  let lockedMember: MemberRef | null = null;
  let begun = beginTransaction([member]);
  if (!begun.ok && begun.reason === 'locked') {
    lockedMember = member;
    begun = beginTransaction([member], undefined, { allowLocked: true });
  }
  if (!begun.ok) return null;
  const others = summary.segments.filter((m) => m.segmentIndex !== active).map((m) => ({ containerId, segmentIndex: m.segmentIndex }));
  return { txn: begun.txn, member, others, lockedMember };
}

/** The viewing axis, slice and in-plane pixel of a world point, for a grid seen in a viewport. */
/** Whether the viewport shows planes of this grid (see viewAlignedWithGrid). */
function aligned(viewportId: string, geometry: VoxelGridGeometry): boolean {
  const vp = viewportService.getViewport(viewportId) as { getCamera?: () => { viewPlaneNormal?: number[] } } | undefined;
  const normal = vp?.getCamera?.()?.viewPlaneNormal;
  return !normal || viewAlignedWithGrid(geometry.direction, normal);
}

export function planePoint(viewportId: string, geometry: VoxelGridGeometry, world: number[]): { axis: Axis; slice: number; x: number; y: number } | null {
  const vp = viewportService.getViewport(viewportId) as { getCamera?: () => { viewPlaneNormal?: number[] } } | undefined;
  const normal = vp?.getCamera?.()?.viewPlaneNormal;
  if (!normal) return null;
  const axis = sliceAxisFor(geometry.direction, normal) as Axis;
  const ijk = worldToIndex(geometry, world as Vec3);
  const [ax, ay] = planeAxes(axis);
  return { axis, slice: ijk[axis], x: ijk[ax], y: ijk[ay] };
}

function modalityOf(containerId: string): 'ct' | 'mr' {
  const img = getSourceImageIds(containerId)?.[0];
  const m = img ? (metaData.get('generalSeriesModule', img) as { modality?: string } | undefined)?.modality : undefined;
  return m && m.toUpperCase() !== 'CT' ? 'mr' : 'ct';
}

/** The ROI limit as a mask on a plane (the rectangle's extent in that plane), or undefined. */
export function roiPlaneMask(roi: RoiLimit | null, viewportId: string, geometry: VoxelGridGeometry, axis: Axis): Uint8Array | undefined {
  if (!roi || roi.viewportId !== viewportId) return undefined;
  const [ax, ay] = planeAxes(axis);
  const pts = roi.corners.map((c) => worldToIndex(geometry, c as Vec3));
  const xs = pts.map((p) => p[ax]);
  const ys = pts.map((p) => p[ay]);
  const { width, height } = planeSize(geometry.dimensions, axis);
  const x0 = Math.max(0, Math.min(...xs)), x1 = Math.min(width - 1, Math.max(...xs));
  const y0 = Math.max(0, Math.min(...ys)), y1 = Math.min(height - 1, Math.max(...ys));
  const out = new Uint8Array(width * height);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out[x + y * width] = 1;
  return out;
}

/** Union `region` into the member's plane (other segments protected) — staged in `t`. */
function addRegion(t: Target, axis: Axis, slice: number, region: Uint8Array, width: number, height: number): number {
  const current = t.txn.readPlane(t.member, axis, slice)!;
  const union = Uint8Array.from(region, (v, i) => (v || current.data[i] ? 1 : 0));
  const blocked = t.txn.unionPlane(t.others, axis, slice, width, height);
  return t.txn.applyPlane(t.member, axis, slice, { width, height, data: union }, { blocked }).added;
}

export const semiAutoService = {
  /** Level Trace at a world point on `viewportId`: preview the traced region (⏎ commits). */
  levelTraceAt(viewportId: string, world: number[]): SemiAutoResult {
    const t = openTarget();
    if (!t) return { ok: false, reason: 'no-target' };
    const grid = t.txn.grid(t.member);
    if (!grid) { t.txn.discard(); return { ok: false, reason: 'no-labelmap' }; }
    if (!aligned(viewportId, grid.geometry)) { t.txn.discard(); return { ok: false, reason: 'oblique-view' }; }
    const at = planePoint(viewportId, grid.geometry, world);
    const source = grid.sourceReader?.() ?? null;
    if (!at) { t.txn.discard(); return { ok: false, reason: 'no-viewport' }; }
    if (!source) { t.txn.discard(); return { ok: false, reason: 'no-image' }; }
    const { width, height } = planeSize(grid.geometry.dimensions, at.axis);
    if (at.x < 0 || at.y < 0 || at.x >= width || at.y >= height || at.slice < 0 || at.slice >= grid.geometry.dimensions[at.axis]) {
      t.txn.discard();
      return { ok: false, reason: 'outside' };
    }
    const s = useSemiAutoStore.getState();
    const o = s.levelTrace;
    const image = extractValues(grid.geometry.dimensions, at.axis, at.slice, source);
    const roi = roiPlaneMask(s.roi, viewportId, grid.geometry, at.axis);
    const region = levelTrace(image, width, height, at.x, at.y, { ...o, modality: o.modality ?? modalityOf(t.member.containerId) }, roi);
    const added = addRegion(t, at.axis, at.slice, region.data, width, height);
    if (!added) { t.txn.discard(); return { ok: false, reason: 'no-change' }; }
    discardPreview();
    startPreview({ txn: t.txn, label: 'Level Trace', summary: `+${added.toLocaleString('en-US')} px`, viewportId, lockedMember: t.lockedMember });
    return { ok: true, added, readOnly: !!t.lockedMember };
  },

  /** Smart Brush: a stroke begins (returns false when nothing can be painted). */
  smartBrushBegin(viewportId: string, world: number[]): boolean {
    discardPreviewForEdit();
    const t = openTarget();
    if (!t) return false;
    if (t.lockedMember) { t.txn.discard(); return false; }
    const grid = t.txn.grid(t.member);
    if (grid && !aligned(viewportId, grid.geometry)) {
      t.txn.discard();
      useSemiAutoStore.getState().setMessage(OBLIQUE_VIEW_MESSAGE);
      return false;
    }
    const at = grid ? planePoint(viewportId, grid.geometry, world) : null;
    const source = grid?.sourceReader?.() ?? null;
    if (!grid || !at || !source) { t.txn.discard(); return false; }
    stroke = {
      t, viewportId, axis: at.axis, slice: at.slice,
      image: extractValues(grid.geometry.dimensions, at.axis, at.slice, source),
      size: planeSize(grid.geometry.dimensions, at.axis),
      geometry: grid.geometry,
      mmPerPx: [grid.geometry.spacing[planeAxes(at.axis)[0]], grid.geometry.spacing[planeAxes(at.axis)[1]]],
      started: false,
      last: null,
    };
    semiAutoService.smartBrushExtend(world);
    return true;
  },

  smartBrushExtend(world: number[]): void {
    const st = stroke;
    if (!st) return;
    const ijk = worldToIndex(st.geometry, world as Vec3);
    const [ax, ay] = planeAxes(st.axis);
    if (ijk[st.axis] !== st.slice) return; // a stroke stays on its slice
    const o = useSemiAutoStore.getState().smartBrush;
    const dab = new Uint8Array(st.size.width * st.size.height);
    // Round in mm: as many pixels along each axis as that axis's spacing gives (a sagittal
    // plane of thick-slice CT has 0.7 mm columns and 2.5 mm rows).
    const radiusPx = Math.max(1, o.radiusMm / st.mmPerPx[0]);
    const radiusPxY = Math.max(0.5, o.radiusMm / st.mmPerPx[1]);
    // Dabs all along the path since the last move, at most half a radius apart: one dab per
    // mouse event left gaps wherever the pointer moved fast.
    const here: [number, number] = [ijk[ax], ijk[ay]];
    const centres = st.last ? strokeDabs([st.last, here], Math.min(o.spacingPx, Math.max(0.5, Math.min(radiusPx, radiusPxY) / 2))) : [here];
    st.last = here;
    for (const [x, y] of centres) {
      smartBrushDab(st.image, st.size.width, st.size.height, Math.round(x), Math.round(y), { radiusPx, radiusPxY, tolerance: o.tolerance, spacingPx: o.spacingPx }, dab);
    }
    const added = addRegion(st.t, st.axis, st.slice, dab, st.size.width, st.size.height);
    if (!added) return;
    if (!st.started) {
      startPreview({ txn: st.t.txn, label: 'Smart Brush', summary: '', viewportId: st.viewportId, silent: true });
      st.started = true;
    } else {
      refreshPreview();
    }
  },

  /** Release: the stroke is written as one undo step. */
  smartBrushEnd(): void {
    const st = stroke;
    stroke = null;
    if (!st) return;
    if (st.started) commitPreview();
    else st.t.txn.discard();
  },

  /**
   * Random Walker on the slice on screen: foreground and background seed strokes (drawn on
   * `viewportId`) become seed masks; the solve runs on the seeds' bounding box plus padding
   * (or the ROI limit, when one is drawn there) and its foreground is previewed (⏎ commits).
   */
  async randomWalkerRun(viewportId: string): Promise<SemiAutoResult> {
    const s = useSemiAutoStore.getState();
    const { activeSegmentationId: containerId, activeSegmentIndex: active } = useSegmentationStore.getState();
    // The active segment's seeds are foreground; Background's and other segments' are background.
    const seeds = useSeedStore.getState().strokes
      .filter((st) => st.containerId === containerId && st.viewportId === viewportId)
      .map((st) => ({ ...st, kind: st.cls === active ? 'fg' as const : 'bg' as const }));
    if (!seeds.some((st) => st.kind === 'fg') || !seeds.some((st) => st.kind === 'bg')) return { ok: false, reason: 'no-seeds' };
    const t = openTarget();
    if (!t) return { ok: false, reason: 'no-target' };
    const grid = t.txn.grid(t.member);
    const source = grid?.sourceReader?.() ?? null;
    if (!grid) { t.txn.discard(); return { ok: false, reason: 'no-labelmap' }; }
    if (!source) { t.txn.discard(); return { ok: false, reason: 'no-image' }; }
    // The slice on screen (the shared seed store can hold seeds on other slices too).
    const focal = (viewportService.getViewport(viewportId) as { getCamera?: () => { focalPoint?: number[] } } | undefined)?.getCamera?.()?.focalPoint;
    if (!aligned(viewportId, grid.geometry)) { t.txn.discard(); return { ok: false, reason: 'oblique-view' }; }
    const first = focal ? planePoint(viewportId, grid.geometry, focal) : null;
    if (!first) { t.txn.discard(); return { ok: false, reason: 'no-viewport' }; }
    const { axis, slice } = first;
    const { width, height } = planeSize(grid.geometry.dimensions, axis);
    const [ax, ay] = planeAxes(axis);
    // Rasterise the strokes on the seeds' slice (points on other slices are ignored).
    const fg = new Uint8Array(width * height);
    const bg = new Uint8Array(width * height);
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    for (const st of seeds) {
      // The brush is round in mm (#92): its radius in pixels along each in-plane axis (+½ px,
      // so a 0 mm seed is the one pixel under the pointer).
      const rx2 = (Math.max(0, st.radiusMm) / grid.geometry.spacing[ax]) ** 2 + 0.25;
      const ry2 = (Math.max(0, st.radiusMm) / grid.geometry.spacing[ay]) ** 2 + 0.25;
      const rx = Math.sqrt(rx2), ry = Math.sqrt(ry2);
      const pts = st.points.map((w) => worldToIndex(grid.geometry, w as Vec3)).filter((p) => p[axis] === slice).map((p) => [p[ax], p[ay]] as [number, number]);
      const out = st.kind === 'fg' ? fg : bg;
      for (const [cx, cy] of strokeDabs(pts, 1)) {
        for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
          if (x < 0 || y < 0 || x >= width || y >= height || (x - cx) ** 2 / rx2 + (y - cy) ** 2 / ry2 > 1) continue;
          out[x + y * width] = 1;
          x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
      }
    }
    for (let i = 0; i < fg.length; i++) if (fg[i] && bg[i]) bg[i] = 0; // a pixel seeded both ways counts as foreground
    recordSeedRaster([width, height, 1], [grid.geometry.spacing[ax], grid.geometry.spacing[ay], grid.geometry.spacing[axis]], Uint8Array.from(fg, (v, i) => (v ? 1 : bg[i] ? 2 : 0)));
    if (x1 < 0) { t.txn.discard(); return { ok: false, reason: 'no-seeds' }; }
    // The solve's window: the ROI limit if drawn here, otherwise the seeds' box plus padding.
    const roi = roiPlaneMask(s.roi, viewportId, grid.geometry, axis);
    if (roi) {
      x0 = width; y0 = height; x1 = -1; y1 = -1;
      for (let i = 0; i < roi.length; i++) if (roi[i]) {
        const x = i % width, y = (i - x) / width;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    } else {
      const pad = s.randomWalker.paddingPx;
      x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
    }
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    if (cw < 2 || ch < 2) { t.txn.discard(); return { ok: false, reason: 'no-seeds' }; }
    const full = extractValues(grid.geometry.dimensions, axis, slice, source);
    const crop = <T extends Float32Array | Uint8Array>(a: T, make: (n: number) => T): T => {
      const out = make(cw * ch);
      for (let y = 0; y < ch; y++) out.set(a.subarray(x0 + (y0 + y) * width, x0 + (y0 + y) * width + cw), y * cw);
      return out;
    };
    const member = t.member;
    t.txn.discard(); // nothing is held open while the solve runs
    const input = {
      width: cw, height: ch, beta: s.randomWalker.beta,
      image: crop(full, (n) => new Float32Array(n)),
      fg: crop(fg, (n) => new Uint8Array(n)),
      bg: crop(bg, (n) => new Uint8Array(n)),
    };
    // The solve runs in the compute worker; the preview bar's slot shows its progress and
    // Cancel (⎋) until it finishes.
    discardPreview();
    let jobId = 0;
    const job = computeClient.run('randomWalker', input, {
      onProgress: (f) => useComputeStore.getState().progress(f, jobId),
      transfer: [input.image.buffer, input.fg.buffer, input.bg.buffer],
    });
    jobId = useComputeStore.getState().start('Random Walker', viewportId);
    runningJob = job;
    const removeKeyLayer = hotkeyService.pushKeyLayer({
      onKeyDown: (e) => {
        if (e.key !== 'Escape' || e.ctrlKey || e.metaKey || e.altKey) return false;
        job.cancel();
        return true;
      },
    });
    let rw: Awaited<typeof job.result>;
    try {
      rw = await job.result;
    } catch (e) {
      if (e instanceof ComputeCancelled) return { ok: false, reason: 'cancelled' };
      console.warn('[semiAutoService] Random Walker failed:', e);
      return { ok: false, reason: 'failed' };
    } finally {
      removeKeyLayer();
      if (runningJob === job) {
        runningJob = null;
        useComputeStore.getState().end(jobId);
      }
    }
    const after = openTarget(member);
    if (!after) return { ok: false, reason: 'no-target' };
    const region = new Uint8Array(width * height);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (rw.mask[x + y * cw]) region[x0 + x + (y0 + y) * width] = 1;
    const added = addRegion(after, axis, slice, region, width, height);
    if (!added) { after.txn.discard(); return { ok: false, reason: 'no-change' }; }
    startPreview({ txn: after.txn, label: 'Random Walker', summary: `+${added.toLocaleString('en-US')} px`, viewportId, lockedMember: after.lockedMember });
    return { ok: true, added, readOnly: !!after.lockedMember };
  },

  /**
   * Read Level Trace's intensity guard from the ROI limit (SegWorks #57): the 2nd–98th
   * percentile of the image inside the rectangle, on the slice `viewportId` shows.
   */
  readGuardFromRoi(viewportId: string): { lo: number; hi: number } | null {
    const s = useSemiAutoStore.getState();
    if (s.roi?.viewportId !== viewportId) return null;
    const t = openTarget();
    if (!t) return null;
    const grid = t.txn.grid(t.member);
    t.txn.discard();
    const source = grid?.sourceReader?.() ?? null;
    const vp = viewportService.getViewport(viewportId) as { getCamera?: () => { focalPoint?: number[] } } | undefined;
    const focal = vp?.getCamera?.()?.focalPoint;
    const at = grid && focal ? planePoint(viewportId, grid.geometry, focal) : null;
    if (!grid || !source || !at) return null;
    const roi = roiPlaneMask(s.roi, viewportId, grid.geometry, at.axis);
    if (!roi) return null;
    const image = extractValues(grid.geometry.dimensions, at.axis, at.slice, source);
    const samples: number[] = [];
    for (let i = 0; i < roi.length; i++) if (roi[i]) samples.push(image[i]);
    const guard = guardFromSamples(samples);
    if (guard) s.setLevelTrace({ guard });
    return guard;
  },

  /** Which grid slice a world point is on, for the active member — the seed overlay's filter. */
  sliceOf(viewportId: string, world: number[]): { axis: Axis; slice: number } | null {
    const seg = useSegmentationStore.getState();
    const id = seg.activeSegmentationId;
    if (!id) return null;
    const t = openTarget();
    const grid = t?.txn.grid(t.member);
    t?.txn.discard();
    const at = grid ? planePoint(viewportId, grid.geometry, world) : null;
    return at ? { axis: at.axis, slice: at.slice } : null;
  },

  /** Every index of a plane, in grid order — exposed for the Random Walker run (C2). */
  sliceIndices,
};

let stroke: {
  t: Target;
  viewportId: string;
  axis: Axis;
  slice: number;
  image: Float32Array;
  size: { width: number; height: number };
  geometry: VoxelGridGeometry;
  /** mm per plane pixel along x and y. */
  mmPerPx: [number, number];
  started: boolean;
  /** The previous dab centre (plane pixels): the next move dabs all along from it. */
  last: [number, number] | null;
} | null = null;

/** What a failed Smart-tool action tells the user. */
export function describeSemiAuto(r: SemiAutoResult, tool: string): string | null {
  if (r.ok) return r.readOnly ? 'The segment is locked — preview only' : null;
  switch (r.reason) {
    case 'no-target': return 'Select a segment first';
    case 'no-viewport': return 'Open the segment’s scan in this viewport';
    case 'oblique-view': return OBLIQUE_VIEW_MESSAGE;
    case 'no-labelmap': case 'no-image': return `${tool} is unavailable for this scan`;
    case 'outside': return 'Click inside the image';
    case 'no-change': return 'Nothing to add here';
    case 'no-seeds': return 'Paint seeds of the segment and of the Background (⇧) on this slice first';
    case 'failed': return `${tool} failed — see the log`;
    default: return null;
  }
}

// The tool classes reach the service through the bridge (see semiAutoBridge).
Object.assign(semiAutoBridge, {
  clientToWorld: (id: string, x: number, y: number) => (getWorldPointFromClientPoint(id, x, y) as number[] | null) ?? null,
  levelTraceAt: (id: string, w: number[]) => {
    useSemiAutoStore.getState().setMessage(describeSemiAuto(semiAutoService.levelTraceAt(id, w), 'Level Trace'));
  },
  smartBrushBegin: semiAutoService.smartBrushBegin,
  smartBrushExtend: semiAutoService.smartBrushExtend,
  smartBrushEnd: semiAutoService.smartBrushEnd,
  setRoi: (viewportId: string, corners: number[][]) => useSemiAutoStore.getState().setRoi({ viewportId, corners }),
});

startSemiAutoOverlay();

// ─── Contour Fill: Spline and Live Wire boundaries (branch 6 F4, D3) ──────────
//
// Contour Fill's Spline and Live Wire modes draw with plain (non-segmentation) Cornerstone
// tools under their own names. When such an outline closes, it is rasterized into the
// active segment here — in the segment's own index space, on the viewing plane (so oblique
// series work), through the labelmap transaction (one undo step; a locked segment is
// refused with the usual warning) — and the outline is removed. Freehand mode keeps
// Cornerstone's LabelMapEditWithContour and its index-space fill (contourEditPrereq).

const CONTOUR_FILL_OUTLINE_TOOLS = new Set(['ContourFillSpline', 'ContourFillLivewire']);

export type ContourFillResult = { ok: true; added: number } | { ok: false; reason: 'no-target' | 'no-viewport' | 'locked' | 'not-planar' };

/** Fill the area a closed world-space outline encloses into the active segment. */
export function fillOutlineIntoActiveSegment(viewportId: string, outline: number[][]): ContourFillResult {
  const t = openTarget();
  if (!t) return { ok: false, reason: 'no-target' };
  if (t.lockedMember) {
    t.txn.discard();
    warnMemberLocked(t.lockedMember.containerId, t.lockedMember.segmentIndex, 'change it');
    return { ok: false, reason: 'locked' };
  }
  const grid = t.txn.grid(t.member);
  const vp = viewportService.getViewport(viewportId) as { getCamera?: () => { viewPlaneNormal?: number[] } } | undefined;
  const normal = vp?.getCamera?.()?.viewPlaneNormal;
  if (!grid || !normal || outline.length < 3) { t.txn.discard(); return { ok: false, reason: 'no-viewport' }; }
  const axis = sliceAxisFor(grid.geometry.direction, normal) as Axis;
  const [ax, ay] = planeAxes(axis);
  const ijk = outline.map((p) => worldToIndexFloat(grid.geometry, p as Vec3));
  const slices = ijk.map((p) => Math.round(p[axis]));
  const slice = slices[0];
  if (slices.some((s) => s !== slice)) { t.txn.discard(); return { ok: false, reason: 'not-planar' }; }
  const { width, height } = planeSize(grid.geometry.dimensions, axis);
  const region = rasterize(ijk.map((p) => [p[ax], p[ay]] as [number, number]), width, height);
  const current = t.txn.readPlane(t.member, axis, slice)!;
  const union = Uint8Array.from(region, (v, i) => (v || current.data[i] ? 1 : 0));
  const { added } = t.txn.applyPlane(t.member, axis, slice, { width, height, data: union });
  if (!added) { t.txn.discard(); return { ok: true, added: 0 }; }
  t.txn.commit();
  return { ok: true, added };
}

eventTarget.addEventListener(ToolEnums.Events.ANNOTATION_COMPLETED, ((evt: CustomEvent) => {
  const annotation = evt.detail?.annotation as { annotationUID?: string; metadata?: { toolName?: string }; data?: { contour?: { polyline?: number[][] } } } | undefined;
  if (!annotation || !CONTOUR_FILL_OUTLINE_TOOLS.has(annotation.metadata?.toolName ?? '')) return;
  const outline = annotation.data?.contour?.polyline ?? [];
  const viewportId = useViewerStore.getState().activeViewportId;
  const r = fillOutlineIntoActiveSegment(viewportId, outline);
  if (!r.ok && r.reason !== 'locked') console.warn('[semiAutoService] Contour Fill outline not filled:', r.reason);
  // The outline was only a way to draw the boundary: it goes once filled (or refused).
  if (annotation.annotationUID) csAnnotation.state.removeAnnotation(annotation.annotationUID);
  csToolsUtilities.triggerAnnotationRenderForViewportIds([viewportId]);
}) as EventListener);

// The ROI limit also confines the Spline tool's local editing and the ROI active spline (branch 6).
setContourRoiProvider(() => useSemiAutoStore.getState().roi);
