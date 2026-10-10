/**
 * Labelmap transaction (SegWorks parity branch 1 S2): staged multi-member writes,
 * up-front lock refusal, one undo step on commit, nothing on discard — for both storage
 * layouts (a multi-layer group's per-member sub-segs, and a flat shared labelmap).
 */
import { describe, expect, it, vi } from 'vitest';
import type { SegmentVoxelGrid } from '../segmentVoxelGrid';
import { beginTransaction, type MemberRef, type TransactionDeps, type VoxelMemoRecord } from '../labelmapTransaction';
import { extractPlane, gridIndexOf, planeAxes, sliceIndices } from '../../segmentation/maskOps/planeIO';

const DIMS: [number, number, number] = [3, 3, 2];
const GEOM = { dimensions: DIMS, spacing: [1, 1, 1] as [number, number, number], origin: [0, 0, 0] as [number, number, number], direction: [1, 0, 0, 0, 1, 0, 0, 0, 1] };

type TestGrid = SegmentVoxelGrid & { data: Uint8Array };

function grid(csSegmentationId: string, value: number, data = new Uint8Array(18)): TestGrid {
  return { geometry: GEOM, data, value, csSegmentationId, write: (f, v) => { data[f] = v; } };
}

/** A multi-layer group: each member its own sub-seg holding value 1. */
function layered() {
  const grids: Record<string, TestGrid> = {
    'G|1': grid('G_layer_1', 1),
    'G|2': grid('G_layer_2', 1),
  };
  return grids;
}

/** A flat segmentation: both members in one labelmap holding their segment index. */
function flat() {
  const data = new Uint8Array(18);
  return { grids: { 'F|1': grid('F', 1, data), 'F|2': grid('F', 2, data) }, data };
}

function deps(grids: Record<string, SegmentVoxelGrid>, locked: string[] = []) {
  const pushed: VoxelMemoRecord[][] = [];
  const notified: string[] = [];
  const d: TransactionDeps = {
    readGrid: (c, s) => grids[`${c}|${s}`] ?? null,
    isLocked: (c, s) => locked.includes(`${c}|${s}`),
    pushMemos: (r) => { pushed.push(r); },
    notifyChanged: (id) => { notified.push(id); },
  };
  return { d, pushed, notified };
}

const A: MemberRef = { containerId: 'G', segmentIndex: 1 };
const B: MemberRef = { containerId: 'G', segmentIndex: 2 };

describe('beginTransaction', () => {
  it('refuses up front when any member to be written is locked', () => {
    const { d } = deps(layered(), ['G|2']);
    const r = beginTransaction([A, B], d);
    expect(r).toEqual({ ok: false, reason: 'locked', member: B });
  });

  it('refuses when a member has no labelmap', () => {
    const { d } = deps({});
    expect(beginTransaction([A], d)).toMatchObject({ ok: false, reason: 'no-labelmap' });
  });
});

describe('staging', () => {
  it('reads see staged writes; the live labelmap does not until commit', () => {
    const grids = layered();
    const { d, pushed } = deps(grids);
    const r = beginTransaction([A], d);
    if (!r.ok) throw new Error('begin');
    r.txn.set(A, 4, true);
    expect(r.txn.has(A, 4)).toBe(true);
    expect(grids['G|1'].data[4]).toBe(0);
    expect(pushed).toHaveLength(0);
    expect(r.txn.commit()).toBe(true);
    expect(grids['G|1'].data[4]).toBe(1);
  });

  it('a member that was not opened for writing cannot be written', () => {
    const { d } = deps(layered());
    const r = beginTransaction([A], d);
    if (!r.ok) throw new Error('begin');
    expect(() => r.txn.set(B, 0, true)).toThrow(/not opened for writing/);
    expect(r.txn.has(B, 0)).toBe(false); // but it can be read
  });

  it('staging a voxel back to its live value leaves no change', () => {
    const grids = layered();
    grids['G|1'].data[2] = 1;
    const { d, pushed } = deps(grids);
    const r = beginTransaction([A], d);
    if (!r.ok) throw new Error('begin');
    r.txn.set(A, 2, false);
    r.txn.set(A, 2, true);
    expect(r.txn.isEmpty).toBe(true);
    expect(r.txn.commit()).toBe(false);
    expect(pushed).toHaveLength(0);
  });

  it('discard leaves no trace', () => {
    const grids = layered();
    const { d, pushed, notified } = deps(grids);
    const r = beginTransaction([A], d);
    if (!r.ok) throw new Error('begin');
    r.txn.set(A, 0, true);
    r.txn.discard();
    expect(grids['G|1'].data[0]).toBe(0);
    expect(pushed).toHaveLength(0);
    expect(notified).toHaveLength(0);
  });
});

describe('commit', () => {
  it('writes several members as ONE undo step with one memo per Cornerstone segmentation', () => {
    const grids = layered();
    const { d, pushed, notified } = deps(grids);
    const r = beginTransaction([A, B], d);
    if (!r.ok) throw new Error('begin');
    r.txn.set(A, 1, true);
    r.txn.set(B, 5, true);
    r.txn.commit();
    expect(pushed).toHaveLength(1); // one step
    expect(pushed[0].map((m) => m.csSegmentationId).sort()).toEqual(['G_layer_1', 'G_layer_2']);
    expect(pushed[0].find((m) => m.csSegmentationId === 'G_layer_1')?.changes).toEqual([1, 0, 1]);
    expect(notified.sort()).toEqual(['G_layer_1', 'G_layer_2']);
  });

  it('the memo triples undo correctly when replayed in reverse', () => {
    const grids = layered();
    const { d, pushed } = deps(grids);
    const r = beginTransaction([A], d);
    if (!r.ok) throw new Error('begin');
    r.txn.set(A, 3, true);
    r.txn.set(A, 7, true);
    r.txn.commit();
    const c = pushed[0][0].changes;
    for (let i = c.length - 3; i >= 0; i -= 3) grids['G|1'].write(c[i], c[i + 1]);
    expect(Array.from(grids['G|1'].data).every((v) => v === 0)).toBe(true);
  });

  it('cannot be committed twice', () => {
    const { d } = deps(layered());
    const r = beginTransaction([A], d);
    if (!r.ok) throw new Error('begin');
    r.txn.commit();
    expect(() => r.txn.commit()).toThrow();
  });
});

describe('flat (shared) labelmap', () => {
  const FA: MemberRef = { containerId: 'F', segmentIndex: 1 };
  const FB: MemberRef = { containerId: 'F', segmentIndex: 2 };

  it('removing a voxel a member does not own never clears another member', () => {
    const g = flat();
    g.data[0] = 2;
    const { d } = deps(g.grids);
    const r = beginTransaction([FA], d);
    if (!r.ok) throw new Error('begin');
    r.txn.set(FA, 0, false);
    expect(r.txn.isEmpty).toBe(true);
  });

  it('applyPlane honours `blocked`: another member\'s pixels are not taken', () => {
    const g = flat();
    g.data[gridIndexOf(DIMS, 2, 0, 1, 1)] = 2; // FB owns the centre of slice 0
    const { d } = deps(g.grids);
    const r = beginTransaction([FA], d);
    if (!r.ok) throw new Error('begin');
    const full = { width: 3, height: 3, data: new Uint8Array(9).fill(1) };
    const blocked = r.txn.unionPlane([FB], 2, 0, 3, 3);
    const counts = r.txn.applyPlane(FA, 2, 0, full, { blocked });
    expect(counts).toEqual({ added: 8, removed: 0 });
    r.txn.commit();
    expect(g.data[gridIndexOf(DIMS, 2, 0, 1, 1)]).toBe(2);
  });

  it('two members staged in one labelmap commit as one memo for that labelmap', () => {
    const g = flat();
    const { d, pushed } = deps(g.grids);
    const r = beginTransaction([FA, FB], d);
    if (!r.ok) throw new Error('begin');
    r.txn.set(FA, 0, true);
    r.txn.set(FB, 1, true);
    r.txn.commit();
    expect(pushed[0]).toHaveLength(1);
    expect(pushed[0][0].changes).toEqual([0, 0, 1, 1, 0, 2]);
  });
});

describe('applyPlane ROI', () => {
  it('changes nothing outside the ROI, in either direction', () => {
    const grids = layered();
    grids['G|1'].data[gridIndexOf(DIMS, 2, 0, 0, 0)] = 1;
    const { d } = deps(grids);
    const r = beginTransaction([A], d);
    if (!r.ok) throw new Error('begin');
    const after = { width: 3, height: 3, data: Uint8Array.from([0, 1, 1, 0, 0, 0, 0, 0, 0]) };
    const roi = Uint8Array.from([0, 1, 0, 0, 0, 0, 0, 0, 0]);
    expect(r.txn.applyPlane(A, 2, 0, after, { roi })).toEqual({ added: 1, removed: 0 });
  });
});

describe('planeIO', () => {
  it('maps plane pixels to grid indices for every viewing axis', () => {
    // axis 2: x=i, y=j ; axis 1: x=i, y=k ; axis 0: x=j, y=k
    expect(planeAxes(2)).toEqual([0, 1]);
    expect(gridIndexOf(DIMS, 2, 1, 2, 1)).toBe(2 + 1 * 3 + 1 * 9);
    expect(gridIndexOf(DIMS, 1, 2, 1, 1)).toBe(1 + 2 * 3 + 1 * 9);
    expect(gridIndexOf(DIMS, 0, 2, 1, 1)).toBe(2 + 1 * 3 + 1 * 9);
  });

  it('each slice along an axis visits a distinct set of voxels covering the grid', () => {
    for (const axis of [0, 1, 2] as const) {
      const seen = new Set<number>();
      for (let s = 0; s < DIMS[axis]; s++) sliceIndices(DIMS, axis, s).forEach((i) => seen.add(i));
      expect(seen.size).toBe(18);
    }
  });

  it('extractPlane reads the slice in plane order', () => {
    const data = new Uint8Array(18);
    data[gridIndexOf(DIMS, 0, 1, 2, 1)] = 7;
    const p = extractPlane(DIMS, 0, 1, (i) => data[i], 7);
    expect(p.width).toBe(3);
    expect(p.height).toBe(2);
    expect(Array.from(p.data)).toEqual([0, 0, 0, 0, 0, 1]);
  });
});

void vi;
