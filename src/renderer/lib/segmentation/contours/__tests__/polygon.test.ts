/** Self-intersection protection (branch 6, F1; #100). */
import { describe, expect, it } from 'vitest';
import { hasSelfIntersection, hasSelfIntersectionOpen, outlineControlPoints, resampleClosed } from '../polygon';
import { splinePath } from '../splines';

describe('hasSelfIntersection', () => {
  it('a simple polygon does not intersect itself', () => {
    expect(hasSelfIntersection([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])).toBe(false);
  });

  it('a bow-tie (figure eight) does', () => {
    expect(hasSelfIntersection([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }])).toBe(true);
  });

  it('a spline through crossed control points folds across itself; one through a convex set does not', () => {
    const convex = [{ x: 10, y: 10 }, { x: 40, y: 10 }, { x: 40, y: 40 }, { x: 10, y: 40 }];
    const crossed = [{ x: 10, y: 10 }, { x: 40, y: 40 }, { x: 40, y: 10 }, { x: 10, y: 40 }];
    expect(hasSelfIntersection(splinePath(convex, 'centripetalCR'))).toBe(false);
    expect(hasSelfIntersection(splinePath(crossed, 'centripetalCR'))).toBe(true);
  });

  it('touching only at shared vertices is not an intersection', () => {
    expect(hasSelfIntersection([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])).toBe(false);
  });
});

describe('hasSelfIntersectionOpen', () => {
  it('an open zig-zag that doubles back across itself crosses; one that does not, does not', () => {
    expect(hasSelfIntersectionOpen([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }])).toBe(true);
    expect(hasSelfIntersectionOpen([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])).toBe(false);
  });

  it('ignores the closing edge (an open U is not a crossing)', () => {
    // Closed, the edge back to the start would cross nothing either; open, there is no such edge.
    expect(hasSelfIntersectionOpen([{ x: 0, y: 10 }, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])).toBe(false);
  });
});

describe('touching crossings', () => {
  it('a curve that passes through the same point twice — the crossing falls on a vertex of both — intersects', () => {
    // Symmetric bow-tie sampled at its centre: both diagonals have a vertex at (0, 0).
    const open = [{ x: -10, y: -10 }, { x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: -10 }, { x: 0, y: 0 }, { x: -10, y: 10 }];
    expect(hasSelfIntersectionOpen(open)).toBe(true);
    expect(hasSelfIntersection(open)).toBe(true);
  });

  it('a curve that runs back along part of itself (collinear overlap) intersects', () => {
    // The last edge, (4,0)→(14,0), lies along the first, (0,0)→(10,0).
    expect(hasSelfIntersectionOpen([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 0 }, { x: 14, y: 0 }])).toBe(true);
  });

  it('repeated consecutive points are not a crossing', () => {
    expect(hasSelfIntersection([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])).toBe(false);
  });
});

describe('resampleClosed', () => {
  const square = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }];

  it('places k points at equal arc length round the polygon, starting at its first vertex', () => {
    const pts = resampleClosed(square, 8);
    expect(pts).toHaveLength(8);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    // Perimeter 160 → every 20 units: corners and edge midpoints.
    expect(pts.map((p) => [Math.round(p.x), Math.round(p.y)])).toEqual([[0, 0], [20, 0], [40, 0], [40, 20], [40, 40], [20, 40], [0, 40], [0, 20]]);
  });

  it('a degenerate polygon gives what it has', () => {
    expect(resampleClosed([{ x: 1, y: 1 }], 6)).toEqual([{ x: 1, y: 1 }]);
    expect(resampleClosed([], 6)).toEqual([]);
  });
});

describe('outlineControlPoints', () => {
  const W = 80, H = 80;
  const plane = (fill: (x: number, y: number) => boolean) => {
    const data = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (fill(x, y)) data[x + y * W] = 1;
    return { width: W, height: H, data };
  };

  it('follows the boundary of the LARGEST island, not the first one in scan order', () => {
    // A 2×2 speck at the top comes first in scan order; the disc (r 15 at 40,50) is larger.
    const mask = plane((x, y) => (x >= 5 && x <= 6 && y >= 2 && y <= 3) || (x - 40) ** 2 + (y - 50) ** 2 <= 15 * 15);
    const pts = outlineControlPoints(mask);
    expect(pts.length).toBeGreaterThanOrEqual(6);
    for (const p of pts) expect(Math.abs(Math.hypot(p.x - 40, p.y - 50) - 15)).toBeLessThan(1.5);
  });

  it('more boundary, more control points — within 6…24', () => {
    const small = outlineControlPoints(plane((x, y) => (x - 40) ** 2 + (y - 40) ** 2 <= 5 * 5));
    const large = outlineControlPoints(plane((x, y) => (x - 40) ** 2 + (y - 40) ** 2 <= 30 * 30));
    expect(small.length).toBeGreaterThanOrEqual(6);
    expect(large.length).toBeGreaterThan(small.length);
    expect(large.length).toBeLessThanOrEqual(24);
  });

  it('an empty plane has no outline', () => {
    expect(outlineControlPoints(plane(() => false))).toEqual([]);
  });
});
