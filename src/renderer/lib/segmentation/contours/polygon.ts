/**
 * Closed-polygon helpers for contour drawing (SegWorks parity branch 6, F1).
 *
 * Pure. The commit smoothing (#81, Chaikin corner cutting) and rasterization already exist
 * for Level Trace (branch 4) and are re-exported, not duplicated.
 */
import type { Point } from './splines';

export { chaikin, rasterize } from '../semiauto/levelTrace';

function orient(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** Do segments ab and cd cross at a point interior to both (touching ends do not count)? */
function properCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  return ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0));
}

/**
 * Whether a closed polygon crosses itself (#100 — spline self-intersection protection).
 * Adjacent edges share a vertex and are skipped. O(n²); contours here are a few hundred
 * points.
 */
export function hasSelfIntersection(poly: Point[]): boolean {
  const n = poly.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // the closing edge touches the first
      const c = poly[j], d = poly[(j + 1) % n];
      if (properCross(a, b, c, d)) return true;
    }
  }
  return false;
}
