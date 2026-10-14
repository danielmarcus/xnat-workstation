/**
 * Run a cleanup operation on the active segmentation and open its preview
 * (SegWorks parity branch 1; the Cleanup sheet's backend).
 *
 * Target: the panel's active container and member — never a separate picker (sheet
 * rules, wireframes §5). Slices are taken along the axis the viewport is looking down,
 * and "this slice" is the one on screen. Nothing is written here: the result is staged
 * and handed to maskPreview, which commits it (one undo step) or discards it.
 */
import { viewportService } from './viewportService';
import { readSegmentVoxelGrid } from './segmentVoxelGrid';
import { beginTransaction, type MemberRef } from './labelmapTransaction';

/**
 * With several segments targeted (Labels = All), a locked one is left out — protected like any
 * segment the operation does not target. Before, one locked segment made the whole operation a
 * read-only preview (with a message naming another segment). One locked target alone still
 * previews read-only.
 */
function withoutLockedWhenSeveral(indices: number[], segments: Array<{ segmentIndex: number; locked: boolean }>): number[] {
  if (indices.length < 2) return indices;
  const unlocked = indices.filter((i) => !segments.find((m) => m.segmentIndex === i)?.locked);
  return unlocked.length ? unlocked : indices;
}
import { sliceAxisFor, viewAlignedWithGrid } from './maskIslands';
import { worldToIndex, type Vec3 } from './segmentationService/voxelClipboard';
import { commitPreview, startPreview } from './maskPreview';
import { sliceNumbering } from './sliceNumbering';
import { cleanupOp, defaultParams, type ParamValues } from '../segmentation/maskOps/catalog';
import { INTERPOLATORS, findGaps, type InterpolationMethod } from '../segmentation/interpolation/interpolate';
import type { DistanceMethod } from '../segmentation/interpolation/distance';
import { intensityReference, propagateStep, zSmooth, type PropagateOptions } from '../segmentation/interpolation/propagate';
import { metaData } from '@cornerstonejs/core';
import { getSourceImageIds } from './sourceImageTracking';
import { roiPlaneMask } from './semiAutoService';
import { useSemiAutoStore } from '../../stores/semiAutoStore';
import { planSmartCleanup, sampleSlices, smallThresholdFor, thinScore, DEFAULT_PLAN_OPTIONS, type PlanEntry } from '../segmentation/maskOps/smartPlan';
import { type Axis, extractValues, sliceCount, sliceIndices } from '../segmentation/maskOps/planeIO';
import { type LabelScope, resolveLabels, resolveSlices, runPairOp, runPlaneOp } from '../segmentation/maskOps/scope';

/**
 * Where an operation runs. A range is given in the viewport's DISPLAYED numbering (0-based
 * index of the "8 / 16" the overlay shows) — what the user sees and types — and is
 * converted to grid slices here.
 */
export interface ServiceScope {
  slices: { kind: 'current' } | { kind: 'volume' } | { kind: 'range'; from: number; to: number };
  labels: LabelScope;
}
import { useSegmentationStore } from '../../stores/segmentationStore';
import { useViewerStore } from '../../stores/viewerStore';

export type RunResult =
  | { ok: true; added: number; removed: number; slices: number[]; readOnly: boolean; committed: boolean }
  | { ok: false; reason: 'no-target' | 'no-viewport' | 'oblique-view' | 'locked' | 'no-labelmap' | 'unknown-op' | 'no-change' | 'no-seed' | 'no-image'; member?: MemberRef };

/** The viewing axis and on-screen slice of a viewport, in a grid's index space. */
/** Whether the viewport shows planes of this grid — "the slice on screen" is then a grid slice. */
function viewAligned(viewportId: string, geometry: { direction: number[] }): boolean {
  const n = (viewportService.getViewport(viewportId) as { getCamera?: () => { viewPlaneNormal?: number[] } } | undefined)?.getCamera?.()?.viewPlaneNormal;
  return !n || viewAlignedWithGrid(geometry.direction, n);
}

export function viewportSlice(viewportId: string, geometry: { direction: number[]; dimensions: ArrayLike<number> } & Parameters<typeof worldToIndex>[0]): { axis: Axis; slice: number } | null {
  const vp = viewportService.getViewport(viewportId) as { getCamera?: () => { focalPoint?: number[]; viewPlaneNormal?: number[] } } | undefined;
  const cam = vp?.getCamera?.();
  if (!cam?.focalPoint || !cam.viewPlaneNormal) return null;
  const axis = sliceAxisFor(geometry.direction, cam.viewPlaneNormal) as Axis;
  return { axis, slice: worldToIndex(geometry, cam.focalPoint as Vec3)[axis] };
}

function fmtCount(n: number): string {
  return n.toLocaleString('en-US');
}

/** `slices` are DISPLAYED indices (0-based) — the numbers the viewport overlay shows. */
function summarize(added: number, removed: number, slices: number[]): string {
  const sorted = [...slices].sort((a, b) => a - b);
  const where = sorted.length === 0 ? 'no slices'
    : sorted.length === 1 ? `slice ${sorted[0] + 1}`
    : `${sorted.length} slices (${sorted[0] + 1}–${sorted[sorted.length - 1] + 1})`;
  const parts = [where];
  if (added) parts.push(`+${fmtCount(added)} px`);
  if (removed) parts.push(`−${fmtCount(removed)} px`);
  return parts.join(' · ');
}

export const maskOpsService = {
  /**
   * Stage `opId` over `scope` on the active container and show it as a preview on
   * `viewportId` (default: the active viewport). `onDone` fires when the preview ends.
   */
  previewCleanup(
    opId: string,
    params: ParamValues,
    scope: ServiceScope,
    opts: {
      viewportId?: string;
      onDone?: (committed: boolean) => void;
      commit?: boolean;
      targetSegmentIndex?: number;
      /** Smart Cleanup: the reviewed action per segment index ('skip' or an op id). */
      plan?: Record<number, string>;
      /** Parameters for plan actions other than `opId` (defaults otherwise). */
      planParams?: Record<string, ParamValues>;
    } = {},
  ): RunResult {
    const op = cleanupOp(opId);
    if (!op) return { ok: false, reason: 'unknown-op' };
    if (op.runPair) return maskOpsService.previewPair(opId, params, scope, opts);
    const seg = useSegmentationStore.getState();
    const containerId = seg.activeSegmentationId;
    const active = seg.activeSegmentIndex;
    const summary = seg.segmentations.find((s) => s.segmentationId === containerId);
    if (!containerId || !summary || !(active > 0)) return { ok: false, reason: 'no-target' };
    const viewportId = opts.viewportId ?? useViewerStore.getState().activeViewportId;
    if (!viewportId) return { ok: false, reason: 'no-viewport' };

    const allIndices = summary.segments.map((s) => s.segmentIndex);
    const allMembers: MemberRef[] = allIndices.map((segmentIndex) => ({ containerId, segmentIndex }));
    const plan = opts.plan;
    const members: MemberRef[] = withoutLockedWhenSeveral(resolveLabels(scope.labels, active, allIndices)
      .filter((i) => !plan || (plan[i] && plan[i] !== 'skip')), summary.segments)
      .map((segmentIndex) => ({ containerId, segmentIndex }));
    if (members.length === 0) return { ok: false, reason: 'no-target' };
    const isMember = (i: number) => members.some((m) => m.segmentIndex === i);
    const lockedOthers: MemberRef[] = summary.segments
      .filter((m) => m.locked && !isMember(m.segmentIndex))
      .map((m) => ({ containerId, segmentIndex: m.segmentIndex }));
    // An operation that claims neighbours' pixels (Snake refine, #201) writes the unlocked ones too.
    const claims = !plan && !!op.claims?.(params);
    const writers = claims
      ? [...members, ...allMembers.filter((m) => !isMember(m.segmentIndex) && !lockedOthers.some((l) => l.segmentIndex === m.segmentIndex))]
      : members;

    // A locked target can still be previewed (read-only); it can never be committed.
    let lockedMember: MemberRef | null = null;
    let begun = beginTransaction(writers);
    if (!begun.ok && begun.reason === 'locked') {
      lockedMember = begun.member;
      begun = beginTransaction(writers, undefined, { allowLocked: true });
    }
    if (!begun.ok) return { ok: false, reason: begun.reason, member: begun.member };
    const { txn } = begun;
    const grid = txn.grid(members[0]);
    if (grid && scope.slices.kind !== 'volume' && !viewAligned(viewportId, grid.geometry)) { txn.discard(); return { ok: false, reason: 'oblique-view' }; }
    const where = grid ? viewportSlice(viewportId, grid.geometry) : null;
    if (!grid || !where) {
      txn.discard();
      return { ok: false, reason: 'no-viewport' };
    }
    const numbering = sliceNumbering(viewportId, grid.geometry, where.axis);
    const gridScope = scope.slices.kind === 'range' && numbering
      ? { kind: 'range' as const, from: numbering.toGrid(scope.slices.from), to: numbering.toGrid(scope.slices.to) }
      : scope.slices;
    const slices = resolveSlices(gridScope, sliceCount(grid.geometry.dimensions, where.axis), where.slice);

    // Per-segment actions (Smart Cleanup) or the one op for every member.
    const actionOf = (segmentIndex: number) => {
      const id = plan?.[segmentIndex] ?? opId;
      const o = cleanupOp(id);
      return o?.run ? { o, p: id === opId ? params : { ...defaultParams(o), ...opts.planParams?.[id] } } : null;
    };
    const needsImage = members.some((m) => actionOf(m.segmentIndex)?.o.usesImage);
    const source = needsImage ? grid.sourceReader?.() ?? null : null;
    if (needsImage && !source) console.warn('[maskOpsService] source image unavailable; running', opId, 'without image guidance');
    const result = runPlaneOp({
      txn,
      members,
      allMembers,
      lockedMembers: lockedOthers,
      axis: where.axis,
      slices,
      op: (plane, ctx) => {
        const a = actionOf(ctx.member.segmentIndex);
        return a ? a.o.run!(plane, ctx, a.p) : plane;
      },
      readImage: source ? (s) => extractValues(grid.geometry.dimensions, where.axis, s, source) : undefined,
      roi: roiPlaneMask(useSemiAutoStore.getState().roi, viewportId, grid.geometry, where.axis),
    });
    if (result.added + result.removed === 0) {
      txn.discard();
      return { ok: false, reason: 'no-change' };
    }
    const shown = result.changedSlices.map((k) => numbering?.toDisplay(k) ?? k);
    startPreview({
      txn,
      label: plan ? `Smart cleanup · ${op.label}` : op.label,
      summary: summarize(result.added, result.removed, shown),
      viewportId,
      onDone: opts.onDone,
      lockedMember,
    });
    const committed = !!opts.commit && !lockedMember && commitPreview();
    return { ok: true, added: result.added, removed: result.removed, slices: result.changedSlices, readOnly: !!lockedMember, committed };
  },

  /**
   * A two-segment operation: the active member is the source, `opts.targetSegmentIndex`
   * the target (sheet rule: the one extra "Into" selector). Members that change are the
   * target, the source (when the op empties it) and — for operations that claim pixels —
   * every unlocked other member. A locked target or source previews read-only; locked
   * others are simply never touched.
   */
  previewPair(
    opId: string,
    params: ParamValues,
    scope: ServiceScope,
    opts: { viewportId?: string; onDone?: (committed: boolean) => void; commit?: boolean; targetSegmentIndex?: number } = {},
  ): RunResult {
    const op = cleanupOp(opId);
    if (!op?.runPair) return { ok: false, reason: 'unknown-op' };
    const seg = useSegmentationStore.getState();
    const containerId = seg.activeSegmentationId;
    const active = seg.activeSegmentIndex;
    const summary = seg.segmentations.find((s) => s.segmentationId === containerId);
    const targetIndex = opts.targetSegmentIndex;
    if (!containerId || !summary || !(active > 0) || !targetIndex || targetIndex === active) return { ok: false, reason: 'no-target' };
    if (!summary.segments.some((m) => m.segmentIndex === targetIndex)) return { ok: false, reason: 'no-target' };
    const viewportId = opts.viewportId ?? useViewerStore.getState().activeViewportId;
    if (!viewportId) return { ok: false, reason: 'no-viewport' };

    const source: MemberRef = { containerId, segmentIndex: active };
    const target: MemberRef = { containerId, segmentIndex: targetIndex };
    const allMembers: MemberRef[] = summary.segments.map((m) => ({ containerId, segmentIndex: m.segmentIndex }));
    const lockedOthers = summary.segments
      .filter((m) => m.locked && m.segmentIndex !== active && m.segmentIndex !== targetIndex)
      .map((m) => ({ containerId, segmentIndex: m.segmentIndex }));
    const lockedSet = new Set(lockedOthers.map((m) => m.segmentIndex));
    // A source the operation only reads (Copy into, Magnet bridge) is not opened for writing — a
    // locked source refused them, though they never change it.
    const sourceLocked = summary.segments.find((m) => m.segmentIndex === active)?.locked ?? false;
    if (sourceLocked && !op.writesSource) lockedSet.add(active);
    const writers = allMembers.filter((m) => !lockedSet.has(m.segmentIndex));

    let lockedMember: MemberRef | null = null;
    let begun = beginTransaction(writers);
    if (!begun.ok && begun.reason === 'locked') {
      lockedMember = begun.member;
      begun = beginTransaction(writers, undefined, { allowLocked: true });
    }
    if (!begun.ok) return { ok: false, reason: begun.reason, member: begun.member };
    const { txn } = begun;
    const grid = txn.grid(target);
    if (grid && scope.slices.kind !== 'volume' && !viewAligned(viewportId, grid.geometry)) { txn.discard(); return { ok: false, reason: 'oblique-view' }; }
    const where = grid ? viewportSlice(viewportId, grid.geometry) : null;
    if (!grid || !where) {
      txn.discard();
      return { ok: false, reason: 'no-viewport' };
    }
    const numbering = sliceNumbering(viewportId, grid.geometry, where.axis);
    const gridScope = scope.slices.kind === 'range' && numbering
      ? { kind: 'range' as const, from: numbering.toGrid(scope.slices.from), to: numbering.toGrid(scope.slices.to) }
      : scope.slices;
    const slices = resolveSlices(gridScope, sliceCount(grid.geometry.dimensions, where.axis), where.slice);
    const result = runPairOp({
      txn, source, target, allMembers, lockedMembers: lockedOthers, axis: where.axis, slices,
      op: (src, dst, ctx) => op.runPair!(src, dst, ctx, params),
    });
    if (result.added + result.removed === 0) {
      txn.discard();
      return { ok: false, reason: 'no-change' };
    }
    const into = summary.segments.find((m) => m.segmentIndex === targetIndex)?.label ?? `Segment ${targetIndex}`;
    startPreview({
      txn,
      label: `${op.label.replace('…', '')} ${into}`,
      summary: summarize(result.added, result.removed, result.changedSlices.map((k) => numbering?.toDisplay(k) ?? k)),
      viewportId,
      onDone: opts.onDone,
      lockedMember,
    });
    const committed = !!opts.commit && !lockedMember && commitPreview();
    return { ok: true, added: result.added, removed: result.removed, slices: result.changedSlices, readOnly: !!lockedMember, committed };
  },

  /**
   * Smart Cleanup proposal: every segment of the active container, its voxels in the
   * scope and its thinness, with the action the planner suggests for `opId`.
   */
  smartPlan(opId: string, scope: ServiceScope, safeAction: string, viewportId?: string): PlanEntry[] | null {
    const seg = useSegmentationStore.getState();
    const containerId = seg.activeSegmentationId;
    const summary = seg.segmentations.find((s) => s.segmentationId === containerId);
    const vpId = viewportId ?? useViewerStore.getState().activeViewportId;
    if (!containerId || !summary || !vpId) return null;
    const members = summary.segments.map((m) => ({ ref: { containerId, segmentIndex: m.segmentIndex }, name: m.label }));
    const begun = beginTransaction([], undefined); // read-only: nothing opened for writing
    if (!begun.ok) return null;
    const { txn } = begun;
    const first = members.map((m) => txn.grid(m.ref)).find((g) => g);
    const where = first ? viewportSlice(vpId, first.geometry) : null;
    if (!first || !where) return null;
    const numbering = sliceNumbering(vpId, first.geometry, where.axis);
    const gridScope = scope.slices.kind === 'range' && numbering
      ? { kind: 'range' as const, from: numbering.toGrid(scope.slices.from), to: numbering.toGrid(scope.slices.to) }
      : scope.slices;
    const slices = resolveSlices(gridScope, sliceCount(first.geometry.dimensions, where.axis), where.slice);
    const samples = sampleSlices(slices);
    const stats = members.map((m) => {
      let voxels = 0;
      for (const k of slices) {
        const p = txn.readPlane(m.ref, where.axis, k);
        if (p) for (let i = 0; i < p.data.length; i++) voxels += p.data[i];
      }
      const planes = samples.map((k) => txn.readPlane(m.ref, where.axis, k)).filter((p): p is NonNullable<typeof p> => !!p);
      return { segmentIndex: m.ref.segmentIndex, name: m.name, voxels, thin: thinScore(planes) };
    });
    txn.discard();
    return planSmartCleanup(stats, opId, {
      ...DEFAULT_PLAN_OPTIONS,
      smallVoxels: smallThresholdFor(slices.length),
      safeAction,
    });
  },

  /**
   * Interpolate the active (or every) segment across empty slices and open the preview
   * (SegWorks #152–168). `fill`: every interior gap; the slice on screen (between its
   * nearest filled neighbours); or every slice strictly between anchors A and B (given in
   * the viewport's displayed numbering, 0-based) — those slices are replaced.
   */
  previewInterpolation(
    o: {
      method: InterpolationMethod;
      distance: DistanceMethod;
      fill: { kind: 'gaps' } | { kind: 'current' } | { kind: 'gap'; from: number; to: number } | { kind: 'anchors'; a: number; b: number };
      labels: LabelScope;
    },
    opts: { viewportId?: string; commit?: boolean } = {},
  ): RunResult {
    const seg = useSegmentationStore.getState();
    const containerId = seg.activeSegmentationId;
    const active = seg.activeSegmentIndex;
    const summary = seg.segmentations.find((s) => s.segmentationId === containerId);
    if (!containerId || !summary || !(active > 0)) return { ok: false, reason: 'no-target' };
    const viewportId = opts.viewportId ?? useViewerStore.getState().activeViewportId;
    if (!viewportId) return { ok: false, reason: 'no-viewport' };
    const allIndices = summary.segments.map((m) => m.segmentIndex);
    const allMembers: MemberRef[] = allIndices.map((segmentIndex) => ({ containerId, segmentIndex }));
    const members: MemberRef[] = withoutLockedWhenSeveral(resolveLabels(o.labels, active, allIndices), summary.segments).map((segmentIndex) => ({ containerId, segmentIndex }));
    if (!members.length) return { ok: false, reason: 'no-target' };

    let lockedMember: MemberRef | null = null;
    let begun = beginTransaction(members);
    if (!begun.ok && begun.reason === 'locked') {
      lockedMember = begun.member;
      begun = beginTransaction(members, undefined, { allowLocked: true });
    }
    if (!begun.ok) return { ok: false, reason: begun.reason, member: begun.member };
    const { txn } = begun;
    const grid = txn.grid(members[0]);
    if (grid && o.fill.kind !== 'gaps' && o.fill.kind !== 'gap' && !viewAligned(viewportId, grid.geometry)) { txn.discard(); return { ok: false, reason: 'oblique-view' }; }
    const where = grid ? viewportSlice(viewportId, grid.geometry) : null;
    const numbering = grid && where ? sliceNumbering(viewportId, grid.geometry, where.axis) : null;
    if (!grid || !where || !numbering) {
      txn.discard();
      return { ok: false, reason: 'no-viewport' };
    }
    const axis = where.axis;
    const count = sliceCount(grid.geometry.dimensions, axis);
    const interp = INTERPOLATORS[o.method];
    const source = o.method === 'imageGuided' ? grid.sourceReader?.() ?? null : null;
    const keyOf = (m: MemberRef) => m.segmentIndex;

    let added = 0;
    let removed = 0;
    const changed = new Set<number>();
    for (const member of members) {
      const planes = new Map<number, ReturnType<typeof txn.readPlane>>();
      const planeAt = (k: number) => {
        if (!planes.has(k)) planes.set(k, txn.readPlane(member, axis, k));
        return planes.get(k)!;
      };
      const filled = Array.from({ length: count }, (_, k) => !!planeAt(k)?.data.some((v) => v));
      // Spans to fill: [anchor a, anchor b], interpolating the slices strictly between.
      const spans: Array<[number, number]> = [];
      if (o.fill.kind === 'gaps') {
        for (const g of findGaps(filled)) spans.push([g.from - 1, g.to + 1]);
      } else if (o.fill.kind === 'gap') {
        const lo = Math.min(numbering.toGrid(o.fill.from), numbering.toGrid(o.fill.to));
        const hi = Math.max(numbering.toGrid(o.fill.from), numbering.toGrid(o.fill.to));
        if (lo - 1 >= 0 && hi + 1 < count && filled[lo - 1] && filled[hi + 1]) spans.push([lo - 1, hi + 1]);
      } else if (o.fill.kind === 'current') {
        const k = where.slice;
        if (!filled[k]) {
          let a = k - 1; while (a >= 0 && !filled[a]) a--;
          let b = k + 1; while (b < count && !filled[b]) b++;
          if (a >= 0 && b < count) spans.push([a, b]);
        }
      } else {
        const a = numbering.toGrid(o.fill.a);
        const b = numbering.toGrid(o.fill.b);
        if (Math.abs(a - b) > 1) spans.push([Math.min(a, b), Math.max(a, b)]);
      }
      const others = allMembers.filter((m) => keyOf(m) !== keyOf(member));
      for (const [a, b] of spans) {
        const A = planeAt(a);
        const B = planeAt(b);
        // Only between slices where this segment IS painted: interpolating toward an empty anchor
        // (Labels = All, a segment absent on A or B) erased it from every slice in between.
        if (!A || !B || !A.data.includes(1) || !B.data.includes(1)) continue;
        const targets = o.fill.kind === 'current' ? [where.slice] : Array.from({ length: b - a - 1 }, (_, i) => a + 1 + i);
        for (const k of targets) {
          const image = source ? extractValues(grid.geometry.dimensions, axis, k, source) : undefined;
          const result = interp(A, B, (k - a) / (b - a), { distance: o.distance, image });
          const blocked = txn.unionPlane(others, axis, k, result.width, result.height);
          const r = txn.applyPlane(member, axis, k, result, { blocked });
          added += r.added;
          removed += r.removed;
          if (r.added || r.removed) changed.add(k);
        }
      }
    }
    if (added + removed === 0) {
      txn.discard();
      return { ok: false, reason: 'no-change' };
    }
    const shown = [...changed].map((k) => numbering.toDisplay(k));
    startPreview({
      txn,
      label: `Interpolate · ${INTERPOLATION_NAMES[o.method]}`,
      summary: summarize(added, removed, shown),
      viewportId,
      lockedMember,
    });
    const committed = !!opts.commit && !lockedMember && commitPreview();
    return { ok: true, added, removed, slices: [...changed], readOnly: !!lockedMember, committed };
  },

  /** Interior gaps of each segment of the active Segmentation, in displayed numbering (0-based). */
  interpolationGaps(viewportId?: string): Array<{ segmentIndex: number; name: string; from: number; to: number }> {
    const seg = useSegmentationStore.getState();
    const containerId = seg.activeSegmentationId;
    const summary = seg.segmentations.find((s) => s.segmentationId === containerId);
    const vpId = viewportId ?? useViewerStore.getState().activeViewportId;
    if (!containerId || !summary || !vpId) return [];
    const out: Array<{ segmentIndex: number; name: string; from: number; to: number }> = [];
    for (const m of summary.segments) {
      const g = readSegmentVoxelGrid(containerId, m.segmentIndex);
      if (!g) continue;
      const where = viewportSlice(vpId, g.geometry);
      const numbering = where ? sliceNumbering(vpId, g.geometry, where.axis) : null;
      if (!where || !numbering) continue;
      const dims = g.geometry.dimensions;
      const filled = Array.from({ length: dims[where.axis] }, (_, k) => {
        const idx = sliceIndices(dims, where.axis, k);
        for (let p = 0; p < idx.length; p++) if (g.data[idx[p]] === g.value) return true;
        return false;
      });
      for (const gap of findGaps(filled)) {
        const a = numbering.toDisplay(gap.from);
        const b = numbering.toDisplay(gap.to);
        out.push({ segmentIndex: m.segmentIndex, name: m.label, from: Math.min(a, b), to: Math.max(a, b) });
      }
    }
    return out.sort((p, q) => p.from - q.from);
  },

  /** CT or MR for the active Segmentation's scan (CT when unknown and the image has air values). */
  activeModality(): 'ct' | 'mr' {
    const id = useSegmentationStore.getState().activeSegmentationId;
    const img = id ? getSourceImageIds(id)?.[0] : undefined;
    const m = img ? (metaData.get('generalSeriesModule', img) as { modality?: string } | undefined)?.modality : undefined;
    return m && m.toUpperCase() !== 'CT' ? 'mr' : 'ct';
  },

  /**
   * Propagate the active segment from the slice on screen through its neighbours and open
   * the preview (SegWorks #169–181). Direction is in the viewport's numbering. Propagated
   * voxels are ADDED to each slice (nothing painted is erased; other segments protected).
   */
  previewPropagation(
    o: { direction: 'forward' | 'backward' | 'both'; maxSlices: number; zSmoothing: boolean; options: PropagateOptions },
    opts: { viewportId?: string; commit?: boolean } = {},
  ): RunResult {
    const seg = useSegmentationStore.getState();
    const containerId = seg.activeSegmentationId;
    const active = seg.activeSegmentIndex;
    const summary = seg.segmentations.find((s) => s.segmentationId === containerId);
    if (!containerId || !summary || !(active > 0)) return { ok: false, reason: 'no-target' };
    const viewportId = opts.viewportId ?? useViewerStore.getState().activeViewportId;
    if (!viewportId) return { ok: false, reason: 'no-viewport' };
    const member: MemberRef = { containerId, segmentIndex: active };
    const others: MemberRef[] = summary.segments.filter((m) => m.segmentIndex !== active).map((m) => ({ containerId, segmentIndex: m.segmentIndex }));

    let lockedMember: MemberRef | null = null;
    let begun = beginTransaction([member]);
    if (!begun.ok && begun.reason === 'locked') {
      lockedMember = begun.member;
      begun = beginTransaction([member], undefined, { allowLocked: true });
    }
    if (!begun.ok) return { ok: false, reason: begun.reason, member: begun.member };
    const { txn } = begun;
    const grid = txn.grid(member);
    if (grid && !viewAligned(viewportId, grid.geometry)) { txn.discard(); return { ok: false, reason: 'oblique-view' }; }
    const where = grid ? viewportSlice(viewportId, grid.geometry) : null;
    const numbering = grid && where ? sliceNumbering(viewportId, grid.geometry, where.axis) : null;
    if (!grid || !where || !numbering) { txn.discard(); return { ok: false, reason: 'no-viewport' }; }
    const source = grid.sourceReader?.() ?? null;
    if (!source) { txn.discard(); return { ok: false, reason: 'no-image' }; }
    const axis = where.axis;
    const count = sliceCount(grid.geometry.dimensions, axis);
    const k0 = where.slice;
    const seed = txn.readPlane(member, axis, k0);
    if (!seed || !seed.data.some((v) => v)) { txn.discard(); return { ok: false, reason: 'no-seed' }; }
    const imageAt = (k: number) => extractValues(grid.geometry.dimensions, axis, k, source);
    const displayStep = numbering.toGrid(numbering.toDisplay(k0) + 1) - k0; // grid step for "forward"
    const dirs = o.direction === 'both' ? [displayStep, -displayStep] : [o.direction === 'forward' ? displayStep : -displayStep];

    const seedRef = intensityReference(seed, imageAt(k0), true)!;
    // The structure the seed sits in, on its own slice: what the first step's runaway check
    // compares against — a partial seed must not look like a leak.
    const seedStructure = propagateStep(seed, imageAt(k0), seedRef, { ...o.options, maxAreaChange: Infinity });
    const seedArea = seedStructure ? seedStructure.data.reduce((a, v) => a + v, 0) : undefined;
    const made = new Map<number, typeof seed>();
    for (const d of dirs) {
      let prev = seed;
      let prevK = k0;
      for (let i = 1; i <= o.maxSlices; i++) {
        const k = k0 + d * i;
        if (k < 0 || k >= count) break;
        const ref = o.options.stable ? seedRef : intensityReference(prev, imageAt(prevK), false) ?? seedRef;
        const next = propagateStep(prev, imageAt(k), ref, o.options, i === 1 ? seedArea : undefined);
        if (!next) break;
        made.set(k, next);
        prev = next;
        prevK = k;
      }
    }
    if (o.zSmoothing && made.size > 1) {
      const ks = [...made.keys(), k0].sort((a, b) => a - b);
      const stack = ks.map((k) => (k === k0 ? seed : made.get(k)!));
      zSmooth(stack, ks.indexOf(k0)).forEach((p, i) => { if (ks[i] !== k0) made.set(ks[i], p); });
    }
    let added = 0;
    const changed: number[] = [];
    for (const [k, p] of made) {
      const current = txn.readPlane(member, axis, k)!;
      const union = { ...p, data: Uint8Array.from(p.data, (v, i) => (v || current.data[i] ? 1 : 0)) };
      const blocked = txn.unionPlane(others, axis, k, p.width, p.height);
      const r = txn.applyPlane(member, axis, k, union, { blocked });
      added += r.added;
      if (r.added) changed.push(k);
    }
    if (added === 0) { txn.discard(); return { ok: false, reason: 'no-change' }; }
    startPreview({
      txn,
      label: 'Propagate',
      summary: summarize(added, 0, changed.map((k) => numbering.toDisplay(k))),
      viewportId,
      lockedMember,
    });
    const committed = !!opts.commit && !lockedMember && commitPreview();
    return { ok: true, added, removed: 0, slices: changed, readOnly: !!lockedMember, committed };
  },
};

const INTERPOLATION_NAMES: Record<InterpolationMethod, string> = {
  sdfLinear: 'Linear SDF', sdfArea: 'Area-preserving SDF', morphology: 'Morphology',
  components: 'Component matching', volumeMorphology: 'Volume-accurate', imageGuided: 'Image-guided',
};
