/** Self-intersection protection (branch 6, F1; #100). */
import { describe, expect, it } from 'vitest';
import { hasSelfIntersection, hasSelfIntersectionOpen } from '../polygon';
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
