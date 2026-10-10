/**
 * Operation scope + runner (branch 1 S2): slices/labels resolve as the user chose, the
 * runner applies a plane operation across them in one transaction, and other members'
 * pixels are protected unless takeover is allowed.
 */
import { describe, expect, it } from 'vitest';
import type { SegmentVoxelGrid } from '../../../cornerstone/segmentVoxelGrid';
import { beginTransaction, type TransactionDeps } from '../../../cornerstone/labelmapTransaction';
import { resolveLabels, resolveSlices, runPlaneOp } from '../scope';
import { gridIndexOf } from '../planeIO';
import { fillHoles } from '../cleanup';

describe('resolveSlices', () => {
  it('current → the current slice (clamped)', () => {
    expect(resolveSlices({ kind: 'current' }, 10, 4)).toEqual([4]);
    expect(resolveSlices({ kind: 'current' }, 10, 99)).toEqual([9]);
  });
  it('range → inclusive, in either order, clamped', () => {
    expect(resolveSlices({ kind: 'range', from: 6, to: 3 }, 10, 0)).toEqual([3, 4, 5, 6]);
    expect(resolveSlices({ kind: 'range', from: -5, to: 1 }, 10, 0)).toEqual([0, 1]);
  });
  it('volume → every slice', () => {
    expect(resolveSlices({ kind: 'volume' }, 3, 1)).toEqual([0, 1, 2]);
  });
});

describe('resolveLabels', () => {
  it('active / all / pick (unknown indices dropped)', () => {
    expect(resolveLabels({ kind: 'active' }, 2, [1, 2, 3])).toEqual([2]);
    expect(resolveLabels({ kind: 'all' }, 2, [1, 2, 3])).toEqual([1, 2, 3]);
    expect(resolveLabels({ kind: 'pick', segmentIndices: [3, 9] }, 2, [1, 2, 3])).toEqual([3]);
  });
});

describe('runPlaneOp', () => {
  const DIMS: [number, number, number] = [5, 5, 3];
  const geometry = { dimensions: DIMS, spacing: [1, 1, 1] as [number, number, number], origin: [0, 0, 0] as [number, number, number], direction: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
  /** Flat labelmap: member 1 is a ring (hole in the middle) on every slice; member 2 owns the hole on slice 1. */
  function setup() {
    const data = new Uint8Array(75);
    for (let k = 0; k < 3; k++) {
      for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) data[gridIndexOf(DIMS, 2, k, x, y)] = 1;
      data[gridIndexOf(DIMS, 2, k, 2, 2)] = 0;
    }
    data[gridIndexOf(DIMS, 2, 1, 2, 2)] = 2;
    const mk = (value: number): SegmentVoxelGrid => ({ geometry, data, value, csSegmentationId: 'F', write: (f, v) => { data[f] = v; } });
    const grids: Record<string, SegmentVoxelGrid> = { 'F|1': mk(1), 'F|2': mk(2) };
    const deps: TransactionDeps = {
      readGrid: (c, s) => grids[`${c}|${s}`] ?? null,
      isLocked: () => false,
      pushMemos: () => {},
      notifyChanged: () => {},
    };
    return { data, deps };
  }
  const M1 = { containerId: 'F', segmentIndex: 1 };
  const M2 = { containerId: 'F', segmentIndex: 2 };

  it('fills holes on every slice in range, but not the one another member owns', () => {
    const { data, deps } = setup();
    const r = beginTransaction([M1], deps);
    if (!r.ok) throw new Error('begin');
    const res = runPlaneOp({
      txn: r.txn, members: [M1], allMembers: [M1, M2], axis: 2, slices: [0, 1, 2],
      op: (p, c) => fillHoles(p, c.spacing),
    });
    expect(res).toEqual({ added: 2, removed: 0, changedSlices: [0, 2] });
    r.txn.commit();
    expect(data[gridIndexOf(DIMS, 2, 0, 2, 2)]).toBe(1);
    expect(data[gridIndexOf(DIMS, 2, 1, 2, 2)]).toBe(2); // member 2 preserved
    expect(data[gridIndexOf(DIMS, 2, 2, 2, 2)]).toBe(1);
  });

  it('with takeover allowed, the other member\'s pixel is claimed', () => {
    const { data, deps } = setup();
    const r = beginTransaction([M1], deps);
    if (!r.ok) throw new Error('begin');
    runPlaneOp({
      txn: r.txn, members: [M1], allMembers: [M1, M2], axis: 2, slices: [1],
      op: (p) => ({ ...p, data: new Uint8Array(p.data.length).fill(1) }), allowTakeover: true,
    });
    r.txn.commit();
    expect(data[gridIndexOf(DIMS, 2, 1, 2, 2)]).toBe(1);
  });

  it('runs along any viewing axis', () => {
    const { deps } = setup();
    const r = beginTransaction([M1], deps);
    if (!r.ok) throw new Error('begin');
    const seen: Array<[number, number]> = [];
    runPlaneOp({
      txn: r.txn, members: [M1], allMembers: [M1], axis: 0, slices: [2],
      op: (p) => { seen.push([p.width, p.height]); return p; },
    });
    expect(seen).toEqual([[5, 3]]); // x = j (5), y = k (3)
  });

  it('hands image-guided operations the slice intensities', () => {
    const { deps } = setup();
    const r = beginTransaction([M1], deps);
    if (!r.ok) throw new Error('begin');
    let got: Float32Array | undefined;
    runPlaneOp({
      txn: r.txn, members: [M1], allMembers: [M1], axis: 2, slices: [1],
      readImage: (s) => new Float32Array(25).fill(s * 10),
      op: (p, c) => { got = c.image; return p; },
    });
    expect(got?.[0]).toBe(10);
  });
});
