/**
 * Operation scope (SegWorks #182–187): which slices and which members an operation runs
 * over, and the runner that applies a plane operation across that scope inside a
 * labelmap transaction (branch 1 S2).
 *
 * Slices are indices along the viewing axis — the grid axis the active viewport looks
 * along — so "this slice" means the slice the user is looking at, in any orientation.
 */
import type { LabelmapTransaction, MemberRef } from '../../cornerstone/labelmapTransaction';
import type { MaskPlane, PlaneSpacing } from './plane';
import { type Axis, planeSize, planeSpacing } from './planeIO';

export type SliceScope =
  | { kind: 'current' }
  | { kind: 'range'; from: number; to: number }
  | { kind: 'volume' };

export type LabelScope =
  | { kind: 'active' }
  | { kind: 'all' }
  | { kind: 'pick'; segmentIndices: number[] };

export interface OperationScope {
  slices: SliceScope;
  labels: LabelScope;
}

/** Slice indices covered by `scope`, ascending, clamped to [0, count). */
export function resolveSlices(scope: SliceScope, count: number, current: number): number[] {
  const clamp = (v: number) => Math.min(count - 1, Math.max(0, Math.round(v)));
  if (count <= 0) return [];
  if (scope.kind === 'current') return [clamp(current)];
  const [a, b] = scope.kind === 'volume' ? [0, count - 1] : [clamp(Math.min(scope.from, scope.to)), clamp(Math.max(scope.from, scope.to))];
  const out: number[] = [];
  for (let s = a; s <= b; s++) out.push(s);
  return out;
}

/** Segment indices covered by `scope`, given the active one and every member's. */
export function resolveLabels(scope: LabelScope, active: number, all: number[]): number[] {
  if (scope.kind === 'active') return all.includes(active) ? [active] : [];
  if (scope.kind === 'all') return [...all];
  return scope.segmentIndices.filter((i) => all.includes(i));
}

/** What an operation sees for one member on one slice. */
export interface PlaneOpContext {
  member: MemberRef;
  slice: number;
  spacing: PlaneSpacing;
  /** Image intensities of the slice (plane order) when the runner was given an image reader. */
  image?: Float32Array;
}

export interface RunPlaneOpOptions {
  txn: LabelmapTransaction;
  /** Members the operation rewrites (each must be open for writing in `txn`). */
  members: MemberRef[];
  /** Every member of the container: the ones not being rewritten are protected from takeover. */
  allMembers: MemberRef[];
  axis: Axis;
  slices: number[];
  op: (plane: MaskPlane, ctx: PlaneOpContext) => MaskPlane;
  /** Restrict changes to this plane-shaped mask (applies to every slice). */
  roi?: ArrayLike<number>;
  /** Image intensities for a slice, in plane order (image-guided operations). */
  readImage?: (slice: number) => Float32Array | undefined;
  /** Allow adding pixels another member owns (default false: other members are preserved). */
  allowTakeover?: boolean;
}

export interface RunPlaneOpResult {
  added: number;
  removed: number;
  /** Slices on which something changed. */
  changedSlices: number[];
}

/**
 * Apply `op` to each member's plane on each slice. Members are processed one at a time
 * against the transaction's staged state, so a later member sees an earlier one's result.
 * A member never gains a pixel another member owns unless `allowTakeover` (SegWorks:
 * "preserve other labels") — in a shared labelmap that would erase the other member.
 */
export function runPlaneOp(o: RunPlaneOpOptions): RunPlaneOpResult {
  const keyOf = (m: MemberRef) => `${m.containerId}|${m.segmentIndex}`;
  let added = 0;
  let removed = 0;
  const changed = new Set<number>();
  for (const member of o.members) {
    const grid = o.txn.grid(member);
    if (!grid) continue;
    const dims = grid.geometry.dimensions;
    const spacing = planeSpacing(grid.geometry.spacing, o.axis);
    const { width, height } = planeSize(dims, o.axis);
    const others = o.allMembers.filter((m) => keyOf(m) !== keyOf(member));
    for (const slice of o.slices) {
      const before = o.txn.readPlane(member, o.axis, slice);
      if (!before) continue;
      const after = o.op(before, { member, slice, spacing, image: o.readImage?.(slice) });
      const blocked = o.allowTakeover ? undefined : o.txn.unionPlane(others, o.axis, slice, width, height);
      const r = o.txn.applyPlane(member, o.axis, slice, after, { blocked, roi: o.roi });
      added += r.added;
      removed += r.removed;
      if (r.added || r.removed) changed.add(slice);
    }
  }
  return { added, removed, changedSlices: [...changed].sort((a, b) => a - b) };
}
