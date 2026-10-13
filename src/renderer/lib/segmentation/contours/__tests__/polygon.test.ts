/** Self-intersection protection (branch 6, F1; #100). */
import { describe, expect, it } from 'vitest';
import { hasSelfIntersection } from '../polygon';
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
