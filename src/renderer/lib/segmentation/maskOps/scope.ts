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
  /** Pixels of the container's other members on this slice. */
  others?: Uint8Array;
  /** Pixels of locked members on this slice: never to be taken. */
  protect?: Uint8Array;
}

/**
 * What a plane operation returns: the member's new plane, and optionally the pixels it
 * CLAIMS from its neighbours (Snake Refine's "Replace boundary with neighbours", #201) —
 * those leave their (unlocked) owners so the member can take them.
 */
export type PlaneOpOutput = MaskPlane | { plane: MaskPlane; claimed?: Uint8Array };

export interface RunPlaneOpOptions {
  txn: LabelmapTransaction;
  /** Members the operation rewrites (each must be open for writing in `txn`). */
  members: MemberRef[];
  /** Every member of the container: the ones not being rewritten are protected from takeover. */
  allMembers: MemberRef[];
  axis: Axis;
  slices: number[];
  op: (plane: MaskPlane, ctx: PlaneOpContext) => PlaneOpOutput;
  /** Members that may not be changed (locked): their pixels are never claimed. */
  lockedMembers?: MemberRef[];
  /** Restrict changes to this plane-shaped mask (applies to every slice). */
  roi?: ArrayLike<number>;
  /** Image intensities for a slice, in plane order (image-guided operations). */
  readImage?: (slice: number) => Float32Array | undefined;
  /** Allow adding pixels another member owns (default false: other members are preserved). */
  allowTakeover?: boolean;
  /**
   * `op` turns an empty plane into an empty plane (every Cleanup operation does): a member's
   * empty slices are skipped without running it or reading anyone else's plane (O8).
   */
  skipEmpty?: boolean;
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
 *
 * Slice by slice, then member by member: an op reads and writes only its own slice, so this
 * order sees exactly the state the member-by-member order did, while each member's plane
 * on the slice is read once and reused for every other member's union (O8 — the union was
 * re-read per member, twice: an "All" run cost members² plane reads per slice).
 */
export function runPlaneOp(o: RunPlaneOpOptions): RunPlaneOpResult {
  const keyOf = (m: MemberRef) => `${m.containerId}|${m.segmentIndex}`;
  let added = 0;
  let removed = 0;
  const changed = new Set<number>();
  const locked = new Set((o.lockedMembers ?? []).map(keyOf));
  const runs = o.members.flatMap((member) => {
    const grid = o.txn.grid(member);
    if (!grid) return [];
    const others = o.allMembers.filter((m) => keyOf(m) !== keyOf(member));
    return [{
      member,
      spacing: planeSpacing(grid.geometry.spacing, o.axis),
      ...planeSize(grid.geometry.dimensions, o.axis),
      others,
      lockedOthers: others.filter((m) => locked.has(keyOf(m))),
    }];
  });
  for (const slice of o.slices) {
    // This slice's planes, read once (an empty one not at all) and dropped after any write to the slice.
    const planes = new Map<string, { any: boolean; p?: MaskPlane | null }>();
    const entry = (m: MemberRef) => {
      const k = keyOf(m);
      let e = planes.get(k);
      if (!e) planes.set(k, (e = { any: o.txn.anyOnPlane(m, o.axis, slice) }));
      return e;
    };
    const has = (m: MemberRef) => entry(m).any;
    const plane = (m: MemberRef) => {
      const e = entry(m);
      if (e.p === undefined) e.p = o.txn.readPlane(m, o.axis, slice);
      return e.p;
    };
    const union = (members: MemberRef[], width: number, height: number) => {
      const out = new Uint8Array(width * height);
      for (const m of members) {
        if (!has(m)) continue;
        const p = plane(m);
        if (!p) continue;
        for (let i = 0; i < out.length; i++) if (p.data[i]) out[i] = 1;
      }
      return out;
    };
    let image: Float32Array | undefined;
    let imageRead = false;
    for (const { member, spacing, width, height, others, lockedOthers } of runs) {
      if (o.skipEmpty && !has(member)) continue;
      const before = plane(member);
      if (!before) continue;
      if (!imageRead) { image = o.readImage?.(slice); imageRead = true; }
      const otherPx = union(others, width, height);
      const protect = union(lockedOthers, width, height);
      const out = o.op(before, { member, slice, spacing, image, others: otherPx, protect });
      const after = 'plane' in out ? out.plane : out;
      const claimed = 'plane' in out ? out.claimed : undefined;
      // Claimed pixels leave their unlocked owners first (inside the ROI), so the member can take them.
      let claimedAny = false;
      if (claimed) {
        for (const m of others) {
          if (locked.has(keyOf(m)) || !has(m)) continue;
          const p = plane(m);
          if (!p) continue;
          const next = Uint8Array.from(p.data, (v, i) => (v && claimed[i] && (!o.roi || o.roi[i]) ? 0 : v));
          if (next.some((v, i) => v !== p.data[i])) {
            removed += o.txn.applyPlane(m, o.axis, slice, { ...p, data: next }).removed;
            planes.clear(); // a shared labelmap: one write can change several members
            claimedAny = true;
          }
        }
      }
      const blocked = o.allowTakeover ? undefined : claimedAny ? union(others, width, height) : otherPx;
      // Claims only clear OTHER members' pixels, so `before` is still the member's plane.
      const r = o.txn.applyPlane(member, o.axis, slice, after, { blocked, roi: o.roi, current: before });
      added += r.added;
      removed += r.removed;
      if (r.added || r.removed) {
        changed.add(slice);
        planes.clear();
      }
    }
  }
  return { added, removed, changedSlices: [...changed].sort((a, b) => a - b) };
}

export interface RunPairOpOptions {
  txn: LabelmapTransaction;
  source: MemberRef;
  target: MemberRef;
  allMembers: MemberRef[];
  /** Members that may not be changed (locked): never claimed. */
  lockedMembers: MemberRef[];
  axis: Axis;
  slices: number[];
  op: (source: MaskPlane, target: MaskPlane, ctx: { spacing: PlaneSpacing; others: Uint8Array; protectedMask: Uint8Array }) => {
    source?: MaskPlane;
    target: MaskPlane;
    claimed?: Uint8Array;
  };
}

/**
 * Apply a two-segment operation (source → target) on each slice. The target never takes a
 * locked member's pixels; pixels it CLAIMS from other members are removed from them (in a
 * shared labelmap that happens by itself; in a multi-layer group each owner is cleared).
 */
export function runPairOp(o: RunPairOpOptions): RunPlaneOpResult {
  const keyOf = (m: MemberRef) => `${m.containerId}|${m.segmentIndex}`;
  const grid = o.txn.grid(o.target);
  if (!grid) return { added: 0, removed: 0, changedSlices: [] };
  const { width, height } = planeSize(grid.geometry.dimensions, o.axis);
  const spacing = planeSpacing(grid.geometry.spacing, o.axis);
  const others = o.allMembers.filter((m) => keyOf(m) !== keyOf(o.source) && keyOf(m) !== keyOf(o.target));
  const locked = new Set(o.lockedMembers.map(keyOf));
  let added = 0;
  let removed = 0;
  const changed = new Set<number>();
  for (const slice of o.slices) {
    const src = o.txn.readPlane(o.source, o.axis, slice);
    const dst = o.txn.readPlane(o.target, o.axis, slice);
    if (!src || !dst) continue;
    const otherPx = o.txn.unionPlane(others, o.axis, slice, width, height);
    const protectedMask = o.txn.unionPlane(others.filter((m) => locked.has(keyOf(m))), o.axis, slice, width, height);
    const r = o.op(src, dst, { spacing, others: otherPx, protectedMask });
    // Claimed pixels leave their (unlocked) owners first, so the target can take them.
    if (r.claimed) {
      for (const m of others) {
        if (locked.has(keyOf(m))) continue;
        const p = o.txn.readPlane(m, o.axis, slice);
        if (!p) continue;
        const next = new Uint8Array(p.data);
        let any = false;
        for (let i = 0; i < next.length; i++) if (r.claimed[i] && next[i]) { next[i] = 0; any = true; }
        if (any) removed += o.txn.applyPlane(m, o.axis, slice, { ...p, data: next }).removed;
      }
    }
    // The target may take the source's pixels and claimed pixels; never a locked member's.
    const t = o.txn.applyPlane(o.target, o.axis, slice, r.target, { blocked: protectedMask });
    added += t.added;
    removed += t.removed;
    if (r.source) {
      const s = o.txn.applyPlane(o.source, o.axis, slice, r.source);
      removed += s.removed;
      added += s.added;
    }
    if (t.added || t.removed || (r.source && !r.source.data.every((v, i) => v === src.data[i]))) changed.add(slice);
  }
  return { added, removed, changedSlices: [...changed].sort((a, b) => a - b) };
}
