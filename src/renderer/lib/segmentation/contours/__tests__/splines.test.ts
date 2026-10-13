/**
 * Spline families (branch 6, F1; #93–99): each family's defining property, on control
 * points with a known answer.
 */
import { describe, expect, it } from 'vitest';
import { refineTowardEdges, splinePath, splineSegments, SPLINE_ALGORITHMS, type Point, type SplineAlgorithm } from '../splines';

const square: Point[] = [{ x: 10, y: 10 }, { x: 40, y: 10 }, { x: 40, y: 40 }, { x: 10, y: 40 }];
const nearest = (curve: Point[], p: Point) => Math.min(...curve.map((c) => Math.hypot(c.x - p.x, c.y - p.y)));

/**
 * A staircase: a flat run at y = 10 meets a vertical rise at x = 50. An interpolating
 * spline that ignores spacing (Catmull-Rom) dips below the flat run before the rise;
 * monotone cubic and Akima keep it flat.
 */
const stair: Point[] = [
  { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 10 }, { x: 40, y: 10 }, { x: 50, y: 10 },
  { x: 50, y: 30 }, { x: 0, y: 30 },
];
/** Samples strictly between control points (40,10) and (50,10). */
const flatRun = (curve: Point[]) => curve.filter((p) => p.x > 40.5 && p.x < 49.5 && p.y < 20);

describe('splinePath', () => {
  it.each(SPLINE_ALGORITHMS.filter((a) => a.interpolating).map((a) => a.id))('%s passes through every control point', (algo) => {
    const curve = splinePath(square, algo as SplineAlgorithm);
    for (const p of square) expect(nearest(curve, p)).toBeLessThan(1e-6);
  });

  it('cubic B-spline approximates: it misses the control points and stays inside their hull', () => {
    const curve = splinePath(square, 'cubicBSpline');
    for (const p of square) expect(nearest(curve, p)).toBeGreaterThan(1);
    for (const c of curve) {
      expect(c.x).toBeGreaterThanOrEqual(10 - 1e-9);
      expect(c.x).toBeLessThanOrEqual(40 + 1e-9);
      expect(c.y).toBeGreaterThanOrEqual(10 - 1e-9);
      expect(c.y).toBeLessThanOrEqual(40 + 1e-9);
    }
  });

  it('Catmull-Rom dips below a flat run before a sharp rise; monotone cubic and Akima stay flat', () => {
    const cr = flatRun(splinePath(stair, 'centripetalCR'));
    expect(Math.min(...cr.map((p) => p.y))).toBeLessThan(9.9);
    for (const algo of ['monotoneCubic', 'akima'] as const) {
      const run = flatRun(splinePath(stair, algo));
      expect(run.length).toBeGreaterThan(5);
      for (const p of run) expect(p.y).toBeCloseTo(10, 6);
    }
  });

  it('monotone cubic never leaves the range of the two points it joins', () => {
    const curve = splinePath(stair, 'monotoneCubic', { samplesPerSegment: 30 });
    // Between (20,0) and (30,10): y within [0, 10] and x within [20, 30].
    const seg = curve.filter((p) => p.x > 20 && p.x < 30 && p.y < 20);
    expect(seg.length).toBeGreaterThan(5);
    for (const p of seg) {
      expect(p.y).toBeGreaterThanOrEqual(-1e-9);
      expect(p.y).toBeLessThanOrEqual(10 + 1e-9);
    }
  });

  it('monotone cubic does not overshoot a local extreme (the curve peaks at the peak point)', () => {
    // An asymmetric peak at (10, 10): unequal spacing either side makes an averaged slope
    // non-zero, which would carry the curve above y = 10.
    const peak = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 14, y: 0 }, { x: 10, y: -10 }];
    const curve = splinePath(peak, 'monotoneCubic', { samplesPerSegment: 40 });
    expect(Math.max(...curve.map((p) => p.y))).toBeLessThanOrEqual(10 + 1e-9);
    expect(Math.max(...curve.map((p) => p.x))).toBeLessThanOrEqual(14 + 1e-9);
  });

  it('more tension pulls the cardinal curve toward the control polygon', () => {
    const maxBulge = (tension: number) => {
      const curve = splinePath(square, 'localCR', { tension });
      // Distance outside the square's edges.
      return Math.max(...curve.map((p) => Math.max(10 - p.x, p.x - 40, 10 - p.y, p.y - 40, 0)));
    };
    expect(maxBulge(0.9)).toBeLessThan(maxBulge(0));
  });

  it('tension spline allows more tension than local Catmull-Rom+ (0.98 vs 0.95)', () => {
    const a = splinePath(square, 'localCR', { tension: 0.98 });
    const b = splinePath(square, 'tensionSpline', { tension: 0.98 });
    expect(a).not.toEqual(b);
  });

  it('fewer than three points are returned as they are', () => {
    expect(splinePath([{ x: 1, y: 2 }, { x: 3, y: 4 }], 'akima')).toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }]);
  });

  it('more samples per segment give a denser curve', () => {
    expect(splinePath(square, 'centripetalCR', { samplesPerSegment: 40 }).length)
      .toBeGreaterThan(splinePath(square, 'centripetalCR', { samplesPerSegment: 10 }).length);
  });
});

describe('splineSegments', () => {
  it('gives one piece per control point, joined end to start, interpolating pieces running point to point', () => {
    const segs = splineSegments(square, 'akima');
    expect(segs).toHaveLength(square.length);
    segs.forEach((seg, i) => {
      const next = segs[(i + 1) % segs.length];
      expect(seg[seg.length - 1].x).toBeCloseTo(next[0].x, 9);
      expect(seg[seg.length - 1].y).toBeCloseTo(next[0].y, 9);
      expect(Math.hypot(seg[0].x - square[i].x, seg[0].y - square[i].y)).toBeLessThan(1e-9);
    });
  });

  it('fewer than three control points give no closed curve', () => {
    expect(splineSegments(square.slice(0, 2), 'centripetalCR')).toEqual([]);
  });
});

describe('refineTowardEdges (ROI active spline, #99)', () => {
  // A bright disc of radius 15 centred at (32, 32) on a 64×64 image.
  const W = 64, H = 64;
  const img = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) img[y * W + x] = Math.hypot(x - 32, y - 32) <= 15 ? 100 : 0;
  const circle = (r: number) => Array.from({ length: 48 }, (_, k) => ({ x: 32 + r * Math.cos((2 * Math.PI * k) / 48), y: 32 + r * Math.sin((2 * Math.PI * k) / 48) }));
  const meanR = (c: Point[]) => c.reduce((s, p) => s + Math.hypot(p.x - 32, p.y - 32), 0) / c.length;

  it('pulls a curve 2 px inside the edge onto it', () => {
    const out = refineTowardEdges(circle(13), img, W, H, null);
    expect(Math.abs(meanR(out) - 15)).toBeLessThan(Math.abs(13 - 15) / 2);
  });

  it('leaves points outside the ROI where they were', () => {
    const c = circle(13);
    const roi = { x0: 0, y0: 0, x1: 31, y1: 63 }; // the left half only
    const out = refineTowardEdges(c, img, W, H, roi);
    c.forEach((p, i) => {
      if (p.x > 31) expect(out[i]).toEqual(p);
    });
    expect(out.some((p, i) => c[i].x <= 31 && (p.x !== c[i].x || p.y !== c[i].y))).toBe(true);
  });
});
