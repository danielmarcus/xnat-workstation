/**
 * Level Trace (branch 4): a click returns the connected region of similar intensity;
 * the edge guard, the air guard, fuzzy growth and outline simplification each do what
 * they claim on synthetic images with a known answer.
 */
import { describe, expect, it } from 'vitest';
import { chaikin, DEFAULT_LEVEL_TRACE, guardFromSamples, levelTrace, rasterize, simplify, traceBoundary } from '../levelTrace';

const W = 50;
const H = 50;
const area = (d: Uint8Array) => d.reduce((s, v) => s + v, 0);
const discMask = (cx: number, cy: number, r: number) => {
  const d = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) d[x + y * W] = 1;
  return d;
};

describe('levelTrace', () => {
  it('outline simplification and rounding keep the whole region — every edge row and column', () => {
    // The outline runs through the boundary pixels' centres; a half-open fill dropped the bottom row.
    const img = new Float32Array(W * H);
    for (let y = 20; y < 30; y++) for (let x = 20; x < 30; x++) img[x + y * W] = 300;
    for (const o of [{ simplifyPx: 1, roundCorners: 0 }, { simplifyPx: 0, roundCorners: 1 }, { simplifyPx: 1, roundCorners: 1 }]) {
      const r = levelTrace(img, W, H, 25, 25, { ...DEFAULT_LEVEL_TRACE, ...o });
      for (const y of [20, 29]) {
        // Rounded corners cut the corner pixels; the edge row itself stays.
        if (o.roundCorners) expect(r.data[y * W + 25], `row ${y} ${JSON.stringify(o)}`).toBe(1);
        else expect(r.data.slice(y * W + 20, y * W + 30).every((v) => v === 1), `row ${y} ${JSON.stringify(o)}`).toBe(true);
      }
      expect(area(r.data), JSON.stringify(o)).toBeGreaterThanOrEqual(o.roundCorners ? 88 : 100); // rounding cuts corner pixels only
    }
  });

  it('traces the clicked region when smoothing leaves two — not the first in scan order', () => {
    const img = new Float32Array(W * H);
    for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) img[x + y * W] = 300; // first in scan order
    for (let y = 30; y < 42; y++) for (let x = 30; x < 42; x++) img[x + y * W] = 300; // clicked
    for (let x = 14; x < 31; x++) img[x + 22 * W] = 300; // a one-pixel bridge smoothing removes
    for (let y = 14; y < 23; y++) img[14 + y * W] = 300;
    for (let y = 22; y < 31; y++) img[30 + y * W] = 300;
    const r = levelTrace(img, W, H, 35, 35, { ...DEFAULT_LEVEL_TRACE, smoothing: 'standard', simplifyPx: 1 });
    expect(r.data[35 + 35 * W], 'the clicked square').toBe(1);
    expect(r.data[10 + 10 * W], 'not the other one').toBe(0);
  });

  it('returns the connected region of similar intensity around the click', () => {
    const img = Float32Array.from(discMask(25, 25, 10), (v) => (v ? 300 : 0));
    const r = levelTrace(img, W, H, 25, 25, DEFAULT_LEVEL_TRACE);
    expect(area(r.data)).toBe(area(discMask(25, 25, 10)));
  });

  it('a second region of the same intensity, not connected, is left out', () => {
    const img = Float32Array.from(discMask(15, 25, 6), (v) => (v ? 300 : 0));
    for (let i = 0; i < img.length; i++) if (discMask(38, 25, 6)[i]) img[i] = 300;
    const r = levelTrace(img, W, H, 15, 25, DEFAULT_LEVEL_TRACE);
    expect(r.data[38 + 25 * W]).toBe(0);
  });

  it('the edge guard stops at a step the band would cross', () => {
    // Two touching regions, 60 and 140 HU: a ±100 band includes both; a strong guard stops at the step.
    const img = Float32Array.from({ length: W * H }, (_, i) => ((i % W) < 25 ? 60 : 140));
    const loose = levelTrace(img, W, H, 10, 25, { ...DEFAULT_LEVEL_TRACE, huTolerance: 100 });
    const guarded = levelTrace(img, W, H, 10, 25, { ...DEFAULT_LEVEL_TRACE, huTolerance: 100, edgeGuard: 'strong' });
    expect(area(loose.data)).toBe(W * H);
    expect(guarded.data[40 + 25 * W]).toBe(0);
    expect(guarded.data[5 + 25 * W]).toBe(1);
  });

  it('the CT air guard never takes air', () => {
    const img = Float32Array.from({ length: W * H }, (_, i) => ((i % W) < 25 ? -400 : -900));
    const r = levelTrace(img, W, H, 10, 25, { ...DEFAULT_LEVEL_TRACE, huTolerance: 600 });
    expect(r.data[40 + 25 * W]).toBe(0);
    const off = levelTrace(img, W, H, 10, 25, { ...DEFAULT_LEVEL_TRACE, huTolerance: 600, airGuard: false });
    expect(off.data[40 + 25 * W]).toBe(1);
  });

  it('MR adaptive band comes from the local window, not an HU tolerance', () => {
    const img = Float32Array.from(discMask(25, 25, 10), (v, i) => (v ? 500 + (i % 5) : 50));
    const r = levelTrace(img, W, H, 25, 25, { ...DEFAULT_LEVEL_TRACE, modality: 'mr', sigmaK: 3 });
    expect(area(r.data)).toBe(area(discMask(25, 25, 10)));
  });

  it('fuzzy growth keeps a gradual ramp connected that a binary band cuts', () => {
    // Intensity drifts from 100 to 300 across the image: the click's ±50 band covers a strip,
    // fuzzy connectedness follows the gradual drift further.
    const img = Float32Array.from({ length: W * H }, (_, i) => 100 + (i % W) * 4);
    const binary = levelTrace(img, W, H, 2, 25, { ...DEFAULT_LEVEL_TRACE, huTolerance: 50, airGuard: false });
    const fuzzy = levelTrace(img, W, H, 2, 25, { ...DEFAULT_LEVEL_TRACE, huTolerance: 50, growth: 'fuzzy', fuzzyThreshold: 0.3, airGuard: false });
    expect(area(fuzzy.data)).toBeGreaterThan(area(binary.data));
  });

  it('…but fuzzy growth still stops at a sharp jump', () => {
    // A gentle ramp, then a cliff to a very different value: the drift is followed, the cliff is not.
    const img = Float32Array.from({ length: W * H }, (_, i) => ((i % W) < 30 ? 100 + (i % W) * 3 : 3000));
    const fuzzy = levelTrace(img, W, H, 2, 25, { ...DEFAULT_LEVEL_TRACE, huTolerance: 50, growth: 'fuzzy', fuzzyThreshold: 0.3, airGuard: false });
    expect(fuzzy.data[40 + 25 * W]).toBe(0);
  });

  it('the intensity guard keeps only pixels inside its range, even where the band reaches further', () => {
    // A +70 core (r 6) inside +40 tissue (r 15): the band (±100 HU) takes both; a 60–80
    // guard takes only the core.
    const img = Float32Array.from({ length: W * H }, (_, i) => (discMask(25, 25, 6)[i] ? 70 : discMask(25, 25, 15)[i] ? 40 : -1000));
    expect(area(levelTrace(img, W, H, 25, 25, { ...DEFAULT_LEVEL_TRACE, fillHoles: false }).data)).toBe(area(discMask(25, 25, 15)));
    const r = levelTrace(img, W, H, 25, 25, { ...DEFAULT_LEVEL_TRACE, fillHoles: false, guard: { lo: 60, hi: 80 } });
    expect(area(r.data)).toBe(area(discMask(25, 25, 6)));
  });

  it('a click outside the image gives nothing', () => {
    const img = new Float32Array(W * H);
    expect(area(levelTrace(img, W, H, -1, 3, DEFAULT_LEVEL_TRACE).data)).toBe(0);
  });
});

describe('guardFromSamples', () => {
  it('reads the 2nd–98th percentile of the ROI, so a few stray pixels do not widen it', () => {
    const vals = [...Array(98).fill(70), -1000, 1000];
    expect(guardFromSamples(vals)).toEqual({ lo: 70, hi: 70 });
    const ramp = Array.from({ length: 101 }, (_, i) => i);
    expect(guardFromSamples(ramp)).toEqual({ lo: 2, hi: 98 });
    expect(guardFromSamples([])).toBeNull();
  });
});

describe('outline tools', () => {
  it('trace → rasterize round-trips a convex shape closely', () => {
    const m = { width: W, height: H, data: discMask(25, 25, 10) };
    const back = rasterize(traceBoundary(m), W, H);
    let diff = 0;
    for (let i = 0; i < back.length; i++) if (back[i] !== m.data[i]) diff++;
    expect(diff / area(m.data)).toBeLessThan(0.15);
  });
  it('simplification drops collinear points; Chaikin doubles the vertex count', () => {
    const square: Array<[number, number]> = [[0, 0], [1, 0], [2, 0], [3, 0], [3, 3], [0, 3]];
    expect(simplify(square, 0.5).length).toBeLessThan(square.length);
    expect(chaikin([[0, 0], [4, 0], [4, 4], [0, 4]], 1)).toHaveLength(8);
  });
});
