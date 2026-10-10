/**
 * Shape-based interpolation (SegWorks parity branch 3 I1). Synthetic anchors whose
 * correct intermediates are known: concentric discs (the middle is a disc of middle
 * radius), a square that moves (the middle sits halfway), two-part masks (stay two).
 */
import { describe, expect, it } from 'vitest';
import type { MaskPlane } from '../../maskOps/plane';
import { labelComponents } from '../../maskOps/plane';
import { chamferDT, exactEDT, signedDistance } from '../distance';
import { components, findGaps, imageGuided, INTERPOLATORS, morphology, sdfArea, sdfLinear, volumeMorphology } from '../interpolate';

const W = 41;
const H = 41;
const area = (p: MaskPlane) => p.data.reduce((s, v) => s + (v ? 1 : 0), 0);

function disc(cx: number, cy: number, r: number): MaskPlane {
  const data = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) data[x + y * W] = 1;
  return { width: W, height: H, data };
}
function square(x0: number, y0: number, s: number): MaskPlane {
  const data = new Uint8Array(W * H);
  for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) data[x + y * W] = 1;
  return { width: W, height: H, data };
}
function union(...ps: MaskPlane[]): MaskPlane {
  const data = new Uint8Array(W * H);
  for (const p of ps) for (let i = 0; i < data.length; i++) if (p.data[i]) data[i] = 1;
  return { width: W, height: H, data };
}
const centroidX = (p: MaskPlane) => {
  let s = 0, n = 0;
  for (let i = 0; i < p.data.length; i++) if (p.data[i]) { s += i % W; n++; }
  return s / n;
};

describe('distance transforms', () => {
  it('exact EDT is Euclidean', () => {
    const seed = new Uint8Array(25);
    seed[0] = 1;
    const d = exactEDT(seed, 5, 5);
    expect(d[4 + 4 * 5]).toBeCloseTo(Math.sqrt(32), 5);
    expect(d[3]).toBeCloseTo(3, 5);
  });
  it('chamfer is within ~8% of Euclidean', () => {
    const seed = new Uint8Array(W * H);
    seed[20 + 20 * W] = 1;
    const e = exactEDT(seed, W, H);
    const c = chamferDT(seed, W, H);
    for (const i of [0, 7 + 31 * W, 40 + 3 * W]) expect(Math.abs(c[i] - e[i]) / e[i]).toBeLessThan(0.09);
  });
  it('signed distance is negative inside, positive outside', () => {
    const s = signedDistance(disc(20, 20, 5).data, W, H);
    expect(s[20 + 20 * W]).toBeLessThan(0);
    expect(s[0]).toBeGreaterThan(0);
  });
});

describe('interpolators', () => {
  const small = disc(20, 20, 4);
  const big = disc(20, 20, 12);

  it('every method returns the anchors exactly at α = 0 and α = 1', () => {
    for (const fn of Object.values(INTERPOLATORS)) {
      expect(Array.from(fn(small, big, 0).data)).toEqual(Array.from(small.data));
      expect(Array.from(fn(small, big, 1).data)).toEqual(Array.from(big.data));
    }
  });

  it('linear SDF: concentric discs give a disc of intermediate radius', () => {
    // Radii 4 and 12 → the middle is radius 8 (the SDF of concentric discs blends exactly).
    const mid = sdfLinear(small, big, 0.5);
    const r8 = area(disc(20, 20, 8));
    expect(Math.abs(area(mid) - r8) / r8).toBeLessThan(0.05);
  });

  it('linear SDF cannot move a shape: between far-apart anchors the middle is empty', () => {
    // A known limit of shape-based blending — why morphology aligns non-overlapping anchors.
    expect(area(sdfLinear(square(2, 15, 9), square(28, 15, 9), 0.5))).toBe(0);
  });

  it('area-preserving SDF and volume-accurate morphology hit the linear target area', () => {
    for (const alpha of [0.25, 0.5, 0.75]) {
      const target = Math.round(area(small) * (1 - alpha) + area(big) * alpha);
      expect(area(sdfArea(small, big, alpha))).toBe(target);
      expect(area(volumeMorphology(small, big, alpha))).toBe(target);
    }
  });

  it('morphology keeps the shared core and stays inside the union', () => {
    const a = disc(18, 20, 8);
    const b = disc(23, 20, 8);
    const mid = morphology(a, b, 0.5).data;
    for (let i = 0; i < mid.length; i++) {
      if (a.data[i] && b.data[i]) expect(mid[i]).toBe(1);
      if (!a.data[i] && !b.data[i]) expect(mid[i]).toBe(0);
    }
  });

  it('morphology moves a shape whose anchors do not overlap (SegWorks went empty)', () => {
    const mid = morphology(square(2, 15, 9), square(28, 15, 9), 0.5);
    expect(area(mid)).toBe(81); // one whole square…
    expect(labelComponents(mid.data, W, H).count).toBe(1);
    expect(centroidX(mid)).toBeCloseTo(19, 0); // …halfway across
    expect(Math.abs(centroidX(morphology(square(2, 15, 9), square(28, 15, 9), 0.25)) - 12.5)).toBeLessThanOrEqual(1); // whole-pixel placement
  });

  it('component matching keeps two parts two', () => {
    const a = union(disc(10, 20, 4), disc(30, 20, 4));
    const b = union(disc(11, 20, 6), disc(29, 20, 6));
    const mid = components(a, b, 0.5);
    expect(labelComponents(mid.data, W, H).count).toBe(2);
  });

  it('component matching fades a part present in only one anchor', () => {
    const a = union(disc(10, 20, 5), disc(30, 20, 5));
    const b = disc(10, 20, 5);
    const mid = components(a, b, 0.5);
    const right = Array.from(mid.data).filter((v, i) => v && i % W > 20).length;
    expect(right).toBeGreaterThan(0);
    expect(right).toBeLessThan(area(disc(30, 20, 5)));
  });

  it('image-guided snap moves the boundary toward a real edge', () => {
    // The image's edge is at radius 10; the shape prior at α = 0.5 is about radius 8.
    const image = new Float32Array(W * H);
    for (let i = 0; i < image.length; i++) image[i] = disc(20, 20, 10).data[i] ? 1000 : 0;
    const prior = sdfLinear(small, big, 0.5);
    const snapped = imageGuided(small, big, 0.5, { image });
    expect(area(snapped)).toBeGreaterThan(area(prior));
    expect(area(snapped)).toBeLessThanOrEqual(area(disc(20, 20, 10)) * 1.1); // at the edge, within rounding
  });
});

describe('findGaps', () => {
  it('interior empty runs between filled slices; leading/trailing empties are not gaps', () => {
    expect(findGaps([0, 1, 0, 0, 1, 0, 1, 0])).toEqual([{ from: 2, to: 3 }, { from: 5, to: 5 }]);
    expect(findGaps([1, 1, 1])).toEqual([]);
  });
});
