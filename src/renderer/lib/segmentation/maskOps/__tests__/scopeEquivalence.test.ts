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
import { type Axis, planeSize, planeSpacing } from '../planeIO';
import type { MaskPlane } from '../plane';
import { closeMask, fillHoles, gaussianSmooth } from '../cleanup';

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
