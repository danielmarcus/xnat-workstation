/**
 * The 3D solvers (branch 5, G1): each seeded method recovers a known sphere from a few seeds;
 * the regressions that motivated not porting SegWorks' code (neighbour wrap-around, scan-order
 * dependence, 0 read as "default") stay fixed.
 */
import { describe, expect, it } from 'vitest';
import { forEachNeighbour6, rasterizeSeeds, voxelCount, type Dims } from '../volume';
import { fastGrowCut } from '../fastGrowCut';
import { graphCut } from '../graphCut';
import { alphaExpansion } from '../alphaExpansion';
import { regionCompetition, DEFAULT_REGION_COMPETITION } from '../regionCompetition';
import { estimateMemory } from '../memory';

const D: Dims = [32, 32, 12];
const SP = [1, 1, 3] as const;
const idx = (x: number, y: number, z: number, d: Dims = D) => x + d[0] * (y + d[1] * z);
/** A sphere (radius in mm, centre in voxels) as a mask over D. */
function sphere(cx: number, cy: number, cz: number, r: number, d: Dims = D): Uint8Array {
  return Uint8Array.from({ length: voxelCount(d) }, (_, i) => {
    const x = i % d[0], y = Math.floor(i / d[0]) % d[1], z = Math.floor(i / (d[0] * d[1]));
    return Math.hypot(x - cx, y - cy, (z - cz) * SP[2]) <= r ? 1 : 0;
  });
}
/** Image: `inside` in the mask, `outside` elsewhere, plus deterministic noise of ±noise. */
function imageOf(masks: Array<[Uint8Array, number]>, outside: number, noise: number): Float32Array {
  let s = 12345;
  const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  return Float32Array.from({ length: voxelCount(D) }, (_, i) => {
    let v = outside;
    for (const [m, val] of masks) if (m[i]) v = val;
    return v + noise * rand();
  });
}
const dice = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let inter = 0, sa = 0, sb = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i] ? 1 : 0, y = b[i] ? 1 : 0; inter += x & y; sa += x; sb += y; }
  return (2 * inter) / (sa + sb);
};
const ball = sphere(16, 16, 6, 8);
/** Foreground seeds in the ball's centre on two slices; background seeds in two corners. */
const seeds2 = () => rasterizeSeeds(D, [
  { cls: 1, z: 5, points: [[14, 16], [18, 16]], rx: 1.5, ry: 1.5 },
  { cls: 1, z: 7, points: [[16, 14], [16, 18]], rx: 1.5, ry: 1.5 },
  { cls: 2, z: 5, points: [[2, 2], [8, 2]], rx: 1.5, ry: 1.5 },
  { cls: 2, z: 7, points: [[29, 29], [29, 22]], rx: 1.5, ry: 1.5 },
]);

describe('volume helpers', () => {
  it('6-neighbours never wrap: the last voxel of a row has no +x neighbour, the last row of a slice no +y one', () => {
    const d: Dims = [4, 3, 2];
    const seen = (i: number) => { const out: number[] = []; forEachNeighbour6(d, i, (q) => out.push(q)); return out.sort((a, b) => a - b); };
    expect(seen(idx(3, 0, 0, d))).toEqual([idx(2, 0, 0, d), idx(3, 1, 0, d), idx(3, 0, 1, d)].sort((a, b) => a - b));
    expect(seen(idx(1, 2, 0, d))).toEqual([idx(0, 2, 0, d), idx(2, 2, 0, d), idx(1, 1, 0, d), idx(1, 2, 1, d)].sort((a, b) => a - b));
  });

  it('seeds are stamped along strokes; a later erasing stroke wins; strokes off the box are ignored', () => {
    const s = rasterizeSeeds(D, [
      { cls: 1, z: 3, points: [[5, 5], [15, 5]], rx: 1, ry: 1 },
      { cls: 0, z: 3, points: [[10, 5]], rx: 1, ry: 1 },
      { cls: 2, z: 99, points: [[1, 1]], rx: 1, ry: 1 },
    ]);
    expect(s[idx(5, 5, 3)]).toBe(1);
    expect(s[idx(15, 5, 3)]).toBe(1);
    expect(s[idx(10, 5, 3)]).toBe(0);
    expect(s[idx(5, 5, 4)]).toBe(0);
    expect(s.filter((v) => v === 2).length).toBe(0);
  });
});

describe('Fast GrowCut', () => {
  it('recovers the sphere from foreground and background seeds on two slices (Dice > 0.95)', () => {
    const img = imageOf([[ball, 100]], 0, 8);
    const out = fastGrowCut(img, D, seeds2());
    expect(dice(Uint8Array.from(out, (l) => (l === 1 ? 1 : 0)), ball)).toBeGreaterThan(0.95);
  });

  it('a class never jumps across a row or slice end (SegWorks\' wrap-around)', () => {
    // Two open rows that only the flat index makes adjacent: (x, 1, z0) and (x, 0, z1).
    const d: Dims = [3, 2, 2];
    const img = new Float32Array(12).fill(1000);
    for (let x = 0; x < 3; x++) { img[idx(x, 1, 0, d)] = 0; img[idx(x, 0, 1, d)] = 0; }
    const seeds = new Uint8Array(12);
    seeds[idx(0, 1, 0, d)] = 1;
    const out = fastGrowCut(img, d, seeds, { gate: { lo: -100, hi: 100 } });
    expect(out[idx(2, 1, 0, d)]).toBe(1);
    expect([0, 1, 2].map((x) => out[idx(x, 0, 1, d)])).toEqual([0, 0, 0]);
  });

  it('the intensity gate stops growth through out-of-range voxels (#110)', () => {
    const img = imageOf([[ball, 100]], 0, 0);
    const s = new Uint8Array(voxelCount(D));
    s[idx(16, 16, 6)] = 1;
    const gated = fastGrowCut(img, D, s, { gate: { lo: 50, hi: 150 } });
    expect(dice(gated, ball)).toBe(1); // only one class: everything reached is the ball
  });
});

describe('Graph Cut (binary)', () => {
  it('recovers the sphere (Dice > 0.95)', () => {
    const img = imageOf([[ball, 100]], 0, 8);
    expect(dice(graphCut(img, D, seeds2())!, ball)).toBeGreaterThan(0.95);
  });

  it('a higher λ gives a smoother boundary: less surface for the same seeds', () => {
    const img = imageOf([[ball, 100]], 0, 60);
    const surface = (m: Uint8Array) => { let s = 0; for (let i = 0; i < m.length; i++) if (m[i]) forEachNeighbour6(D, i, (q) => { if (!m[q]) s++; }); return s; };
    const lo = graphCut(img, D, seeds2(), { lambda: 5, sigma: 30 })!;
    const hi = graphCut(img, D, seeds2(), { lambda: 200, sigma: 30 })!;
    expect(surface(hi)).toBeLessThan(surface(lo));
  });

  it('seeds are hard: a foreground seed placed in background-looking tissue stays foreground', () => {
    const img = imageOf([[ball, 100]], 0, 0);
    const s = seeds2();
    s[idx(3, 28, 6)] = 1; // dark, far from the ball
    expect(graphCut(img, D, s)![idx(3, 28, 6)]).toBe(1);
  });

  it('needs seeds of both kinds', () => {
    const s = seeds2().map((v) => (v === 2 ? 0 : v));
    expect(graphCut(imageOf([[ball, 100]], 0, 0), D, Uint8Array.from(s))).toBeNull();
  });
});

describe('α-expansion (multi-label)', () => {
  const a = sphere(9, 16, 6, 6), b = sphere(23, 16, 6, 6);
  const img = imageOf([[a, 100], [b, 200]], 0, 8);
  // Classes: 0 Background, 1 A, 2 B (seed values are class + 1).
  const seeds = rasterizeSeeds(D, [
    { cls: 1, z: 1, points: [[2, 2], [29, 2], [29, 29], [2, 29]], rx: 1, ry: 1 },
    { cls: 1, z: 10, points: [[2, 2], [29, 29]], rx: 1, ry: 1 },
    { cls: 2, z: 6, points: [[8, 16], [10, 16]], rx: 1, ry: 1 },
    { cls: 3, z: 6, points: [[22, 16], [24, 16]], rx: 1, ry: 1 },
  ]);

  it('each structure gets its own class (Dice > 0.95) and the rest stays Background', () => {
    const r = alphaExpansion(img, D, SP, seeds, 3)!;
    expect(dice(Uint8Array.from(r.labels, (l) => (l === 1 ? 1 : 0)), a)).toBeGreaterThan(0.95);
    expect(dice(Uint8Array.from(r.labels, (l) => (l === 2 ? 1 : 0)), b)).toBeGreaterThan(0.95);
    expect(r.labels[idx(16, 2, 6)]).toBe(0);
  });

  it('never ends with a higher energy than it started from, and keeps every seed in its class', () => {
    const one = alphaExpansion(img, D, SP, seeds, 3, { ...alphaDefaults(), sweeps: 1 })!;
    const four = alphaExpansion(img, D, SP, seeds, 3, { ...alphaDefaults(), sweeps: 4 })!;
    expect(four.energy).toBeLessThanOrEqual(one.energy + 1e-6);
    for (let i = 0; i < seeds.length; i++) if (seeds[i]) expect(four.labels[i]).toBe(seeds[i] - 1);
  });

  it('the smoothness term matters: on a noisy image it beats the data term alone', () => {
    // Noise ±30 on steps of 100: the data term alone mislabels a quarter of A (Dice ≈ 0.75).
    const noisy = imageOf([[a, 100], [b, 200]], 0, 30);
    const fit = (smooth: number) => {
      const r = alphaExpansion(noisy, D, SP, seeds, 3, { ...alphaDefaults(), smooth })!;
      return dice(Uint8Array.from(r.labels, (l) => (l === 1 ? 1 : 0)), a);
    };
    expect(fit(6)).toBeGreaterThan(0.95);
    expect(fit(0.001)).toBeLessThan(0.85);
  });

  it('Background takes what resembles no seeded structure: an unseeded third intensity (air) is not given to A or B', () => {
    const air = sphere(16, 4, 6, 6); // a pocket of a fourth intensity, seeded by nobody
    const withAir = imageOf([[a, 100], [b, 200], [air, -1000]], 0, 8);
    const r = alphaExpansion(withAir, D, SP, seeds, 3, alphaDefaults(), undefined, 0)!;
    let wrong = 0, n = 0;
    for (let i = 0; i < air.length; i++) if (air[i]) { n++; if (r.labels[i] !== 0) wrong++; }
    expect(wrong / n).toBeLessThan(0.05);
  });

  it('needs two seeded classes', () => {
    expect(alphaExpansion(img, D, SP, Uint8Array.from(seeds, (v) => (v === 1 ? 1 : 0)), 3)).toBeNull();
  });
});

function alphaDefaults() {
  return { smooth: 6, sigma: 30, sweeps: 2, uInt: 0.75, uLoc: 0.25, locality: 0.65, intensity: 0.35, seedBias: 0.9 };
}

describe('Region competition (Chan-Vese)', () => {
  const img = imageOf([[ball, 120]], 20, 5);
  const loose = sphere(16, 16, 6, 11); // 3 mm too big
  const opts = { ...DEFAULT_REGION_COMPETITION, movable: new Set([0, 1]), clip: null };

  it('pulls a loose mask onto the sphere', () => {
    const out = regionCompetition(img, D, SP, loose, opts);
    expect(dice(out, ball)).toBeGreaterThan(0.95);
    expect(dice(out, ball)).toBeGreaterThan(dice(loose, ball));
  });

  it('does not depend on scan order: mirroring the input mirrors the result', () => {
    const flip = <T extends Uint8Array | Float32Array>(a: T): T => {
      const out = a.slice() as T;
      for (let i = 0; i < a.length; i++) { const x = i % D[0]; out[i - x + (D[0] - 1 - x)] = a[i]; }
      return out;
    };
    const direct = regionCompetition(img, D, SP, loose, opts);
    const mirrored = regionCompetition(flip(img), D, SP, flip(loose), opts);
    expect([...flip(mirrored)]).toEqual([...direct]);
  });

  it('labels that are not movable never change', () => {
    const init = loose.slice();
    for (let i = 0; i < init.length; i++) if (init[i] && i % D[0] > 16) init[i] = 2; // a second member on the right
    const out = regionCompetition(img, D, SP, init, opts);
    for (let i = 0; i < init.length; i++) if (init[i] === 2) expect(out[i]).toBe(2);
    for (let i = 0; i < init.length; i++) if (out[i] === 2) expect(init[i]).toBe(2);
  });

  it('cleanup 0 means off: a 2-voxel island survives; with cleanup 24 it goes', () => {
    const init = ball.slice();
    init[idx(2, 2, 6)] = 1; init[idx(3, 2, 6)] = 1;
    const bright = imageOf([[ball, 120]], 20, 0);
    bright[idx(2, 2, 6)] = 120; bright[idx(3, 2, 6)] = 120;
    const keep = regionCompetition(bright, D, SP, init, { ...opts, cleanup: 0, iterations: 1, smoothXY: 0, smoothZ: 0 });
    const clean = regionCompetition(bright, D, SP, init, { ...opts, cleanup: 24, iterations: 1, smoothXY: 0, smoothZ: 0 });
    expect(keep[idx(2, 2, 6)]).toBe(1);
    expect(clean[idx(2, 2, 6)]).toBe(0);
  });
});

describe('memory guard', () => {
  it('estimate line, amber, then blocked with a reason', () => {
    expect(estimateMemory('graphCut', 1_000_000).level).toBe('ok');
    expect(estimateMemory('graphCut', 1_000_000).text).toBe('1.0 M voxels · est. 134 MB');
    expect(estimateMemory('graphCut', 5_000_000).level).toBe('warn');
    const big = estimateMemory('graphCut', 12_000_000);
    expect(big.level).toBe('block');
    expect(big.reason).toMatch(/narrow the domain/);
    expect(estimateMemory('alphaExpansion', 1_000_000, 4).bytes).toBeGreaterThan(estimateMemory('alphaExpansion', 1_000_000, 2).bytes);
  });
});
