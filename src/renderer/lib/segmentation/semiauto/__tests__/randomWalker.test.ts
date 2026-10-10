/**
 * Random Walker (branch 4): with seeds inside and outside a bright disc, the walker's
 * boundary follows the disc's edge; without edge weighting (β = 0) it does not.
 */
import { describe, expect, it } from 'vitest';
import { randomWalker } from '../randomWalker';

const W = 48;
const H = 48;
const disc = (r: number) => {
  const d = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x - 24) ** 2 + (y - 24) ** 2 <= r * r) d[x + y * W] = 1;
  return d;
};
const truth = disc(10);
const image = Float32Array.from(truth, (v, i) => (v ? 900 : 100) + ((i * 7919) % 13)); // with a little noise
const fg = disc(2);
const bg = new Uint8Array(W * H);
for (let i = 0; i < W; i++) { bg[i] = 1; bg[i + (H - 1) * W] = 1; bg[i * W] = 1; bg[W - 1 + i * W] = 1; }

const iou = (a: Uint8Array, b: Uint8Array) => {
  let inter = 0, uni = 0;
  for (let i = 0; i < a.length; i++) { if (a[i] && b[i]) inter++; if (a[i] || b[i]) uni++; }
  return inter / uni;
};

describe('randomWalker', () => {
  it('follows the image edge between the seeds', () => {
    const r = randomWalker({ width: W, height: H, image, fg, bg, beta: 90 });
    expect(iou(r.mask, truth)).toBeGreaterThan(0.95);
  });

  it('seeds keep their labels and probabilities lie in [0, 1]', () => {
    const r = randomWalker({ width: W, height: H, image, fg, bg, beta: 90 });
    expect(r.probability[24 + 24 * W]).toBe(1);
    expect(r.probability[0]).toBe(0);
    expect(Math.min(...r.probability)).toBeGreaterThanOrEqual(-1e-6);
    expect(Math.max(...r.probability)).toBeLessThanOrEqual(1 + 1e-6);
  });

  it('without edge weighting the boundary ignores the image', () => {
    const r = randomWalker({ width: W, height: H, image, fg, bg, beta: 0 });
    expect(iou(r.mask, truth)).toBeLessThan(0.8);
  });

  it('stops early once labels stop changing', () => {
    const r = randomWalker({ width: W, height: H, image, fg, bg, beta: 90, maxIterations: 5000 });
    expect(r.iterations).toBeLessThan(5000);
  });
});
