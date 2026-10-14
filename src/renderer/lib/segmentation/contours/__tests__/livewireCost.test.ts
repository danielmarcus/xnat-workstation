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

  it('weights set the balance between the terms (only their ratio matters)', () => {
    const only = (w: Partial<{ gradientWeight: number; laplacianWeight: number; directionWeight: number }>) =>
      linkCost(m, 5, 10, 5, 11, { gradientWeight: 0, laplacianWeight: 0, directionWeight: 0, ...w });
    expect(only({ gradientWeight: 1 })).toBeCloseTo(only({ gradientWeight: 0.2 }), 12);
    const g = only({ gradientWeight: 1 }), d = only({ directionWeight: 1 });
    expect(only({ gradientWeight: 3, directionWeight: 1 })).toBeCloseTo((3 * g + d) / 4, 12);
  });

  it('every link costs less than 1 — whatever the sliders (Cornerstone\'s 256-bucket queue needs it)', () => {
    for (const w of [{ gradientWeight: 1, laplacianWeight: 1, directionWeight: 1 }, { gradientWeight: 0.85, laplacianWeight: 0.12, directionWeight: 0.15 }, { gradientWeight: 0, laplacianWeight: 0, directionWeight: 1 }]) {
      let max = 0;
      for (let y = 1; y < m.height - 1; y++) for (let x = 1; x < m.width - 1; x++) {
        for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) max = Math.max(max, linkCost(m, x, y, x + dx, y + dy, w));
      }
      expect(max, JSON.stringify(w)).toBeLessThan(1);
    }
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
