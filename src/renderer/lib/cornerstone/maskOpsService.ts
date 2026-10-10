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
import { beginTransaction, type MemberRef } from './labelmapTransaction';
import { sliceAxisFor } from './maskIslands';
import { worldToIndex, type Vec3 } from './segmentationService/voxelClipboard';
import { commitPreview, startPreview } from './maskPreview';
import { sliceNumbering } from './sliceNumbering';
import { cleanupOp, type ParamValues } from '../segmentation/maskOps/catalog';
import { type Axis, extractValues, sliceCount } from '../segmentation/maskOps/planeIO';
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
  | { ok: false; reason: 'no-target' | 'no-viewport' | 'locked' | 'no-labelmap' | 'unknown-op' | 'no-change'; member?: MemberRef };

/** The viewing axis and on-screen slice of a viewport, in a grid's index space. */
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
    opts: { viewportId?: string; onDone?: (committed: boolean) => void; commit?: boolean; targetSegmentIndex?: number } = {},
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
    const members: MemberRef[] = resolveLabels(scope.labels, active, allIndices).map((segmentIndex) => ({ containerId, segmentIndex }));
    if (members.length === 0) return { ok: false, reason: 'no-target' };

    // A locked target can still be previewed (read-only); it can never be committed.
    let lockedMember: MemberRef | null = null;
    let begun = beginTransaction(members);
    if (!begun.ok && begun.reason === 'locked') {
      lockedMember = begun.member;
      begun = beginTransaction(members, undefined, { allowLocked: true });
    }
    if (!begun.ok) return { ok: false, reason: begun.reason, member: begun.member };
    const { txn } = begun;
    const grid = txn.grid(members[0]);
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

    const source = op.usesImage ? grid.sourceReader?.() ?? null : null;
    if (op.usesImage && !source) console.warn('[maskOpsService] source image unavailable; running', opId, 'without image guidance');
    const result = runPlaneOp({
      txn,
      members,
      allMembers,
      axis: where.axis,
      slices,
      op: (plane, ctx) => op.run!(plane, ctx, params),
      readImage: source ? (s) => extractValues(grid.geometry.dimensions, where.axis, s, source) : undefined,
    });
    if (result.added + result.removed === 0) {
      txn.discard();
      return { ok: false, reason: 'no-change' };
    }
    const shown = result.changedSlices.map((k) => numbering?.toDisplay(k) ?? k);
    startPreview({
      txn,
      label: op.label,
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
};
