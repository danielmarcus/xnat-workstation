/**
 * Closed-polygon helpers for contour drawing (SegWorks parity branch 6, F1).
 *
 * Pure. The commit smoothing (#81, Chaikin corner cutting) and rasterization already exist
 * for Level Trace (branch 4) and are re-exported, not duplicated.
 */
import type { Point } from './splines';
import { traceBoundary } from '../semiauto/levelTrace';
import { labelComponents, type MaskPlane } from '../maskOps/plane';

export { chaikin, rasterize } from '../semiauto/levelTrace';

function orient(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

const EPS = 1e-9;
const sign = (v: number) => (v > EPS ? 1 : v < -EPS ? -1 : 0);

/**
 * Do segments ab and cd meet — crossing, or touching at a vertex? Callers only ask about
 * non-adjacent segments, so any contact means the curve meets itself. Signs are compared
 * with zero as a value of its own: a strict-crossing test (both strictly opposite) misses
 * the common case of a symmetric curve passing through the same sample point twice — the
 * crossing then falls on a vertex of both segments. (A run along the same line needs no
 * extra case: the segment that brings the curve back onto the line touches it at a vertex.)
 */
function segmentsMeet(a: Point, b: Point, c: Point, d: Point): boolean {
  return sign(orient(a, b, c)) !== sign(orient(a, b, d)) && sign(orient(c, d, a)) !== sign(orient(c, d, b));
}

/** The polyline without repeated consecutive points (zero-length edges). */
function dedupe(poly: Point[], closed: boolean): Point[] {
  const out: Point[] = [];
  for (const p of poly) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > EPS || Math.abs(last.y - p.y) > EPS) out.push(p);
  }
  if (closed && out.length > 1 && Math.abs(out[0].x - out[out.length - 1].x) <= EPS && Math.abs(out[0].y - out[out.length - 1].y) <= EPS) out.pop();
  return out;
}

/**
 * Whether a closed polygon crosses or touches itself (#100 — spline self-intersection
 * protection). Adjacent edges share a vertex and are skipped. O(n²); contours here are a
 * few hundred points.
 */
export function hasSelfIntersection(polygon: Point[]): boolean {
  const poly = dedupe(polygon, true);
  const n = poly.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // the closing edge touches the first
      if (segmentsMeet(a, b, poly[j], poly[(j + 1) % n])) return true;
    }
  }
  return false;
}

/** Whether an OPEN polyline (no closing edge) crosses or touches itself — a spline still being drawn. */
export function hasSelfIntersectionOpen(polyline: Point[]): boolean {
  const poly = dedupe(polyline, false);
  const n = poly.length;
  for (let i = 0; i + 1 < n; i++) {
    for (let j = i + 2; j + 1 < n; j++) {
      if (segmentsMeet(poly[i], poly[i + 1], poly[j], poly[j + 1])) return true;
    }
  }
  return false;
}

/** `k` points at equal arc length round a closed polygon, starting at its first vertex. */
export function resampleClosed(poly: Point[], k: number): Point[] {
  if (poly.length < 2 || k < 1) return poly.map((p) => ({ ...p }));
  const n = poly.length;
  const edge = (i: number) => Math.hypot(poly[(i + 1) % n].x - poly[i].x, poly[(i + 1) % n].y - poly[i].y);
  let perimeter = 0;
  for (let i = 0; i < n; i++) perimeter += edge(i);
  if (perimeter <= EPS) return [{ ...poly[0] }];
  const out: Point[] = [];
  let i = 0, walked = 0; // arc length at the start of edge i
  for (let j = 0; j < k; j++) {
    const target = (perimeter * j) / k;
    while (walked + edge(i) < target - EPS) { walked += edge(i); i++; }
    const len = edge(i), t = len > EPS ? (target - walked) / len : 0;
    const a = poly[i], b = poly[(i + 1) % n];
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

/**
 * Control points for a spline round a mask's largest island (#86, #89 — a Segmentation's
 * outline as an editable spline): its traced boundary resampled to one point per ~8 px of
 * boundary, between 6 and 24.
 */
export function outlineControlPoints(mask: MaskPlane): Point[] {
  const { labels, sizes } = labelComponents(mask.data, mask.width, mask.height);
  let best = 0;
  for (let c = 1; c < sizes.length; c++) if (sizes[c] > (sizes[best] ?? 0)) best = c;
  if (!best) return [];
  const island = Uint8Array.from(labels, (l) => (l === best ? 1 : 0));
  const boundary = traceBoundary({ width: mask.width, height: mask.height, data: island }).map(([x, y]) => ({ x, y }));
  if (boundary.length < 3) return boundary;
  let perimeter = 0;
  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i], b = boundary[(i + 1) % boundary.length];
    perimeter += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return resampleClosed(boundary, Math.max(6, Math.min(24, Math.round(perimeter / 8))));
}
