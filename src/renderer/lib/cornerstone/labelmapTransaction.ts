/**
 * Labelmap transaction — the one way a programmatic edit writes segment voxels
 * (SegWorks parity, branch 1 S2; docs/segworks-parity.md §5).
 *
 * An edit names the members it may WRITE; the transaction refuses up front if any of them
 * is locked (nothing is half-applied). Writes are STAGED: reads through the transaction
 * see them, the live labelmap does not, so a staged transaction is also a preview (S3).
 * `commit()` writes everything through each grid's live writer — the brush's own path —
 * as ONE undo step across every member touched (one memo per Cornerstone segmentation,
 * recorded inside a history group), then fires the same modified/render events as a
 * brush stroke. `discard()` leaves no trace.
 *
 * Storage: in a multi-layer group (what "New Segmentation" creates) every member is its
 * own Cornerstone sub-seg holding value 1, so members can overlap; in a flat
 * segmentation all members share one labelmap holding their segment index, so a pixel
 * belongs to at most one. Staging is keyed by Cornerstone segmentation, which keeps the
 * shared-labelmap case consistent. Overlap policy — whether an edit may add a pixel
 * another member already owns — is the caller's (`blocked` in applyPlane).
 */
import { utilities as csCoreUtilities } from '@cornerstonejs/core';
import { segmentation as csSegmentation, utilities as csToolUtilities } from '@cornerstonejs/tools';
import * as mlg from './multiLayerGroup';
import { readSegmentVoxelGrid, voxelAt, type SegmentVoxelGrid } from './segmentVoxelGrid';
import type { MaskPlane } from '../segmentation/maskOps/plane';
import { type Axis, sliceIndices, planeSize } from '../segmentation/maskOps/planeIO';

export interface MemberRef {
  containerId: string;
  segmentIndex: number;
}

/** One undo record: (flat, old, new) triples written to one Cornerstone segmentation. */
export interface VoxelMemoRecord {
  containerId: string;
  segmentIndex: number;
  csSegmentationId: string;
  /** A typed array: a volume edit can write more voxels than a JS array holds comfortably. */
  changes: ArrayLike<number>;
}

export interface TransactionDeps {
  readGrid(containerId: string, segmentIndex: number): SegmentVoxelGrid | null;
  isLocked(containerId: string, segmentIndex: number): boolean;
  /** Record the memos as ONE undo step. */
  pushMemos(records: VoxelMemoRecord[]): void;
  notifyChanged(csSegmentationId: string): void;
}

export type BeginResult =
  | { ok: true; txn: LabelmapTransaction }
  | { ok: false; reason: 'locked' | 'no-labelmap'; member: MemberRef };

const keyOf = (m: MemberRef) => `${m.containerId}|${m.segmentIndex}`;

/**
 * The staged writes to one Cornerstone segmentation, held DENSE: one Uint16Array per grid
 * slice (axis 2), allocated on the first write to it, storing value + 1 (0 = not staged).
 * A Map of voxel -> value capped a transaction at V8's 2^24 entries (a Volume module or
 * cleanup on 512² × 300 threw "Map maximum size exceeded", X5) and cost ~50 bytes a voxel;
 * this is 2 bytes a voxel of the slices touched, whatever the count.
 */
export class StagedWrites {
  private readonly chunks: Array<Uint16Array | undefined>;
  private count = 0;

  constructor(readonly sliceSize: number, slices: number) {
    this.chunks = new Array(slices);
  }

  /** Number of staged voxels. */
  get size(): number {
    return this.count;
  }

  /** The staged value at `flat`, or undefined if none is staged. */
  get(flat: number): number | undefined {
    const c = this.chunks[Math.floor(flat / this.sliceSize)];
    const v = c ? c[flat % this.sliceSize] : 0;
    return v === 0 ? undefined : v - 1;
  }

  set(flat: number, value: number): void {
    if (!(value >= 0 && value < 0xffff)) throw new RangeError(`[labelmapTransaction] labelmap value ${value} out of range`);
    const k = Math.floor(flat / this.sliceSize);
    let c = this.chunks[k];
    if (!c) c = this.chunks[k] = new Uint16Array(this.sliceSize);
    const p = flat % this.sliceSize;
    if (c[p] === 0) this.count++;
    c[p] = value + 1;
  }

  delete(flat: number): void {
    const c = this.chunks[Math.floor(flat / this.sliceSize)];
    const p = flat % this.sliceSize;
    if (c && c[p] !== 0) {
      c[p] = 0;
      this.count--;
    }
  }

  /** The raw chunk of grid slice `k` (value + 1 per pixel, 0 = not staged), if any write touched it. */
  chunk(k: number): Uint16Array | undefined {
    return this.chunks[k];
  }

  /** Every staged (value, flat), in flat order. */
  forEach(fn: (value: number, flat: number) => void): void {
    for (let k = 0; k < this.chunks.length; k++) {
      const c = this.chunks[k];
      if (!c) continue;
      const base = k * this.sliceSize;
      for (let p = 0; p < c.length; p++) if (c[p] !== 0) fn(c[p] - 1, base + p);
    }
  }

  /** Every staged voxel index, in flat order. */
  *keys(): IterableIterator<number> {
    for (let k = 0; k < this.chunks.length; k++) {
      const c = this.chunks[k];
      if (!c) continue;
      const base = k * this.sliceSize;
      for (let p = 0; p < c.length; p++) if (c[p] !== 0) yield base + p;
    }
  }

  clear(): void {
    this.chunks.fill(undefined);
    this.count = 0;
  }
}

interface Staged {
  grid: SegmentVoxelGrid;
  /** The first written member — the memo's (container, segment) for undo and locks. */
  member: MemberRef;
  writes: StagedWrites;
}

export class LabelmapTransaction {
  private readonly writable = new Set<string>();
  private readonly grids = new Map<string, SegmentVoxelGrid>();
  private readonly staged = new Map<string, Staged>();
  private done = false;

  constructor(private readonly deps: TransactionDeps, writeMembers: MemberRef[], grids: Map<string, SegmentVoxelGrid>) {
    for (const m of writeMembers) this.writable.add(keyOf(m));
    for (const [k, g] of grids) this.grids.set(k, g);
  }

  /** The member's grid (read-only access is allowed for any member). */
  grid(member: MemberRef): SegmentVoxelGrid | null {
    const k = keyOf(member);
    let g = this.grids.get(k) ?? null;
    if (!g) {
      g = this.deps.readGrid(member.containerId, member.segmentIndex);
      if (g) this.grids.set(k, g);
    }
    return g;
  }

  /** Raw labelmap value at `flat` in the member's storage, staged writes included. */
  private raw(grid: SegmentVoxelGrid, flat: number): number {
    const v = this.staged.get(grid.csSegmentationId)?.writes.get(flat);
    return v === undefined ? voxelAt(grid, flat) : v;
  }

  /** Whether the member owns voxel `flat`, staged writes included. */
  has(member: MemberRef, flat: number): boolean {
    const g = this.grid(member);
    return !!g && this.raw(g, flat) === g.value;
  }

  /** Stage: add (`on`) or remove the member at voxel `flat`. Removing a voxel the member
   *  does not own is a no-op (it never clears another member in a shared labelmap). */
  set(member: MemberRef, flat: number, on: boolean): void {
    this.assertWritable(member);
    const g = this.grid(member);
    if (!g) return;
    this.stage(g, member, flat, on, voxelAt(g, flat));
  }

  private assertWritable(member: MemberRef): void {
    if (this.done) throw new Error('[labelmapTransaction] set after commit/discard');
    if (!this.writable.has(keyOf(member))) throw new Error(`[labelmapTransaction] ${keyOf(member)} was not opened for writing`);
  }

  /** set(), given the member's grid and the voxel's LIVE value. */
  private stage(g: SegmentVoxelGrid, member: MemberRef, flat: number, on: boolean, live: number): void {
    const staged = this.staged.get(g.csSegmentationId)?.writes.get(flat);
    const current = staged === undefined ? live : staged;
    let next: number;
    if (on) next = g.value;
    else if (current === g.value) next = 0;
    else return;
    if (next === current) return;
    let st = this.staged.get(g.csSegmentationId);
    if (!st) {
      const [nx, ny, nz] = g.geometry.dimensions;
      st = { grid: g, member, writes: new StagedWrites(nx * ny, nz) };
      this.staged.set(g.csSegmentationId, st);
    }
    if (next === live) st.writes.delete(flat); // back to the live value: no change
    else st.writes.set(flat, next);
  }

  /** The member's plane on `slice` along `axis`, staged writes included. */
  readPlane(member: MemberRef, axis: Axis, slice: number): MaskPlane | null {
    const g = this.grid(member);
    if (!g) return null;
    const dims = g.geometry.dimensions;
    const { width, height } = planeSize(dims, axis);
    const data = new Uint8Array(width * height);
    if (axis === 2) {
      // A grid slice is one labelmap image: read its pixels and the slice's staged chunk
      // directly — never the rest of the grid (X4).
      const base = slice * data.length;
      // The slice's pixels: the labelmap image's own, or (an in-memory grid) a run of `data`.
      let live = g.slice?.(slice) ?? null;
      let off = 0;
      if (!live && !g.at) { live = g.data; off = base; }
      const staged = this.staged.get(g.csSegmentationId)?.writes.chunk(slice);
      const value = g.value;
      if (live && !staged) {
        for (let p = 0; p < data.length; p++) if (live[off + p] === value) data[p] = 1;
        return { width, height, data };
      }
      for (let p = 0; p < data.length; p++) {
        const s = staged ? staged[p] : 0;
        const v = s !== 0 ? s - 1 : live ? live[off + p] : voxelAt(g, base + p);
        if (v === value) data[p] = 1;
      }
      return { width, height, data };
    }
    const idx = sliceIndices(dims, axis, slice);
    for (let p = 0; p < idx.length; p++) if (this.raw(g, idx[p]) === g.value) data[p] = 1;
    return { width, height, data };
  }

  /** Whether the member has any voxel on the slice, staged writes included — on an unstaged
   *  grid slice a native scan of the image's pixels, with no plane built (O8). */
  anyOnPlane(member: MemberRef, axis: Axis, slice: number): boolean {
    const g = this.grid(member);
    if (!g) return false;
    if (axis === 2 && !this.staged.get(g.csSegmentationId)?.writes.chunk(slice)) {
      const n = g.geometry.dimensions[0] * g.geometry.dimensions[1];
      const own = g.slice?.(slice) ?? null;
      const live = own ?? (g.at ? null : g.data);
      const off = own ? 0 : slice * n;
      if (live && ArrayBuffer.isView(live)) {
        return (live as unknown as Uint16Array).subarray(off, off + n).indexOf(g.value) >= 0;
      }
    }
    const p = this.readPlane(member, axis, slice);
    return !!p && p.data.includes(1);
  }

  /**
   * Stage `after` as the member's plane on `slice`. Pixels the member gains are skipped
   * where `blocked` is set (owned by another member the caller protects) or outside
   * `roi`; pixels it loses are skipped outside `roi`. Returns the counts staged.
   */
  applyPlane(
    member: MemberRef,
    axis: Axis,
    slice: number,
    after: MaskPlane,
    opts: {
      blocked?: ArrayLike<number>;
      roi?: ArrayLike<number>;
      /** The member's plane as staged right now, when the caller already holds it (saves a read). */
      current?: MaskPlane;
    } = {},
  ): { added: number; removed: number } {
    const g = this.grid(member);
    const current = g && (opts.current ?? this.readPlane(member, axis, slice));
    if (!g || !current) return { added: 0, removed: 0 };
    // Grid indices only where a pixel changes (a grid slice is one contiguous run).
    const idx = axis === 2 ? null : sliceIndices(g.geometry.dimensions, axis, slice);
    const base = slice * current.data.length;
    // A grid slice's live pixels, read directly: `voxelAt` finds the slice's image per voxel,
    // which made staging a Volume Cleanup's millions of voxels take seconds (O8).
    const live = axis === 2 ? g.slice?.(slice) ?? null : null;
    let checked = false;
    const stage = (p: number, on: boolean) => {
      if (!checked) { this.assertWritable(member); checked = true; }
      const flat = idx ? idx[p] : base + p;
      this.stage(g, member, flat, on, live ? live[p] : voxelAt(g, flat));
    };
    let added = 0;
    let removed = 0;
    for (let p = 0; p < current.data.length; p++) {
      const had = current.data[p] === 1;
      const want = after.data[p] === 1;
      if (had === want) continue;
      if (opts.roi && !opts.roi[p]) continue;
      if (want) {
        if (opts.blocked?.[p]) continue;
        stage(p, true);
        added++;
      } else {
        stage(p, false);
        removed++;
      }
    }
    return { added, removed };
  }

  /** Union of the given members' planes (e.g. every OTHER member, as `blocked`). */
  unionPlane(members: MemberRef[], axis: Axis, slice: number, width: number, height: number): Uint8Array {
    const out = new Uint8Array(width * height);
    for (const m of members) {
      const p = this.readPlane(m, axis, slice);
      if (!p) continue;
      for (let i = 0; i < out.length; i++) if (p.data[i]) out[i] = 1;
    }
    return out;
  }

  /** Staged changes per Cornerstone segmentation (what a preview draws, what commit writes). */
  changes(): Array<{ grid: SegmentVoxelGrid; member: MemberRef; writes: StagedWrites }> {
    return [...this.staged.values()].filter((s) => s.writes.size > 0).map((s) => ({ grid: s.grid, member: s.member, writes: s.writes }));
  }

  get isEmpty(): boolean {
    return this.changes().length === 0;
  }

  /** Write every staged change as ONE undo step. Returns false if there was nothing to write. */
  commit(): boolean {
    if (this.done) throw new Error('[labelmapTransaction] commit twice');
    this.done = true;
    const records: VoxelMemoRecord[] = [];
    for (const { grid, member, writes } of this.changes()) {
      const changes = new Int32Array(3 * writes.size);
      let n = 0;
      writes.forEach((value, flat) => {
        const old = voxelAt(grid, flat);
        if (old === value) return;
        changes[n++] = flat;
        changes[n++] = old;
        changes[n++] = value;
        grid.write(flat, value);
      });
      if (n) records.push({ ...member, csSegmentationId: grid.csSegmentationId, changes: n === changes.length ? changes : changes.subarray(0, n) });
    }
    if (records.length === 0) return false;
    this.deps.pushMemos(records);
    for (const r of records) this.deps.notifyChanged(r.csSegmentationId);
    return true;
  }

  discard(): void {
    this.done = true;
    this.staged.clear();
  }
}

/**
 * Open a transaction that may write `writeMembers`; refuses if any is locked or has no
 * labelmap. `allowLocked` opens it anyway for a READ-ONLY preview — the caller must not
 * commit it (maskPreview enforces that for previews it is told are read-only).
 */
export function beginTransaction(
  writeMembers: MemberRef[],
  deps: TransactionDeps = defaultDeps,
  opts: { allowLocked?: boolean } = {},
): BeginResult {
  const grids = new Map<string, SegmentVoxelGrid>();
  for (const m of writeMembers) {
    if (!opts.allowLocked && deps.isLocked(m.containerId, m.segmentIndex)) return { ok: false, reason: 'locked', member: m };
    const g = deps.readGrid(m.containerId, m.segmentIndex);
    if (!g) return { ok: false, reason: 'no-labelmap', member: m };
    grids.set(keyOf(m), g);
  }
  return { ok: true, txn: new LabelmapTransaction(deps, writeMembers, grids) };
}

// ─── Live Cornerstone wiring ─────────────────────────────────────────────────

/** Whether a (container, segment) is locked — a multi-layer segment's lock lives on its
 *  sub-seg (stored as segment 1). */
export function isSegmentLockedHere(containerId: string, segmentIndex: number): boolean {
  try {
    const sub = mlg.isMultiLayerGroup(containerId) ? mlg.resolveSubSegId(containerId, segmentIndex) : containerId;
    const value = mlg.isMultiLayerGroup(containerId) ? 1 : segmentIndex;
    return !!sub && csSegmentation.segmentLocking.isSegmentIndexLocked(sub, value);
  } catch {
    return false;
  }
}

/** Re-render after a programmatic labelmap write (same events as a brush edit). */
export function notifyLabelmapChanged(csSegmentationId: string): void {
  try {
    csSegmentation.triggerSegmentationEvents.triggerSegmentationDataModified(csSegmentationId);
  } catch { /* best-effort */ }
  for (const vpId of csSegmentation.state.getViewportIdsWithSegmentation(csSegmentationId)) {
    try { csToolUtilities.segmentation.triggerSegmentationRender(vpId); } catch { /* ignore */ }
  }
}

/** Hooks run after an undo/redo of a voxel memo (e.g. clearing a stale island selection). */
const restoreListeners = new Set<() => void>();
export function onVoxelMemoRestored(fn: () => void): () => void {
  restoreListeners.add(fn);
  return () => restoreListeners.delete(fn);
}

/** An app history memo, as Cornerstone's ring holds it (its push hook files it per container by
 *  `segmentationId` — a multi-layer sub-seg maps to its group). */
export interface AppHistoryMemo {
  id: string;
  operationType: string;
  segmentationId: string;
  segmentIndex: number;
  restoreMemo: (isUndo?: boolean) => void;
}

function pushHistoryMemo(m: AppHistoryMemo): void {
  const ring = (csCoreUtilities as unknown as { HistoryMemo?: { DefaultHistoryMemo?: { push?: (m: unknown) => void } } })
    .HistoryMemo?.DefaultHistoryMemo;
  ring?.push?.(m);
}

/**
 * The memo of one voxel record. Undo replays the writes in reverse, so a voxel written twice
 * ends at its FIRST old value.
 */
export function voxelHistoryMemo(r: VoxelMemoRecord): AppHistoryMemo {
  return {
    id: `voxels-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    operationType: 'labelmap',
    segmentationId: r.csSegmentationId,
    segmentIndex: r.segmentIndex,
    restoreMemo: (isUndo = true) => {
      const g = readSegmentVoxelGrid(r.containerId, r.segmentIndex);
      if (!g) return;
      const c = r.changes;
      if (isUndo) for (let i = c.length - 3; i >= 0; i -= 3) g.write(c[i], c[i + 1]);
      else for (let i = 0; i < c.length; i += 3) g.write(c[i], c[i + 2]);
      for (const fn of restoreListeners) {
        try { fn(); } catch { /* listener errors never block an undo */ }
      }
      notifyLabelmapChanged(g.csSegmentationId);
    },
  };
}

/**
 * Runs `fn` as ONE undo step on both histories. Registered by segmentationService (which
 * owns the per-container history) rather than imported, so this module stays free of the
 * service's heavy dependency graph.
 */
let historyGrouper: ((fn: () => void) => void) | null = null;
export function registerHistoryGrouper(fn: (fn: () => void) => void): void {
  historyGrouper = fn;
}

/** Record memos as ONE undo step (undone last-to-first, redone first-to-last). */
export function recordHistoryStep(memos: AppHistoryMemo[]): void {
  if (memos.length === 1) {
    pushHistoryMemo(memos[0]);
    return;
  }
  if (!historyGrouper) {
    console.warn('[labelmapTransaction] no history grouper registered; recording', memos.length, 'separate undo steps');
    memos.forEach(pushHistoryMemo);
    return;
  }
  historyGrouper(() => memos.forEach(pushHistoryMemo));
}

export const defaultDeps: TransactionDeps = {
  readGrid: readSegmentVoxelGrid,
  isLocked: isSegmentLockedHere,
  pushMemos: (records) => recordHistoryStep(records.map(voxelHistoryMemo)),
  notifyChanged: notifyLabelmapChanged,
};

/**
 * A Cornerstone tool that writes the labelmap itself — Region / Region+ (grow-cut), Rect Multi
 * (threshold ROI) — pushes no history memo and checks no lock: its edit could not be undone
 * (Ctrl+Z undid the edit before it instead) and it wrote into locked segments. Bracket such a
 * write with `beginDirectEdit(member)` … `finish()`: the member's voxels are snapshotted before,
 * and what the tool changed is recorded afterwards as ONE undo step, like any app edit — or, if
 * the member is locked, put back.
 */
export interface DirectEdit {
  /** Record (or, for a locked member, revert) what changed since `beginDirectEdit`. */
  finish(): 'recorded' | 'reverted' | 'no-change';
  /** The tool's run failed: put back whatever it wrote since `beginDirectEdit`, and record nothing. */
  abort(): void;
}

export function beginDirectEdit(member: MemberRef, deps: TransactionDeps = defaultDeps): DirectEdit | null {
  const locked = deps.isLocked(member.containerId, member.segmentIndex);
  const live = deps.readGrid(member.containerId, member.segmentIndex);
  if (!live) return null;
  // The edit is staged against a SNAPSHOT of the member taken now (a stack is copied on this
  // first read of `data`), so commit records what the tool changed as old -> new; reads through
  // `at` would see the tool's writes and stage nothing.
  const beforeData = live.data;
  const before: SegmentVoxelGrid = {
    geometry: live.geometry, data: beforeData, value: live.value, csSegmentationId: live.csSegmentationId, write: live.write,
  };
  const txn = new LabelmapTransaction(deps, [member], new Map([[keyOf(member), before]]));
  /** Indices whose membership differs from the snapshot (and the live grid), or null if unreadable. */
  const changedSince = () => {
    const now = deps.readGrid(member.containerId, member.segmentIndex);
    const nowData = now?.data;
    if (!now || !nowData || nowData.length !== beforeData.length) return null;
    const changed: number[] = [];
    const nowValue = now.value, beforeValue = before.value;
    for (let i = 0; i < nowData.length; i++) {
      if ((nowData[i] === nowValue) !== (beforeData[i] === beforeValue)) changed.push(i);
    }
    return { now, changed };
  };
  return {
    finish() {
      const diff = changedSince();
      if (!diff || !diff.changed.length) { txn.discard(); return 'no-change'; }
      const { now, changed } = diff;
      if (locked) {
        for (const i of changed) now.write(i, beforeData[i]);
        txn.discard();
        deps.notifyChanged(now.csSegmentationId);
        return 'reverted';
      }
      for (const i of changed) txn.set(member, i, now.data[i] === now.value);
      txn.commit();
      return 'recorded';
    },
    abort() {
      const diff = changedSince();
      if (diff?.changed.length) {
        for (const i of diff.changed) diff.now.write(i, beforeData[i]);
        deps.notifyChanged(diff.now.csSegmentationId);
      }
      txn.discard();
    },
  };
}
