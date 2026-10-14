/**
 * Seeded segmentation (SegWorks parity branch 5, G2–G4; docs/segworks-parity.md §11): Fast
 * GrowCut, Graph Cut and α-expansion from painted seeds.
 *
 * Seeds (seedStore) are world strokes of a class — a member, or Background. The solve works on
 * a BOX of the active segment's voxel grid, laid out along the viewing plane (x, y in-plane,
 * z along the view), in index space (oblique series behave). The box is the seeds' extent
 * plus padding, the ROI limit, or the whole volume; its voxel count drives the memory guard.
 * The solve runs in the compute worker (progress, ⎋ / Cancel); its result is staged in a
 * LabelmapTransaction and previewed — written members only gain voxels, other members keep
 * theirs, a locked member previews read-only — and ⏎ commits it as one undo step.
 */
import { viewportService } from './viewportService';
import { beginTransaction, type MemberRef } from './labelmapTransaction';
import { sliceAxisFor } from './maskIslands';
import type { VoxelGridGeometry } from './segmentationService/voxelClipboard';
import { flatOf, toPlane, type Box } from './gridBox';
import { commitPreview, discardPreview, startPreview } from './maskPreview';
import { semiAutoBridge } from './tools/semiAutoBridge';
import { computeClient, ComputeCancelled } from '../compute/computeClient';
import { hotkeyService } from '../hotkeys/hotkeyService';
import { type Axis, planeAxes } from '../segmentation/maskOps/planeIO';
import { rasterizeSeeds, voxelCount, type Dims, type SeedStroke as BoxStroke, type Spacing } from '../segmentation/solvers/volume';
import { DEFAULT_MEMORY_LIMITS, estimateMemory, type MemoryEstimate, type MemoryLimits } from '../segmentation/solvers/memory';
import type { SeededSolveInput } from '../segmentation/solvers/seeded';
import { BACKGROUND, useSeedStore, type SeedStroke } from '../../stores/seedStore';
import { useComputeStore } from '../../stores/computeStore';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { useSemiAutoStore } from '../../stores/semiAutoStore';
import type { RegionSettings, SeededSettings } from '../../stores/operationSheetStore';
import { metaData } from '@cornerstonejs/core';
import { getSourceImageIds } from './sourceImageTracking';
import { ToolName } from '@shared/types/viewer';
import { useViewerStore } from '../../stores/viewerStore';

const METHOD_LABEL: Record<SeededSettings['method'], string> = {
  growCut: 'Fast GrowCut', graphCut: 'Graph Cut', alphaExpansion: 'Multi-label graph cut',
};

/** Memory limits — a test seam lowers them so the guard's states can be shown on small fixtures. */
let memoryLimits: MemoryLimits = DEFAULT_MEMORY_LIMITS;
export function setSolverMemoryLimits(l: MemoryLimits | null): void {
  memoryLimits = l ?? DEFAULT_MEMORY_LIMITS;
}

interface Active {
  containerId: string;
  active: number;
  members: Array<{ segmentIndex: number; locked: boolean }>;
}

function activeTarget(): Active | null {
  const seg = useSegmentationStore.getState();
  const summary = seg.segmentations.find((s) => s.segmentationId === seg.activeSegmentationId);
  if (!summary || !(seg.activeSegmentIndex > 0)) return null;
  return {
    containerId: summary.segmentationId,
    active: seg.activeSegmentIndex,
    members: summary.segments.map((m) => ({ segmentIndex: m.segmentIndex, locked: !!m.locked })),
  };
}

/** The member's grid (read only). */
function gridOf(member: MemberRef) {
  const begun = beginTransaction([member], undefined, { allowLocked: true });
  if (!begun.ok) return null;
  const grid = begun.txn.grid(member);
  begun.txn.discard();
  return grid;
}

function viewNormal(viewportId: string): number[] | null {
  const vp = viewportService.getViewport(viewportId) as { getCamera?: () => { viewPlaneNormal?: number[] } } | undefined;
  return vp?.getCamera?.()?.viewPlaneNormal ?? null;
}

function strokesOf(containerId: string): SeedStroke[] {
  return useSeedStore.getState().strokes.filter((s) => s.containerId === containerId && s.points.length);
}

export type SeededDomain =
  | { ok: true; box: Box; voxels: number; estimate: MemoryEstimate }
  | { ok: false; reason: 'no-target' | 'no-viewport' | 'no-seeds' | 'no-roi' };

/** The box the solve would run on, with its memory estimate (the sheet's estimate line). */
export function seededDomain(s: SeededSettings, viewportId: string): SeededDomain {
  const t = activeTarget();
  if (!t) return { ok: false, reason: 'no-target' };
  const grid = gridOf({ containerId: t.containerId, segmentIndex: t.active });
  const normal = viewNormal(viewportId);
  if (!grid || !normal) return { ok: false, reason: 'no-viewport' };
  const geometry = grid.geometry;
  const axis = sliceAxisFor(geometry.direction, normal) as Axis;
  const [ax, ay] = planeAxes(axis);
  const dimsG = geometry.dimensions;
  const size = [dimsG[ax], dimsG[ay], dimsG[axis]];
  let lo = [0, 0, 0], hi = [size[0] - 1, size[1] - 1, size[2] - 1];
  if (s.domain !== 'volume') {
    const strokes = strokesOf(t.containerId);
    if (!strokes.length) return { ok: false, reason: 'no-seeds' };
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const st of strokes) for (const w of st.points) {
      const [x, y, z] = toPlane(geometry, axis, w);
      x0 = Math.min(x0, x - st.radiusPx); x1 = Math.max(x1, x + st.radiusPx);
      y0 = Math.min(y0, y - st.radiusPx); y1 = Math.max(y1, y + st.radiusPx);
      z0 = Math.min(z0, Math.round(z)); z1 = Math.max(z1, Math.round(z));
    }
    lo = [Math.floor(x0) - s.padXY, Math.floor(y0) - s.padXY, z0 - s.padZ];
    hi = [Math.ceil(x1) + s.padXY, Math.ceil(y1) + s.padXY, z1 + s.padZ];
    if (s.domain === 'roi') {
      const roi = useSemiAutoStore.getState().roi;
      if (!roi || roi.viewportId !== viewportId) return { ok: false, reason: 'no-roi' };
      const pts = roi.corners.map((c) => toPlane(geometry, axis, c));
      lo = [Math.floor(Math.min(...pts.map((p) => p[0]))), Math.floor(Math.min(...pts.map((p) => p[1]))), lo[2]];
      hi = [Math.ceil(Math.max(...pts.map((p) => p[0]))), Math.ceil(Math.max(...pts.map((p) => p[1]))), hi[2]];
    }
  }
  for (let k = 0; k < 3; k++) { lo[k] = Math.max(0, lo[k]); hi[k] = Math.min(size[k] - 1, hi[k]); }
  const dims: Dims = [hi[0] - lo[0] + 1, hi[1] - lo[1] + 1, hi[2] - lo[2] + 1];
  if (dims.some((v) => v < 1)) return { ok: false, reason: 'no-seeds' };
  const voxels = voxelCount(dims);
  const classes = s.method === 'alphaExpansion' ? 1 + new Set(strokesOf(t.containerId).map((x) => x.cls).filter((c) => c !== BACKGROUND)).size : 2;
  return {
    ok: true,
    box: { geometry, axis, ax, ay, lo: lo as [number, number, number], dims, spacing: [geometry.spacing[ax], geometry.spacing[ay], geometry.spacing[axis]] },
    voxels,
    estimate: estimateMemory(s.method, voxels, classes, memoryLimits),
  };
}

export type SeededResult =
  | { ok: true; added: number; readOnly: boolean }
  | { ok: false; reason: 'no-target' | 'no-viewport' | 'no-seeds' | 'no-roi' | 'no-image' | 'too-large' | 'one-class' | 'no-change' | 'cancelled' | 'failed'; detail?: string };

let running: { cancel: () => void } | null = null;

export const solverService = {
  /** Run the chosen method on the domain; preview the result (⏎ commits), or commit at once. */
  async runSeeded(s: SeededSettings, viewportId: string, opts: { commit?: boolean } = {}): Promise<SeededResult> {
    const t = activeTarget();
    if (!t) return { ok: false, reason: 'no-target' };
    const dom = seededDomain(s, viewportId);
    if (!dom.ok) return { ok: false, reason: dom.reason };
    if (dom.estimate.level === 'block') return { ok: false, reason: 'too-large', detail: dom.estimate.reason ?? undefined };
    const { box } = dom;
    const grid = gridOf({ containerId: t.containerId, segmentIndex: t.active });
    const source = grid?.sourceReader?.() ?? null;
    if (!source) return { ok: false, reason: 'no-image' };

    // Classes: the binary methods solve the active member (class 0) against everything else;
    // α-expansion solves Background (class 0) and every seeded member.
    const strokes = strokesOf(t.containerId);
    const alpha = s.method === 'alphaExpansion';
    const memberClasses = alpha ? [...new Set(strokes.map((x) => x.cls).filter((c) => c !== BACKGROUND))].sort((a, b) => a - b) : [t.active];
    const classOf = (cls: number) => (alpha ? (cls === BACKGROUND ? 0 : 1 + memberClasses.indexOf(cls)) : cls === t.active ? 0 : 1);
    const classes = alpha ? 1 + memberClasses.length : 2;
    const boxStrokes: BoxStroke[] = strokes.map((st) => {
      const pts = st.points.map((w) => toPlane(box.geometry, box.axis, w));
      return {
        cls: classOf(st.cls) + 1,
        z: Math.round(pts[0][2]) - box.lo[2],
        points: pts.filter((p) => Math.round(p[2]) === Math.round(pts[0][2])).map((p) => [p[0] - box.lo[0], p[1] - box.lo[1]] as [number, number]),
        rx: st.radiusPx,
        ry: st.radiusPx,
      };
    });
    const seeds = rasterizeSeeds(box.dims, boxStrokes);
    const present = new Set(seeds);
    present.delete(0);
    if (present.size < 2) return { ok: false, reason: alpha ? 'one-class' : 'no-seeds' };
    const image = new Float32Array(voxelCount(box.dims));
    for (let z = 0, i = 0; z < box.dims[2]; z++) for (let y = 0; y < box.dims[1]; y++) for (let x = 0; x < box.dims[0]; x++, i++) image[i] = source(flatOf(box, x, y, z));

    const input: SeededSolveInput = {
      method: s.method, image, dims: box.dims, spacing: box.spacing, seeds, classes,
      gate: s.method === 'growCut' && s.gateOn ? { lo: s.gateLo, hi: s.gateHi } : null,
      graphCut: { lambda: s.lambda, sigma: s.sigma },
      alpha: { smooth: s.smooth, sigma: s.alphaSigma, sweeps: s.sweeps, uInt: s.uInt, uLoc: s.uLoc, locality: s.locality, intensity: s.intensity, seedBias: s.seedBias },
      post: { enabled: s.postOn, keep: s.postKeep, minIsland: s.postMinIsland, smoothPasses: s.postSmooth, shrinkGrowPasses: s.postShrinkGrow },
      backgroundClass: alpha ? 0 : undefined,
    };
    discardPreview();
    useSeedStore.getState().snapshotForRun();
    const job = computeClient.run('seededSolve', input, {
      onProgress: (f) => useComputeStore.getState().progress(f),
      transfer: [image.buffer, seeds.buffer],
    });
    useComputeStore.getState().start(METHOD_LABEL[s.method], viewportId);
    running = job;
    const removeKeys = hotkeyService.pushKeyLayer({
      onKeyDown: (e) => {
        if (e.key !== 'Escape' || e.ctrlKey || e.metaKey || e.altKey) return false;
        job.cancel();
        return true;
      },
    });
    let out: Awaited<typeof job.result>;
    try {
      out = await job.result;
    } catch (e) {
      if (e instanceof ComputeCancelled) return { ok: false, reason: 'cancelled' };
      console.warn('[solverService] seeded solve failed:', e);
      return { ok: false, reason: 'failed' };
    } finally {
      removeKeys();
      if (running === job) { running = null; useComputeStore.getState().end(); }
    }
    if (!out) return { ok: false, reason: alpha ? 'one-class' : 'no-seeds' };

    // Stage the result: written members gain voxels; other members keep theirs. Under
    // α-expansion a locked member is simply not written (its seeds still shaped the solve);
    // with one target, a locked one previews read-only.
    const locked = new Set(t.members.filter((m) => m.locked).map((m) => m.segmentIndex));
    let writeIndices = memberClasses;
    if (alpha && memberClasses.some((i) => !locked.has(i))) writeIndices = memberClasses.filter((i) => !locked.has(i));
    const skipped = memberClasses.filter((i) => !writeIndices.includes(i));
    const writers: MemberRef[] = writeIndices.map((segmentIndex) => ({ containerId: t.containerId, segmentIndex }));
    let lockedMember: MemberRef | null = null;
    let begun = beginTransaction(writers);
    if (!begun.ok && begun.reason === 'locked') {
      lockedMember = begun.member;
      begun = beginTransaction(writers, undefined, { allowLocked: true });
    }
    if (!begun.ok) return { ok: false, reason: 'no-target' };
    const { txn } = begun;
    const everyone: MemberRef[] = t.members.map((m) => ({ containerId: t.containerId, segmentIndex: m.segmentIndex }));
    const writerOf = new Map(writers.map((w) => [w.segmentIndex, w]));
    const memberOfLabel = (l: number): MemberRef | null => {
      const segmentIndex = alpha ? memberClasses[l - 1] : l === 1 ? t.active : undefined;
      return segmentIndex === undefined ? null : writerOf.get(segmentIndex) ?? null;
    };
    let added = 0;
    for (let z = 0, i = 0; z < box.dims[2]; z++) for (let y = 0; y < box.dims[1]; y++) for (let x = 0; x < box.dims[0]; x++, i++) {
      const target = memberOfLabel(out.labels[i]);
      if (!target) continue;
      const flat = flatOf(box, x, y, z);
      if (txn.has(target, flat)) continue;
      if (everyone.some((m) => m.segmentIndex !== target.segmentIndex && txn.has(m, flat))) continue; // others keep theirs
      txn.set(target, flat, true);
      added++;
    }
    if (!added) { txn.discard(); return { ok: false, reason: 'no-change' }; }
    const names = (ix: number[]) => ix.map((i) => useSegmentationStore.getState().segmentations.find((c) => c.segmentationId === t.containerId)?.segments.find((m) => m.segmentIndex === i)?.label ?? `Segment ${i}`);
    startPreview({
      txn, label: METHOD_LABEL[s.method], viewportId, lockedMember,
      summary: `+${added.toLocaleString('en-US')} voxels${skipped.length ? ` · ${names(skipped).join(', ')} locked — not written` : ''}`,
    });
    if (opts.commit && !lockedMember) commitPreview();
    return { ok: true, added, readOnly: !!lockedMember };
  },

  cancel(): void {
    running?.cancel();
  },

};

// ─── Region competition (SegWorks' "Chan-Vese", G5) ───────────────────────────

export type RegionResult =
  | { ok: true; added: number; removed: number; readOnly: boolean }
  | { ok: false; reason: 'no-target' | 'no-viewport' | 'no-roi' | 'no-image' | 'too-large' | 'one-class' | 'no-change' | 'cancelled' | 'failed'; detail?: string };

function isCt(containerId: string): boolean {
  const img = getSourceImageIds(containerId)?.[0];
  const m = img ? (metaData.get('generalSeriesModule', img) as { modality?: string } | undefined)?.modality : undefined;
  return !m || m.toUpperCase() === 'CT';
}

/**
 * The box region competition runs on: in-plane the ROI limit (required — as in SegWorks: the
 * model assumes each label, Background included, is roughly one intensity, which a whole
 * slice of air, tissue and bone is not), through the slice on screen, ± Z pad, the selected
 * members' extent ± 10 / ± 20 slices, or the volume.
 */
export function regionDomain(r: RegionSettings, viewportId: string):
  | { ok: true; box: Box; voxels: number; estimate: MemoryEstimate; labels: number[] }
  | { ok: false; reason: 'no-target' | 'no-viewport' | 'no-roi' } {
  const t = activeTarget();
  if (!t) return { ok: false, reason: 'no-target' };
  const grid = gridOf({ containerId: t.containerId, segmentIndex: t.active });
  const vp = viewportService.getViewport(viewportId) as { getCamera?: () => { viewPlaneNormal?: number[]; focalPoint?: number[] } } | undefined;
  const cam = vp?.getCamera?.();
  if (!grid || !cam?.viewPlaneNormal || !cam.focalPoint) return { ok: false, reason: 'no-viewport' };
  const geometry = grid.geometry;
  const axis = sliceAxisFor(geometry.direction, cam.viewPlaneNormal) as Axis;
  const [ax, ay] = planeAxes(axis);
  const size = [geometry.dimensions[ax], geometry.dimensions[ay], geometry.dimensions[axis]];
  const cur = Math.round(toPlane(geometry, axis, cam.focalPoint)[2]);
  const labels = (r.labels ?? [t.active]).filter((i) => t.members.some((m) => m.segmentIndex === i));
  let lo = [0, 0, 0], hi = [size[0] - 1, size[1] - 1, size[2] - 1];
  if (r.mode === 'slice') { lo[2] = hi[2] = cur; }
  else if (r.mode === 'bounded') { lo[2] = cur - r.zPad; hi[2] = cur + r.zPad; }
  else if (r.mode === 'extent10' || r.mode === 'extent20') {
    // The selected members' slice extent.
    const begun = beginTransaction(labels.map((segmentIndex) => ({ containerId: t.containerId, segmentIndex })), undefined, { allowLocked: true });
    let z0 = Infinity, z1 = -Infinity;
    if (begun.ok) {
      for (let k = 0; k < size[2]; k++) {
        for (const segmentIndex of labels) {
          const plane = begun.txn.readPlane({ containerId: t.containerId, segmentIndex }, axis, k);
          if (plane?.data.some((v) => v)) { z0 = Math.min(z0, k); z1 = Math.max(z1, k); }
        }
      }
      begun.txn.discard();
    }
    const pad = r.mode === 'extent10' ? 10 : 20;
    if (z0 > z1) { z0 = z1 = cur; }
    lo[2] = z0 - pad; hi[2] = z1 + pad;
  }
  const roi = useSemiAutoStore.getState().roi;
  if (!roi || roi.viewportId !== viewportId) return { ok: false, reason: 'no-roi' };
  {
    const pts = roi.corners.map((c) => toPlane(geometry, axis, c));
    lo = [Math.floor(Math.min(...pts.map((p) => p[0]))), Math.floor(Math.min(...pts.map((p) => p[1]))), lo[2]];
    hi = [Math.ceil(Math.max(...pts.map((p) => p[0]))), Math.ceil(Math.max(...pts.map((p) => p[1]))), hi[2]];
  }
  for (let k = 0; k < 3; k++) { lo[k] = Math.max(0, lo[k]); hi[k] = Math.min(size[k] - 1, hi[k]); }
  const dims: Dims = [hi[0] - lo[0] + 1, hi[1] - lo[1] + 1, hi[2] - lo[2] + 1];
  const voxels = voxelCount(dims);
  return {
    ok: true,
    box: { geometry, axis, ax, ay, lo: lo as [number, number, number], dims, spacing: [geometry.spacing[ax], geometry.spacing[ay], geometry.spacing[axis]] },
    voxels,
    estimate: estimateMemory('regionCompetition', voxels, 2, memoryLimits),
    labels,
  };
}

export async function runRegionCompetition(r: RegionSettings, viewportId: string, opts: { commit?: boolean } = {}): Promise<RegionResult> {
  const t = activeTarget();
  if (!t) return { ok: false, reason: 'no-target' };
  const dom = regionDomain(r, viewportId);
  if (!dom.ok) return { ok: false, reason: dom.reason };
  if (dom.estimate.level === 'block') return { ok: false, reason: 'too-large', detail: dom.estimate.reason ?? undefined };
  const { box } = dom;
  const lockedSet = new Set(t.members.filter((m) => m.locked).map((m) => m.segmentIndex));
  // Labels that may change: the selected, unlocked members, and Background if included.
  const movableMembers = dom.labels.filter((i) => !lockedSet.has(i));
  const movable = [...movableMembers, ...(r.includeBackground ? [BACKGROUND] : [])];
  if (movable.length < 2) return { ok: false, reason: 'one-class' };
  const everyone: MemberRef[] = t.members.map((m) => ({ containerId: t.containerId, segmentIndex: m.segmentIndex }));
  const read = beginTransaction(everyone, undefined, { allowLocked: true });
  if (!read.ok) return { ok: false, reason: 'no-target' };
  const source = read.txn.grid(everyone.find((m) => m.segmentIndex === t.active)!)?.sourceReader?.() ?? null;
  if (!source) { read.txn.discard(); return { ok: false, reason: 'no-image' }; }
  const n = voxelCount(box.dims);
  const image = new Float32Array(n);
  const initial = new Uint8Array(n);
  for (let z = 0, i = 0; z < box.dims[2]; z++) for (let y = 0; y < box.dims[1]; y++) for (let x = 0; x < box.dims[0]; x++, i++) {
    const flat = flatOf(box, x, y, z);
    image[i] = source(flat);
    for (const m of everyone) if (read.txn.has(m, flat)) { initial[i] = m.segmentIndex; break; }
  }
  read.txn.discard();
  const job = computeClient.run('regionCompetition', {
    image, dims: box.dims, spacing: box.spacing, initial: initial.slice(), movable,
    options: {
      iterations: r.iterations, smoothXY: r.smoothXY, dataWeight: r.dataWeight, stay: r.stay, edgeWeight: r.edgeWeight,
      edgeGate: r.edgeGate, cleanup: r.cleanup, smoothZ: r.smoothZ, zCoupling: r.zCoupling,
      clip: r.clipOn && isCt(t.containerId) ? { lo: r.clipLo, hi: r.clipHi } : null,
    },
  }, { onProgress: (f) => useComputeStore.getState().progress(f), transfer: [image.buffer] });
  discardPreview();
  useComputeStore.getState().start(REGION_LABEL, viewportId);
  running = job;
  const removeKeys = hotkeyService.pushKeyLayer({
    onKeyDown: (e) => {
      if (e.key !== 'Escape' || e.ctrlKey || e.metaKey || e.altKey) return false;
      job.cancel();
      return true;
    },
  });
  let out: Uint8Array;
  try {
    out = await job.result;
  } catch (e) {
    if (e instanceof ComputeCancelled) return { ok: false, reason: 'cancelled' };
    console.warn('[solverService] region competition failed:', e);
    return { ok: false, reason: 'failed' };
  } finally {
    removeKeys();
    if (running === job) { running = null; useComputeStore.getState().end(); }
  }
  const writers: MemberRef[] = movableMembers.map((segmentIndex) => ({ containerId: t.containerId, segmentIndex }));
  const begun = beginTransaction(writers);
  if (!begun.ok) return { ok: false, reason: 'no-target' };
  const { txn } = begun;
  const writerOf = new Map(writers.map((w) => [w.segmentIndex, w]));
  let added = 0, removed = 0;
  for (let z = 0, i = 0; z < box.dims[2]; z++) for (let y = 0; y < box.dims[1]; y++) for (let x = 0; x < box.dims[0]; x++, i++) {
    if (out[i] === initial[i]) continue;
    const flat = flatOf(box, x, y, z);
    const from = writerOf.get(initial[i]);
    const to = writerOf.get(out[i]);
    if (from) { txn.set(from, flat, false); removed++; }
    if (to) { txn.set(to, flat, true); added++; }
  }
  if (!added && !removed) { txn.discard(); return { ok: false, reason: 'no-change' }; }
  startPreview({ txn, label: REGION_LABEL, summary: `+${added.toLocaleString('en-US')} −${removed.toLocaleString('en-US')} voxels`, viewportId });
  if (opts.commit) commitPreview();
  return { ok: true, added, removed, readOnly: false };
}

export const REGION_LABEL = 'Region competition';

/** What a region competition run tells the user. */
export function describeRegion(r: RegionResult): string | null {
  if (r.ok) return null;
  switch (r.reason) {
    case 'one-class': return 'Select a segment and include Background — or two segments — to compete';
    case 'no-change': return 'Nothing moved — the boundaries already fit';
    case 'no-roi': return 'Draw an ROI limit round the structure on this viewport (Segmentation tools › ROI limit)';
    default: return describeSeeded(r as SeededResult);
  }
}

/** What a seeded run tells the user, in the operation's status line. */
export function describeSeeded(r: SeededResult): string | null {
  if (r.ok) return r.readOnly ? 'The segment is locked — preview only' : null;
  switch (r.reason) {
    case 'no-target': return 'Select a segment first';
    case 'no-viewport': return 'Open the segment’s scan in this viewport';
    case 'no-seeds': return 'Paint seeds of the segment and of the Background (⇧) first';
    case 'one-class': return 'Seed at least two classes (segments or Background)';
    case 'no-roi': return 'Draw an ROI limit on this viewport, or pick another domain';
    case 'no-image': return 'The image under the segment is not available';
    case 'too-large': return r.detail ?? 'Too large to solve — narrow the domain';
    case 'no-change': return 'Nothing to add — the result is already in the segment';
    case 'failed': return 'The solve failed — see the log';
    default: return null;
  }
}

// ─── The seed painter (the operation's pointer mode) ─────────────────────────

let erasing: { viewportId: string; geometry: VoxelGridGeometry; axis: Axis; radius: number } | null = null;

/** Remove seed points under the eraser (same slice, within the brush). */
function eraseAt(w: number[]): void {
  const e = erasing;
  if (!e) return;
  const t = activeTarget();
  if (!t) return;
  const [ex, ey, ez] = toPlane(e.geometry, e.axis, w);
  const store = useSeedStore.getState();
  let changed = false;
  const next = store.strokes.map((st) => {
    if (st.containerId !== t.containerId) return st;
    const kept = st.points.filter((p) => {
      const [x, y, z] = toPlane(e.geometry, e.axis, p);
      const hit = Math.round(z) === Math.round(ez) && Math.hypot(x - ex, y - ey) <= e.radius + st.radiusPx;
      if (hit) changed = true;
      return !hit;
    });
    return kept.length === st.points.length ? st : { ...st, points: kept };
  }).filter((st) => st.points.length);
  if (changed) store.setStrokes(next);
}

Object.assign(semiAutoBridge, {
  solverSeedBegin: (viewportId: string, world: number[], background: boolean) => {
    const t = activeTarget();
    if (!t) return;
    const store = useSeedStore.getState();
    if (store.paintClass === 'erase' && !background) {
      const grid = gridOf({ containerId: t.containerId, segmentIndex: t.active });
      const normal = viewNormal(viewportId);
      if (!grid || !normal) return;
      erasing = { viewportId, geometry: grid.geometry, axis: sliceAxisFor(grid.geometry.direction, normal) as Axis, radius: store.brushPx };
      eraseAt(world);
      return;
    }
    erasing = null;
    const cls = background ? BACKGROUND : typeof store.paintClass === 'number' ? store.paintClass : t.active;
    store.addStroke({ containerId: t.containerId, viewportId, cls, radiusPx: store.brushPx, points: [world] });
  },
  solverSeedExtend: (world: number[]) => {
    if (erasing) eraseAt(world);
    else useSeedStore.getState().extendStroke(world);
  },
});

/** The seed painter is a pointer mode: the active tool. */
export function isPaintingSeeds(): boolean {
  return useViewerStore.getState().activeTool === ToolName.SolverSeeds;
}
