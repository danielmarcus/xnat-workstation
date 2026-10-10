/**
 * Smart Brush (SegWorks parity #59–62; branch 4): a brush that paints only the tissue under
 * it — each dab takes the pixels within the radius that are connected to the brush centre
 * and within ±tolerance of the intensity there, so dragging along a boundary does not spill
 * across it. Dabs are placed along the drag every `spacingPx`.
 */

export interface SmartBrushOptions {
  radiusPx: number;
  tolerance: number;
  spacingPx: number;
}

export const DEFAULT_SMART_BRUSH: SmartBrushOptions = { radiusPx: 8, tolerance: 80, spacingPx: 2 };

/** One dab at (cx, cy), OR-ed into `out`. Returns the pixels added. */
export function smartBrushDab(image: ArrayLike<number>, w: number, h: number, cx: number, cy: number, o: SmartBrushOptions, out: Uint8Array): number {
  const x0 = Math.round(cx), y0 = Math.round(cy);
  if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) return 0;
  const ref = image[x0 + y0 * w];
  const r2 = o.radiusPx * o.radiusPx;
  const seen = new Set<number>([x0 + y0 * w]);
  const stack = [x0 + y0 * w];
  let added = 0;
  while (stack.length) {
    const p = stack.pop()!;
    if (!out[p]) { out[p] = 1; added++; }
    const x = p % w, y = (p - x) / w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if ((nx - cx) ** 2 + (ny - cy) ** 2 > r2) continue;
      const q = nx + ny * w;
      if (seen.has(q)) continue;
      seen.add(q);
      if (Math.abs(image[q] - ref) > o.tolerance) continue;
      stack.push(q);
    }
  }
  return added;
}

/** Dab centres along a polyline, every `spacingPx` (first and last points included). */
export function strokeDabs(points: Array<[number, number]>, spacingPx: number): Array<[number, number]> {
  if (points.length === 0) return [];
  const out: Array<[number, number]> = [points[0]];
  const step = Math.max(0.5, spacingPx);
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i - 1], [x2, y2] = points[i];
    const len = Math.hypot(x2 - x1, y2 - y1);
    let t = step - carry;
    while (t <= len) {
      out.push([x1 + ((x2 - x1) * t) / len, y1 + ((y2 - y1) * t) / len]);
      t += step;
    }
    carry = len - (t - step);
  }
  const last = points[points.length - 1];
  const tail = out[out.length - 1];
  if (tail[0] !== last[0] || tail[1] !== last[1]) out.push(last);
  return out;
}

/** The whole stroke as a mask. */
export function smartBrushStroke(image: ArrayLike<number>, w: number, h: number, points: Array<[number, number]>, o: SmartBrushOptions): Uint8Array {
  const out = new Uint8Array(w * h);
  for (const [x, y] of strokeDabs(points, o.spacingPx)) smartBrushDab(image, w, h, x, y, o, out);
  return out;
}
