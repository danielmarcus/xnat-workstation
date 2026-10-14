/**
 * O8 (#97): the reworked plane runner (slice by slice, planes cached per slice, empty slices
 * skipped) must write exactly what the member-by-member runner wrote — on a shared (flat)
 * labelmap and a multi-layer group, along every axis, with claims, locks and takeover.
 * `runPlaneOpBefore` is the previous runner, verbatim.
 */
import { describe, expect, it } from 'vitest';
import type { SegmentVoxelGrid } from '../../../cornerstone/segmentVoxelGrid';
import { beginTransaction, type MemberRef, type TransactionDeps } from '../../../cornerstone/labelmapTransaction';
import { runPlaneOp, type PlaneOpContext, type PlaneOpOutput, type RunPlaneOpOptions, type RunPlaneOpResult } from '../scope';
import { type Axis, extractValues, planeSize, planeSpacing } from '../planeIO';
import type { MaskPlane } from '../plane';
import { closeMask, fillHoles, gaussianSmooth } from '../cleanup';
import { CLEANUP_OPS, cleanupOp, defaultParams, type ParamValues } from '../catalog';
import { applyCleanupJob, gatherCleanupJob, type CleanupJobOutput } from '../cleanupJob';
import { handleComputeRequest, type ComputeResponse } from '../../../compute/protocol';

function runPlaneOpBefore(o: RunPlaneOpOptions): RunPlaneOpResult {
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
    const locked = new Set((o.lockedMembers ?? []).map(keyOf));
    const lockedOthers = others.filter((m) => locked.has(keyOf(m)));
    for (const slice of o.slices) {
      const before = o.txn.readPlane(member, o.axis, slice);
      if (!before) continue;
      const otherPx = o.txn.unionPlane(others, o.axis, slice, width, height);
      const protect = o.txn.unionPlane(lockedOthers, o.axis, slice, width, height);
      const out = o.op(before, { member, slice, spacing, image: o.readImage?.(slice), others: otherPx, protect });
      const after = 'plane' in out ? out.plane : out;
      const claimed = 'plane' in out ? out.claimed : undefined;
      // Claimed pixels leave their unlocked owners first (inside the ROI), so the member can take them.
      if (claimed) {
        for (const m of others) {
          if (locked.has(keyOf(m))) continue;
          const p = o.txn.readPlane(m, o.axis, slice);
          if (!p) continue;
          const next = Uint8Array.from(p.data, (v, i) => (v && claimed[i] && (!o.roi || o.roi[i]) ? 0 : v));
          if (next.some((v, i) => v !== p.data[i])) removed += o.txn.applyPlane(m, o.axis, slice, { ...p, data: next }).removed;
        }
      }
      const blocked = o.allowTakeover ? undefined : o.txn.unionPlane(others, o.axis, slice, width, height);
      const r = o.txn.applyPlane(member, o.axis, slice, after, { blocked, roi: o.roi });
      added += r.added;
      removed += r.removed;
      if (r.added || r.removed) changed.add(slice);
    }
  }
  return { added, removed, changedSlices: [...changed].sort((a, b) => a - b) };
}

const DIMS: [number, number, number] = [23, 19, 9];
const N = DIMS[0] * DIMS[1] * DIMS[2];
const MEMBERS = [1, 2, 3, 4];

/** Random painted blobs per member, some slices left empty; later members overwrite (flat) or overlap (layered). */
function paint(seed: number): Uint8Array[] {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  return MEMBERS.map((m) => {
    const d = new Uint8Array(N);
    for (let k = 0; k < DIMS[2]; k++) {
      if (rnd() < 0.3) continue; // an empty slice
      for (let b = 0; b < 3; b++) {
        const cx = rnd() * DIMS[0], cy = rnd() * DIMS[1], r = 1.5 + rnd() * 4;
        for (let j = 0; j < DIMS[1]; j++) for (let i = 0; i < DIMS[0]; i++) {
          if ((i - cx) ** 2 + (j - cy) ** 2 <= r * r && rnd() > 0.08) d[i + j * DIMS[0] + k * DIMS[0] * DIMS[1]] = 1;
        }
      }
    }
    void m;
    return d;
  });
}

const geometry = { dimensions: DIMS, spacing: [0.7, 0.9, 2] as [number, number, number], origin: [0, 0, 0] as [number, number, number], direction: [1, 0, 0, 0, 1, 0, 0, 0, 1] };

function store(kind: 'flat' | 'layered', masks: Uint8Array[]) {
  const grids: Record<string, SegmentVoxelGrid> = {};
  const arrays: Uint8Array[] = [];
  if (kind === 'flat') {
    const data = new Uint8Array(N);
    masks.forEach((mk, i) => { for (let f = 0; f < N; f++) if (mk[f]) data[f] = MEMBERS[i]; });
    arrays.push(data);
    for (const m of MEMBERS) grids[`C|${m}`] = { geometry, data, value: m, csSegmentationId: 'C', write: (f, v) => { data[f] = v; } };
  } else {
    masks.forEach((mk, i) => {
      const data = new Uint8Array(mk);
      arrays.push(data);
      grids[`C|${MEMBERS[i]}`] = { geometry, data, value: 1, csSegmentationId: `C_${MEMBERS[i]}`, write: (f, v) => { data[f] = v; } };
    });
  }
  const deps: TransactionDeps = { readGrid: (c, s) => grids[`${c}|${s}`] ?? null, isLocked: () => false, pushMemos: () => {}, notifyChanged: () => {} };
  return { deps, arrays };
}

const ref = (m: number): MemberRef => ({ containerId: 'C', segmentIndex: m });

/** A growing op that claims the neighbours' pixels it reaches. */
const claimingGrow = (p: MaskPlane, ctx: PlaneOpContext): PlaneOpOutput => {
  const grown = closeMask(p, { radius: 1 });
  const data = Uint8Array.from(grown.data, (v, i) => (v || (i > 0 && p.data[i - 1]) ? 1 : 0));
  const others = ctx.others!;
  return { plane: { ...p, data }, claimed: Uint8Array.from(data, (v, i) => (v && others[i] ? 1 : 0)) };
};

const cases: Array<{ name: string; op: RunPlaneOpOptions['op']; extra?: Partial<RunPlaneOpOptions> }> = [
  { name: 'fill holes', op: (p, c) => fillHoles(p, c.spacing), extra: { skipEmpty: true } },
  { name: 'gaussian', op: (p) => gaussianSmooth(p, { sigma: 1.6 }), extra: { skipEmpty: true } },
  { name: 'grow with takeover', op: (p) => closeMask({ ...p, data: Uint8Array.from(p.data, (v, i) => (v || p.data[i + 1] ? 1 : 0)) }, { radius: 1 }), extra: { allowTakeover: true } },
  { name: 'grow claiming neighbours, member 4 locked', op: claimingGrow, extra: { lockedMembers: [ref(4)] } },
  { name: 'clear inside an ROI', op: (p) => ({ ...p, data: new Uint8Array(p.data.length) }) },
];

describe('runPlaneOp equals the member-by-member runner (O8)', () => {
  for (const kind of ['flat', 'layered'] as const) {
    for (const axis of [0, 1, 2] as Axis[]) {
      for (const c of cases) {
        it(`${kind}, axis ${axis}: ${c.name}`, () => {
          for (const seed of [11, 29]) {
            const masks = paint(seed + axis);
            const results: Array<{ res: RunPlaneOpResult; arrays: Uint8Array[] }> = [];
            for (const run of [runPlaneOpBefore, runPlaneOp]) {
              const { deps, arrays } = store(kind, masks);
              const writers = MEMBERS.filter((m) => m !== 4).map(ref);
              const r = beginTransaction(writers, deps);
              if (!r.ok) throw new Error('begin');
              const { width, height } = planeSize(DIMS, axis);
              const roi = c.name.includes('ROI') ? Uint8Array.from({ length: width * height }, (_, i) => (i % 3 ? 1 : 0)) : undefined;
              const res = run({
                txn: r.txn, members: [ref(1), ref(2), ref(3)], allMembers: MEMBERS.map(ref), axis,
                slices: Array.from({ length: DIMS[axis] }, (_, k) => k), op: c.op, roi, ...c.extra,
              });
              r.txn.commit();
              results.push({ res, arrays });
            }
            expect(results[1].res).toEqual(results[0].res);
            results[0].arrays.forEach((a, i) => expect(Buffer.from(results[1].arrays[i]).equals(Buffer.from(a))).toBe(true));
          }
        });
      }
    }
  }
});

/**
 * O8 (#97): a Volume Cleanup computed on the Cleanup worker — gathered from the transaction,
 * cropped to the targets' box grown by each operation's reach, run by `runCleanupJob` (the
 * worker's body, behind the compute protocol and a structured clone as postMessage does),
 * applied back — stages exactly the voxels the synchronous runner stages: every Cleanup
 * operation, a shared labelmap and a multi-layer group, every axis, Active and All, a locked
 * member, claims (Snake refine replacing neighbours) and an ROI.
 */
describe('a Volume Cleanup on the worker equals the synchronous run (O8, #97)', () => {
  const D: [number, number, number] = [64, 56, 7];
  const ND = D[0] * D[1] * D[2];
  const geo = { ...geometry, dimensions: D };
  const image = Float32Array.from({ length: ND }, (_, f) => {
    const i = f % D[0], j = Math.floor(f / D[0]) % D[1];
    return (Math.hypot(i - 32, j - 28) < 9 ? 200 : 40) + ((f * 7919) % 13);
  });

  /** Blobs (holes, specks, strays) away from the plane's edge, so the crop window is interior. */
  function paintInterior(seed: number): Uint8Array[] {
    let s = seed;
    const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    return MEMBERS.map(() => {
      const d = new Uint8Array(ND);
      for (let k = 0; k < D[2]; k++) {
        if (rnd() < 0.3) continue;
        for (let b = 0; b < 3; b++) {
          const cx = 22 + rnd() * 20, cy = 20 + rnd() * 16, r = 1 + rnd() * 5;
          for (let j = 0; j < D[1]; j++) for (let i = 0; i < D[0]; i++) {
            if ((i - cx) ** 2 + (j - cy) ** 2 <= r * r && rnd() > 0.1) d[i + j * D[0] + k * D[0] * D[1]] = 1;
          }
        }
      }
      return d;
    });
  }

  function storeD(kind: 'flat' | 'layered', masks: Uint8Array[]) {
    const grids: Record<string, SegmentVoxelGrid> = {};
    const arrays: Uint8Array[] = [];
    if (kind === 'flat') {
      const data = new Uint8Array(ND);
      masks.forEach((mk, i) => { for (let f = 0; f < ND; f++) if (mk[f]) data[f] = MEMBERS[i]; });
      arrays.push(data);
      for (const m of MEMBERS) grids[`C|${m}`] = { geometry: geo, data, value: m, csSegmentationId: 'C', write: (f, v) => { data[f] = v; } };
    } else {
      masks.forEach((mk, i) => {
        const data = new Uint8Array(mk);
        arrays.push(data);
        grids[`C|${MEMBERS[i]}`] = { geometry: geo, data, value: 1, csSegmentationId: `C_${MEMBERS[i]}`, write: (f, v) => { data[f] = v; } };
      });
    }
    const deps: TransactionDeps = { readGrid: (c, sg) => grids[`${c}|${sg}`] ?? null, isLocked: () => false, pushMemos: () => {}, notifyChanged: () => {} };
    return { deps, arrays };
  }

  const actions: Array<{ name: string; opId: string; params?: ParamValues; labels?: 'active' | 'all'; roi?: boolean }> = [
    ...CLEANUP_OPS.filter((o) => o.run).map((o) => ({ name: o.label, opId: o.id })),
    { name: 'Fill holes, largest 3 mm², All', opId: 'fillHoles', params: { maxHoleAreaMm2: 3 }, labels: 'all' },
    { name: 'Median r 3, All', opId: 'median', params: { radius: 3 }, labels: 'all' },
    { name: 'Gaussian σ 2.6, low threshold', opId: 'gaussian', params: { sigma: 2.6, threshold: 0.2 } },
    { name: 'Morph open r 2, All', opId: 'open', params: { radius: 2 }, labels: 'all' },
    { name: 'Morph close r 3, All', opId: 'close', params: { radius: 3 }, labels: 'all' },
    { name: 'Smooth edges, strength 1.5', opId: 'smoothEdges', params: { strength: 1.5 } },
    { name: 'Anisotropic, quadratic', opId: 'anisotropic', params: { conduction: 'quadratic', iterations: 6 } },
    { name: 'Snake refine replacing neighbours', opId: 'snakeRefine', params: { variant: 'morph', iterations: 4, replaceNeighbours: 'replace' } },
    { name: 'Snake refine replacing neighbours, All', opId: 'snakeRefine', params: { variant: 'balloon', iterations: 5, replaceNeighbours: 'replace' }, labels: 'all' },
    { name: 'Keep largest inside an ROI, All', opId: 'keepLargest', labels: 'all', roi: true },
    { name: 'Clear inside an ROI', opId: 'clear', roi: true },
  ];

  for (const kind of ['flat', 'layered'] as const) {
    for (const axis of [0, 1, 2] as Axis[]) {
      for (const a of actions) {
        it(`${kind}, axis ${axis}: ${a.name}`, async () => {
          const op = cleanupOp(a.opId)!;
          const params = { ...defaultParams(op), ...a.params };
          const targets = a.labels === 'all' ? [1, 2, 3] : [2];
          const members = targets.map(ref);
          const allMembers = MEMBERS.map(ref);
          const lockedMembers = [ref(4)];
          const writers = [1, 2, 3].map(ref);
          const { width, height } = planeSize(D, axis);
          const roi = a.roi ? Uint8Array.from({ length: width * height }, (_, i) => ((i % width) < width / 2 + 3 ? 1 : 0)) : undefined;
          const readImage = op.usesImage ? (k: number) => extractValues(D, axis, k, (f) => image[f]) : undefined;
          const slices = Array.from({ length: D[axis] }, (_, k) => k);
          for (const seed of [5, 17]) {
            const masks = paintInterior(seed + axis);
            const sync = storeD(kind, masks);
            const s = beginTransaction(writers, sync.deps);
            if (!s.ok) throw new Error('begin');
            const syncRes = runPlaneOp({
              txn: s.txn, members, allMembers, lockedMembers, axis, slices, roi, readImage, skipEmpty: true,
              op: (p, c) => op.run!(p, c, params),
            });
            s.txn.commit();

            const worker = storeD(kind, masks);
            const w = beginTransaction(writers, worker.deps);
            if (!w.ok) throw new Error('begin');
            const go = async () => true;
            const actionsBy = Object.fromEntries(targets.map((i) => [i, { opId: a.opId, params }]));
            const input = await gatherCleanupJob(w.txn, { axis, members, allMembers, lockedMembers, actions: actionsBy, slices, roi, readImage }, go);
            if (input === 'stopped') throw new Error('stopped');
            if (input) {
              if (axis === 2 && op.reach && op.reach(params) <= 12) expect(input.window.width * input.window.height, 'cropped').toBeLessThan(width * height);
              const posted: ComputeResponse[] = [];
              handleComputeRequest(structuredClone({ id: 1, name: 'cleanupVolume' as const, input }), (m) => posted.push(structuredClone(m)));
              const last = posted[posted.length - 1];
              if (last.type !== 'result') throw new Error(last.type === 'error' ? last.message : 'no result');
              const out = last.output as CleanupJobOutput;
              expect({ added: out.added, removed: out.removed, changedSlices: out.changedSlices }).toEqual(syncRes);
              expect(await applyCleanupJob(w.txn, axis, input, out, go)).toBe(true);
            } else {
              expect(syncRes.added + syncRes.removed).toBe(0);
            }
            w.txn.commit();
            sync.arrays.forEach((arr, i) => expect(Buffer.from(worker.arrays[i]).equals(Buffer.from(arr)), `${kind} array ${i}, seed ${seed}`).toBe(true));
          }
        });
      }
    }
  }
});
