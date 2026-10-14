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
import { readSegmentVoxelGrid, type SegmentVoxelGrid } from './segmentVoxelGrid';
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
  changes: number[];
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

interface Staged {
  grid: SegmentVoxelGrid;
  /** The first written member — the memo's (container, segment) for undo and locks. */
  member: MemberRef;
  writes: Map<number, number>;
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
    const st = this.staged.get(grid.csSegmentationId);
    const v = st?.writes.get(flat);
    return v === undefined ? grid.data[flat] : v;
  }

  /** Whether the member owns voxel `flat`, staged writes included. */
  has(member: MemberRef, flat: number): boolean {
    const g = this.grid(member);
    return !!g && this.raw(g, flat) === g.value;
  }

  /** Stage: add (`on`) or remove the member at voxel `flat`. Removing a voxel the member
   *  does not own is a no-op (it never clears another member in a shared labelmap). */
  set(member: MemberRef, flat: number, on: boolean): void {
    if (this.done) throw new Error('[labelmapTransaction] set after commit/discard');
    if (!this.writable.has(keyOf(member))) throw new Error(`[labelmapTransaction] ${keyOf(member)} was not opened for writing`);
    const g = this.grid(member);
    if (!g) return;
    const current = this.raw(g, flat);
    let next: number;
    if (on) next = g.value;
    else if (current === g.value) next = 0;
    else return;
    if (next === current) return;
    let st = this.staged.get(g.csSegmentationId);
    if (!st) {
      st = { grid: g, member, writes: new Map() };
      this.staged.set(g.csSegmentationId, st);
    }
    if (next === g.data[flat]) st.writes.delete(flat); // back to the live value: no change
    else st.writes.set(flat, next);
  }

  /** The member's plane on `slice` along `axis`, staged writes included. */
  readPlane(member: MemberRef, axis: Axis, slice: number): MaskPlane | null {
    const g = this.grid(member);
    if (!g) return null;
    const dims = g.geometry.dimensions;
    const { width, height } = planeSize(dims, axis);
    const idx = sliceIndices(dims, axis, slice);
    const data = new Uint8Array(idx.length);
    for (let p = 0; p < idx.length; p++) if (this.raw(g, idx[p]) === g.value) data[p] = 1;
    return { width, height, data };
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
    opts: { blocked?: ArrayLike<number>; roi?: ArrayLike<number> } = {},
  ): { added: number; removed: number } {
    const g = this.grid(member);
    if (!g) return { added: 0, removed: 0 };
    const idx = sliceIndices(g.geometry.dimensions, axis, slice);
    let added = 0;
    let removed = 0;
    for (let p = 0; p < idx.length; p++) {
      if (opts.roi && !opts.roi[p]) continue;
      const had = this.raw(g, idx[p]) === g.value;
      const want = after.data[p] === 1;
      if (had === want) continue;
      if (want) {
        if (opts.blocked?.[p]) continue;
        this.set(member, idx[p], true);
        added++;
      } else {
        this.set(member, idx[p], false);
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
  changes(): Array<{ grid: SegmentVoxelGrid; member: MemberRef; writes: ReadonlyMap<number, number> }> {
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
      const changes: number[] = [];
      for (const [flat, value] of writes) {
        const old = grid.data[flat];
        if (old === value) continue;
        changes.push(flat, old, value);
        grid.write(flat, value);
      }
      if (changes.length) records.push({ ...member, csSegmentationId: grid.csSegmentationId, changes });
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

/**
 * Push one memo on Cornerstone's global history ring (whose push hook files it per
 * container — a multi-layer sub-seg maps to its group). Undo replays the writes in
 * reverse, so a voxel written twice ends at its FIRST old value.
 */
function pushVoxelMemo(r: VoxelMemoRecord): void {
  const ring = (csCoreUtilities as unknown as { HistoryMemo?: { DefaultHistoryMemo?: { push?: (m: unknown) => void } } })
    .HistoryMemo?.DefaultHistoryMemo;
  ring?.push?.({
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
  });
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

export const defaultDeps: TransactionDeps = {
  readGrid: readSegmentVoxelGrid,
  isLocked: isSegmentLockedHere,
  pushMemos: (records) => {
    if (records.length === 1) {
      pushVoxelMemo(records[0]);
      return;
    }
    if (!historyGrouper) {
      console.warn('[labelmapTransaction] no history grouper registered; recording', records.length, 'separate undo steps');
      records.forEach(pushVoxelMemo);
      return;
    }
    historyGrouper(() => records.forEach(pushVoxelMemo));
  },
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
}

export function beginDirectEdit(member: MemberRef, deps: TransactionDeps = defaultDeps): DirectEdit | null {
  const locked = deps.isLocked(member.containerId, member.segmentIndex);
  const begun = beginTransaction([member], deps, { allowLocked: true });
  if (!begun.ok) return null;
  const { txn } = begun;
  const before = txn.grid(member);
  if (!before) return null;
  return {
    finish() {
      const now = deps.readGrid(member.containerId, member.segmentIndex);
      if (!now || now.data.length !== before.data.length) { txn.discard(); return 'no-change'; }
      const changed: number[] = [];
      for (let i = 0; i < now.data.length; i++) {
        if ((now.data[i] === now.value) !== (before.data[i] === before.value)) changed.push(i);
      }
      if (!changed.length) { txn.discard(); return 'no-change'; }
      if (locked) {
        for (const i of changed) now.write(i, before.data[i]);
        txn.discard();
        deps.notifyChanged(now.csSegmentationId);
        return 'reverted';
      }
      for (const i of changed) txn.set(member, i, now.data[i] === now.value);
      txn.commit();
      return 'recorded';
    },
  };
}
