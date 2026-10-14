/**
 * O8 (#97): a Volume / All-segments Cleanup must not cost a full plane pass per member per
 * slice, empty or not. 512² × 100 with 5 members painted on 20 slices each — the shape of the
 * measured case (Fill holes, Volume, All: 16.7 s) — must finish within a stated budget.
 */
import { describe, expect, it } from 'vitest';
import type { SegmentVoxelGrid } from '../../../cornerstone/segmentVoxelGrid';
import { beginTransaction, type MemberRef, type TransactionDeps } from '../../../cornerstone/labelmapTransaction';
import { runPlaneOp } from '../scope';
import { cleanupOp, defaultParams } from '../catalog';

const NX = 512;
const NY = 512;
const NZ = 100;
const MEMBERS = 5;
/**
 * Generous: ~2.5 s on a shared 4-CPU box under a load of 14, 7.5 s with a full test suite and
 * E2E run beside it; the unoptimised runner took 22 s (and 116 s loaded). The plane-read count
 * below is the load-independent half of the check.
 */
const BUDGET_MS = 12000;
/** 100 member-slices are painted; each costs a handful of plane reads (it was ~10 per member per slice, empty or not: ~5000). */
const MAX_PLANE_READS = 500;

function setup() {
  const grids: Record<string, SegmentVoxelGrid> = {};
  for (let m = 1; m <= MEMBERS; m++) {
    const data = new Uint8Array(NX * NY * NZ);
    const cx = 60 + 90 * (m - 1);
    for (let k = 15 * m - 10; k < 15 * m + 10; k++) {
      for (let y = 200; y < 300; y++) {
        for (let x = cx - 30; x < cx + 30; x++) data[x + y * NX + k * NX * NY] = 1;
      }
      for (let y = 240; y < 260; y++) for (let x = cx - 10; x < cx + 10; x++) data[x + y * NX + k * NX * NY] = 0; // a hole
    }
    grids[`G|${m}`] = {
      geometry: { dimensions: [NX, NY, NZ], spacing: [1, 1, 1], origin: [0, 0, 0], direction: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
      data, value: 1, csSegmentationId: `G_layer_${m}`, write: (f, v) => { data[f] = v; },
    };
  }
  const deps: TransactionDeps = { readGrid: (c, s) => grids[`${c}|${s}`] ?? null, isLocked: () => false, pushMemos: () => {}, notifyChanged: () => {} };
  return { grids, deps };
}

describe('Volume cleanup over every member (O8)', () => {
  it(`Fill holes, Volume, All on 512² × ${NZ} × ${MEMBERS} members finishes within ${BUDGET_MS} ms`, () => {
    const { deps } = setup();
    const all: MemberRef[] = Array.from({ length: MEMBERS }, (_, i) => ({ containerId: 'G', segmentIndex: i + 1 }));
    const op = cleanupOp('fillHoles')!;
    const params = defaultParams(op);
    const r = beginTransaction(all, deps);
    if (!r.ok) throw new Error('begin');
    let reads = 0;
    const readPlane = r.txn.readPlane.bind(r.txn);
    r.txn.readPlane = (...a) => { reads++; return readPlane(...a); };
    const t0 = performance.now();
    const res = runPlaneOp({
      txn: r.txn, members: all, allMembers: all, axis: 2, slices: Array.from({ length: NZ }, (_, k) => k),
      op: (p, c) => op.run!(p, c, params) as typeof p, skipEmpty: true,
    });
    const ms = performance.now() - t0;
    expect(res.added).toBe(MEMBERS * 20 * 400);
    expect(reads).toBeLessThan(MAX_PLANE_READS);
    expect(ms).toBeLessThan(BUDGET_MS);
  }, 120_000);
});
