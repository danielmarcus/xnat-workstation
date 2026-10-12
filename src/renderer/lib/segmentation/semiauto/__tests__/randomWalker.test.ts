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

  it('does not stop before the walk has spread across a large region', () => {
    // A seed of r 2 at the centre of a r 100 disc: CG starts every probability at 0.5 and
    // spreads slowly, so few labels flip for a while long before the answer converges.
    const N = 256, R = 100;
    const img = new Float32Array(N * N), f = new Uint8Array(N * N), b = new Uint8Array(N * N);
    const big = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const r = Math.hypot(x - N / 2, y - N / 2), i = x + y * N;
      img[i] = (r <= R ? 900 : 100) + ((i * 7919) % 13);
      if (r <= R) big[i] = 1;
      if (r <= 2) f[i] = 1;
      if (x === 0 || y === 0 || x === N - 1 || y === N - 1) b[i] = 1;
    }
    const r = randomWalker({ width: N, height: N, image: img, fg: f, bg: b, beta: 90 });
    let missed = 0;
    for (let i = 0; i < big.length; i++) if (big[i] !== r.mask[i]) missed++;
    expect(missed).toBeLessThan(10);
  });

  it('regions walled off from every seed are not foreground', () => {
    // The anatomy phantom cropped as the tool crops it (seeds' box + 20 px): body (+40) in
    // air (−1000), a +70 lesion beside a +1000 core, a foreground stroke in the lesion and a
    // background diamond around it. The air in the crop's corners touches the body only
    // across a huge edge — it must not come back as foreground.
    const W = 73, H = 73;
    const img = new Float32Array(W * H), f = new Uint8Array(W * H), b = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const X = x - 11, Y = y - 36, i = x + y * W;
      const r = Math.hypot(X, Y), lr = Math.hypot(X - 25, Y);
      img[i] = r <= 14 ? 1000 : lr <= 8 ? 70 : r <= 50 ? 40 : -1000;
      if (Math.abs(Y) <= 2 && X >= 20 && X <= 30) f[i] = 1;
      if (Math.abs(Math.abs(X - 25) + Math.abs(Y) - 14) <= 1.5) b[i] = 1;
    }
    const r = randomWalker({ width: W, height: H, image: img, fg: f, bg: b, beta: 2000 });
    let air = 0, lesion = 0;
    for (let i = 0; i < r.mask.length; i++) if (r.mask[i]) (img[i] === -1000 ? air++ : img[i] === 70 ? lesion++ : 0);
    expect(air).toBe(0);
    expect(lesion).toBeGreaterThan(150);
  });

  it('stops early once labels stop changing', () => {
    const r = randomWalker({ width: W, height: H, image, fg, bg, beta: 90, maxIterations: 5000 });
    expect(r.iterations).toBeLessThan(5000);
  });
});
