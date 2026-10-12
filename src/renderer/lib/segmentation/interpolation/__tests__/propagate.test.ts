/**
 * Mask propagation (branch 3 I3): follows a structure whose intensity matches, stops at
 * its edge, refuses runaways, and stays connected to the previous slice.
 */
import { describe, expect, it } from 'vitest';
import type { MaskPlane } from '../../maskOps/plane';
import { DEFAULT_PROPAGATE, intensityReference, propagateStep, zSmooth } from '../propagate';

const W = 40;
const H = 40;
const disc = (cx: number, cy: number, r: number): MaskPlane => {
  const data = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) data[x + y * W] = 1;
  return { width: W, height: H, data };
};
/** An image: background 40 HU, a 1000 HU disc. */
const image = (cx: number, r: number) => {
  const d = disc(cx, 20, r).data;
  return Float32Array.from(d, (v) => (v ? 1000 : 40));
};
const area = (p: MaskPlane | null) => (p ? p.data.reduce((s, v) => s + v, 0) : 0);

describe('propagateStep', () => {
  const seed = disc(20, 20, 6);
  const ref = intensityReference(seed, image(20, 6), true)!;

  it('follows the bright structure as it shifts and grows, and never into the background', () => {
    const next = propagateStep(seed, image(21, 7), ref, DEFAULT_PROPAGATE)!;
    expect(next).not.toBeNull();
    const img = image(21, 7);
    for (let i = 0; i < next.data.length; i++) if (next.data[i]) expect(img[i]).toBe(1000);
    expect(area(next)).toBeGreaterThan(area(seed));
  });

  it('a small seed takes the whole structure on the next slice when compared with the structure, not the seed', () => {
    const tiny = disc(20, 20, 1);
    const img = image(20, 7);
    const r = intensityReference(tiny, img, true)!;
    expect(propagateStep(tiny, img, r, DEFAULT_PROPAGATE), 'vs the seed it looks like a leak').toBeNull();
    const structure = area(disc(20, 20, 7));
    const next = propagateStep(tiny, img, r, DEFAULT_PROPAGATE, structure)!;
    expect(area(next)).toBe(structure);
  });

  it('stops where the structure ends', () => {
    expect(propagateStep(seed, Float32Array.from({ length: W * H }, () => 40), ref, DEFAULT_PROPAGATE)).toBeNull();
  });

  it('refuses a runaway: an abrupt area jump stops the walk', () => {
    // The next slice's bright region is huge — the area would more than double.
    const runaway = propagateStep(seed, image(20, 19), ref, { ...DEFAULT_PROPAGATE, growPx: 20, maxAreaChange: 0.6 });
    expect(runaway).toBeNull();
    const allowed = propagateStep(seed, image(20, 19), ref, { ...DEFAULT_PROPAGATE, growPx: 20, maxAreaChange: 100 });
    expect(area(allowed)).toBeGreaterThan(area(seed) * 2);
  });

  it('keeps only the part connected to the previous slice', () => {
    const img = image(20, 6);
    // A second bright blob far away, within the grow radius only of nothing.
    for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) img[x + y * W] = 1000;
    const next = propagateStep(seed, img, ref, { ...DEFAULT_PROPAGATE, growPx: 30 })!;
    expect(next.data[3 + 3 * W]).toBe(0);
  });

  it('MR mode uses a σ window around the reference', () => {
    const mrSeed = disc(20, 20, 6);
    const img = Float32Array.from(disc(20, 20, 8).data, (v, i) => (v ? 500 + (i % 7) : 100));
    const r = intensityReference(mrSeed, img, false)!;
    const next = propagateStep(mrSeed, img, r, { ...DEFAULT_PROPAGATE, modality: 'mr', sigma: 3, maxAreaChange: 1 })!;
    expect(area(next)).toBeGreaterThan(area(mrSeed));
  });
});

describe('zSmooth', () => {
  it('removes a pixel present on one slice only and fills one missing on one slice only', () => {
    const a = disc(20, 20, 5);
    const b = { ...a, data: new Uint8Array(a.data) };
    b.data[0] = 1; // stray on the middle slice
    b.data[20 + 20 * W] = 0; // pinhole on the middle slice
    const [, mid] = zSmooth([a, b, a], 0);
    expect(mid.data[0]).toBe(0);
    expect(mid.data[20 + 20 * W]).toBe(1);
  });
});
