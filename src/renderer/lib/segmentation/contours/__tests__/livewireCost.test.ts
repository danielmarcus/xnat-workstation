/**
 * Live Wire costs (branch 6, F1; #75–79): on a vertical step edge the cheap pixels are on
 * the edge, links along it are cheaper than links across it, and each option does what it
 * claims.
 */
import { describe, expect, it } from 'vitest';
import { directionCost, gaussianBlur, linkCost, livewireCostMaps } from '../livewireCost';

const W = 40, H = 40;
/** Dark left half (0), bright right half (1); the step lies between x = 19 and x = 20. */
const step = Float32Array.from({ length: W * H }, (_, i) => (i % W >= 20 ? 1 : 0));
const col = (a: Float32Array, x: number) => a[20 * W + x];

describe('livewireCostMaps', () => {
  it('the gradient cost is lowest at the edge and 1 on flat image', () => {
    const m = livewireCostMaps(step, W, H, { preSmoothSigma: 0 });
    expect(Math.min(col(m.gradientCost, 19), col(m.gradientCost, 20))).toBeLessThan(0.05);
    expect(col(m.gradientCost, 5)).toBeCloseTo(1, 6);
    expect(col(m.gradientCost, 35)).toBeCloseTo(1, 6);
  });

  it('the Laplacian cue marks the edge (0) and nothing on flat image', () => {
    const m = livewireCostMaps(step, W, H, { preSmoothSigma: 0.8 });
    expect(Math.min(col(m.laplacianCue, 19), col(m.laplacianCue, 20))).toBe(0);
    expect(col(m.laplacianCue, 5)).toBe(1);
    expect(col(m.laplacianCue, 35)).toBe(1);
  });

  it('pre-smoothing stops a single noisy pixel from looking like a boundary', () => {
    const noisy = Float32Array.from(step);
    noisy[20 * W + 8] = 1; // one bright speck in the dark half
    const raw = livewireCostMaps(noisy, W, H, { preSmoothSigma: 0 });
    const smooth = livewireCostMaps(noisy, W, H, { preSmoothSigma: 1.5 });
    const speck = (m: ReturnType<typeof livewireCostMaps>) => m.gradientCost[20 * W + 9];
    expect(speck(smooth)).toBeGreaterThan(speck(raw));
  });

  it('Scharr and Sobel both find the edge', () => {
    for (const edgeKernel of ['scharr', 'sobel'] as const) {
      const m = livewireCostMaps(step, W, H, { preSmoothSigma: 0, edgeKernel });
      expect(Math.min(col(m.gradientCost, 19), col(m.gradientCost, 20))).toBeLessThan(0.05);
    }
  });
});

describe('link costs', () => {
  const m = livewireCostMaps(step, W, H, { preSmoothSigma: 0.8 });

  it('a link along the edge is cheaper than a link across it', () => {
    expect(directionCost(m, 20, 10, 20, 11)).toBeLessThan(directionCost(m, 19, 10, 20, 10));
    expect(linkCost(m, 20, 10, 20, 11)).toBeLessThan(linkCost(m, 18, 10, 17, 10));
  });

  it('a higher direction weight widens the gap between along-edge and across-edge links', () => {
    const gap = (directionWeight: number) => linkCost(m, 19, 10, 20, 10, { directionWeight }) - linkCost(m, 20, 10, 20, 11, { directionWeight });
    expect(gap(0.6)).toBeGreaterThan(gap(0.05));
  });

  it('weights scale their own term', () => {
    expect(linkCost(m, 5, 10, 5, 11, { gradientWeight: 1, laplacianWeight: 0, directionWeight: 0 }))
      .toBeGreaterThan(linkCost(m, 5, 10, 5, 11, { gradientWeight: 0.2, laplacianWeight: 0, directionWeight: 0 }));
  });
});

describe('gaussianBlur', () => {
  it('preserves the mean and σ = 0 is a copy', () => {
    const img = Float32Array.from({ length: 100 }, (_, i) => (i * 7) % 13);
    const b = gaussianBlur(img, 10, 10, 1.2);
    const mean = (a: ArrayLike<number>) => Array.from(a).reduce((s, v) => s + v, 0) / a.length;
    expect(mean(b)).toBeCloseTo(mean(img), 0);
    expect(Array.from(gaussianBlur(img, 10, 10, 0))).toEqual(Array.from(img));
  });
});
