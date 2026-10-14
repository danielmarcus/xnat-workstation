/**
 * Level Trace (SegWorks parity #32–51; branch 4): click a point, get the closed region of
 * similar intensity around it on this slice — previewed before it is committed.
 *
 *  band        CT: seed HU ± tolerance. MR (and other non-HU data): adaptive — mean ± kσ of a
 *              7 / 11 / 15 px window around the click.
 *  growth      'binary': pixels inside the band connected to the click (Adams & Bischof
 *              seeded region growing). 'fuzzy': Udupa & Samarasekera fuzzy connectedness —
 *              path strength = weakest affinity along it; keep pixels whose strongest path
 *              from the click exceeds a threshold, so gradual intensity drift stays connected.
 *  edge guard  pixels on a strong gradient (Sobel, or the more isotropic Scharr) are walls;
 *              strength off / gentle / strong; polarity can restrict walls to dark→light or
 *              light→dark transitions (seen from the click outward).
 *  air guard   CT: never below −500 HU (lung, outside air).
 *  finishing   fill holes; Gaussian smoothing; outline simplification (Ramer–Douglas–Peucker)
 *              and corner rounding (Chaikin) on the traced boundary, re-rasterised.
 */
import { fillHoles, gaussianSmooth } from '../maskOps/cleanup';
import { labelComponents, type MaskPlane } from '../maskOps/plane';

export interface LevelTraceOptions {
  modality: 'ct' | 'mr';
  huTolerance: number;
  /** MR adaptive band: k σ around the local mean. */
  sigmaK: number;
  window: 7 | 11 | 15;
  growth: 'binary' | 'fuzzy';
  /** Fuzzy connectedness: keep pixels whose path strength ≥ this (0–1). */
  fuzzyThreshold: number;
  edgeGuard: 'off' | 'gentle' | 'strong';
  edgeOperator: 'sobel' | 'scharr';
  polarity: 'auto' | 'darkToLight' | 'lightToDark';
  airGuard: boolean;
  fillHoles: boolean;
  smoothing: 'none' | 'gentle' | 'standard' | 'strong';
  /** RDP tolerance in pixels (0 = off). */
  simplifyPx: number;
  /** Chaikin iterations (0 = off). */
  roundCorners: number;
  /**
   * Intensity guard (SegWorks #56–57): only pixels in [lo, hi] are taken, whatever the band
   * allows — typed in, or read from an ROI (`guardFromSamples`).
   */
  guard?: { lo: number; hi: number } | null;
}

export const DEFAULT_LEVEL_TRACE: LevelTraceOptions = {
  modality: 'ct', huTolerance: 100, sigmaK: 2.2, window: 7, growth: 'binary', fuzzyThreshold: 0.5,
  edgeGuard: 'off', edgeOperator: 'sobel', polarity: 'auto', airGuard: true, fillHoles: true,
  smoothing: 'none', simplifyPx: 0, roundCorners: 0,
};

export interface Band { lo: number; hi: number; centre: number }

export function traceBand(image: ArrayLike<number>, w: number, h: number, x: number, y: number, o: LevelTraceOptions): Band {
  const seed = image[x + y * w];
  if (o.modality === 'ct') return { lo: seed - o.huTolerance, hi: seed + o.huTolerance, centre: seed };
  const half = (o.window - 1) / 2;
  const vals: number[] = [];
  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) vals.push(image[nx + ny * w]);
    }
  }
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) || 1;
  return { lo: mean - o.sigmaK * sd, hi: mean + o.sigmaK * sd, centre: mean };
}

/** Gradient (gx, gy) with Sobel or Scharr kernels. */
export function gradient(image: ArrayLike<number>, w: number, h: number, op: 'sobel' | 'scharr'): { gx: Float32Array; gy: Float32Array; mag: Float32Array } {
  const [a, b] = op === 'scharr' ? [3, 10] : [1, 2];
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  const mag = new Float32Array(w * h);
  // Edge-clamped neighbours: a wall must reach the image border, or a region flows round it.
  const v = (x: number, y: number) => image[Math.min(w - 1, Math.max(0, x)) + Math.min(h - 1, Math.max(0, y)) * w];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = x + y * w;
      const sx = a * (v(x + 1, y - 1) - v(x - 1, y - 1)) + b * (v(x + 1, y) - v(x - 1, y)) + a * (v(x + 1, y + 1) - v(x - 1, y + 1));
      const sy = a * (v(x - 1, y + 1) - v(x - 1, y - 1)) + b * (v(x, y + 1) - v(x, y - 1)) + a * (v(x + 1, y + 1) - v(x + 1, y - 1));
      gx[i] = sx; gy[i] = sy; mag[i] = Math.hypot(sx, sy);
    }
  }
  return { gx, gy, mag };
}

/** Pixels that are walls under the edge guard. */
function edgeWalls(image: ArrayLike<number>, w: number, h: number, x0: number, y0: number, band: Band, o: LevelTraceOptions): Uint8Array | null {
  if (o.edgeGuard === 'off') return null;
  const { gx, gy, mag } = gradient(image, w, h, o.edgeOperator);
  // A step of size s gives a gradient magnitude of 4s (Sobel) or 16s (Scharr). Walls are
  // steps at least half the band's half-width (strong) or the whole half-width (gentle) —
  // steps the band alone would let the trace cross.
  const kernelGain = o.edgeOperator === 'scharr' ? 16 : 4;
  const halfWidth = Math.max(1, (band.hi - band.lo) / 2);
  const thr = kernelGain * halfWidth * (o.edgeGuard === 'strong' ? 0.5 : 1);
  const walls = new Uint8Array(w * h);
  for (let i = 0; i < walls.length; i++) {
    if (mag[i] < thr) continue;
    if (o.polarity !== 'auto') {
      // Outward direction from the click; dot with the gradient says whether intensity rises.
      const x = i % w, y = (i - x) / w;
      const rises = gx[i] * (x - x0) + gy[i] * (y - y0) > 0;
      if (o.polarity === 'darkToLight' && !rises) continue;
      if (o.polarity === 'lightToDark' && rises) continue;
    }
    walls[i] = 1;
  }
  return walls;
}

function binaryGrow(image: ArrayLike<number>, w: number, h: number, x0: number, y0: number, ok: (i: number) => boolean): Uint8Array {
  const out = new Uint8Array(w * h);
  const s = x0 + y0 * w;
  if (!ok(s)) return out;
  const stack = [s];
  out[s] = 1;
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w, y = (p - x) / w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const q = nx + ny * w;
      if (out[q] || !ok(q)) continue;
      out[q] = 1;
      stack.push(q);
    }
  }
  return out;
}

/**
 * Fuzzy connectedness: affinity between neighbours = closeness of both to the band centre
 * and to each other; a path's strength is its weakest affinity; each pixel's connectedness
 * to the click is its strongest path (a widest-path / Dijkstra on max-min).
 */
function fuzzyGrow(image: ArrayLike<number>, w: number, h: number, x0: number, y0: number, band: Band, threshold: number, blocked: (i: number) => boolean): Uint8Array {
  const n = w * h;
  const halfWidth = Math.max(1, (band.hi - band.lo) / 2);
  const homog = (a: number, b: number) => Math.exp(-(((a - b) / halfWidth) ** 2));
  const object = (a: number) => Math.exp(-(((a - band.centre) / halfWidth) ** 2) / 2);
  // 64-bit: strengths are computed in doubles; storing them rounded to 32 bits made
  // "stronger than stored" true forever and re-queued pixels without end.
  const conn = new Float64Array(n);
  const s = x0 + y0 * w;
  conn[s] = 1;
  // Bucketed max-heap substitute: simple binary heap on -strength.
  const heap: Array<[number, number]> = [[1, s]];
  const push = (v: number, i: number) => {
    heap.push([v, i]);
    let k = heap.length - 1;
    while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] >= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] > heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] > heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [v, p] = pop();
    if (v < conn[p] || v < threshold) continue;
    const x = p % w, y = (p - x) / w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const q = nx + ny * w;
      if (blocked(q)) continue;
      const aff = Math.sqrt(homog(image[p], image[q]) * object(image[q]));
      const strength = Math.min(v, aff);
      if (strength > conn[q]) { conn[q] = strength; push(strength, q); }
    }
  }
  return Uint8Array.from(conn, (c) => (c >= threshold ? 1 : 0));
}

/** Outer boundary of the largest component as a closed polygon (Moore neighbour tracing). */
export function traceBoundary(mask: MaskPlane): Array<[number, number]> {
  const { width: w, height: h, data } = mask;
  let start = -1;
  for (let i = 0; i < data.length && start < 0; i++) if (data[i]) start = i;
  if (start < 0) return [];
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[x + y * w] === 1;
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const sx = start % w, sy = (start - sx) / w;
  const pts: Array<[number, number]> = [[sx, sy]];
  let cx = sx, cy = sy, dir = 6; // came from the left/up scan order
  for (let steps = 0; steps < 4 * w * h; steps++) {
    let found = false;
    for (let k = 0; k < 8; k++) {
      const d = (dir + 6 + k) % 8;
      const nx = cx + dirs[d][0], ny = cy + dirs[d][1];
      if (at(nx, ny)) { cx = nx; cy = ny; dir = d; found = true; break; }
    }
    if (!found || (cx === sx && cy === sy)) break;
    pts.push([cx, cy]);
  }
  return pts;
}

/** Ramer–Douglas–Peucker on a closed polygon. */
export function simplify(pts: Array<[number, number]>, eps: number): Array<[number, number]> {
  if (pts.length < 4 || eps <= 0) return pts;
  const rdp = (a: number, b: number, keep: Uint8Array) => {
    let best = -1, bestD = eps;
    const [x1, y1] = pts[a], [x2, y2] = pts[b];
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((x2 - x1) * (y1 - pts[i][1]) - (x1 - pts[i][0]) * (y2 - y1)) / len;
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; rdp(a, best, keep); rdp(best, b, keep); }
  };
  const keep = new Uint8Array(pts.length);
  const mid = Math.floor(pts.length / 2);
  keep[0] = 1; keep[mid] = 1; keep[pts.length - 1] = 1;
  rdp(0, mid, keep);
  rdp(mid, pts.length - 1, keep);
  return pts.filter((_, i) => keep[i]);
}

/** Chaikin corner cutting on a closed polygon. */
export function chaikin(pts: Array<[number, number]>, iterations: number): Array<[number, number]> {
  let p = pts;
  for (let k = 0; k < iterations && p.length >= 3; k++) {
    const out: Array<[number, number]> = [];
    for (let i = 0; i < p.length; i++) {
      const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length];
      out.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1], [0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
    }
    p = out;
  }
  return p;
}

/** Fill a closed polygon (pixel centres inside, even-odd). Shared by every contour fill. */
export function rasterize(poly: Array<[number, number]>, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  if (poly.length < 3) return out;
  for (let y = 0; y < h; y++) {
    const xs: number[] = [];
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.ceil(xs[k]); x <= Math.floor(xs[k + 1]); x++) if (x >= 0 && x < w) out[x + y * w] = 1;
    }
  }
  return out;
}

/**
 * Fill a TRACED outline — one running through the boundary pixels' centres (traceBoundary): the
 * inside, and the pixels the outline passes through. A plain fill (half-open in y) dropped the
 * region's bottom row. Not for drawn contours, whose edges lie between pixels.
 */
export function rasterizeTraced(poly: Array<[number, number]>, w: number, h: number): Uint8Array {
  const out = rasterize(poly, w, h);
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2));
    for (let k = 0; k <= n; k++) {
      const x = Math.round(x1 + ((x2 - x1) * k) / n), y = Math.round(y1 + ((y2 - y1) * k) / n);
      if (x >= 0 && y >= 0 && x < w && y < h) out[x + y * w] = 1;
    }
  }
  return out;
}

/**
 * The traced region for a click at (x, y), or an empty plane when the click fails the
 * guards. `roi` (optional) confines the trace.
 */
/** An intensity guard read from ROI samples: their 2nd–98th percentile (null if none). */
export function guardFromSamples(values: ArrayLike<number>): { lo: number; hi: number } | null {
  if (!values.length) return null;
  const v = Float64Array.from(values).sort();
  const at = (p: number) => v[Math.round(p * (v.length - 1))];
  return { lo: at(0.02), hi: at(0.98) };
}

export function levelTrace(image: ArrayLike<number>, w: number, h: number, x: number, y: number, o: LevelTraceOptions, roi?: ArrayLike<number>): MaskPlane {
  const empty: MaskPlane = { width: w, height: h, data: new Uint8Array(w * h) };
  if (x < 0 || y < 0 || x >= w || y >= h) return empty;
  const band = traceBand(image, w, h, x, y, o);
  const walls = edgeWalls(image, w, h, x, y, band, o);
  const blocked = (i: number) => (roi ? !roi[i] : false) || (walls ? walls[i] === 1 && i !== x + y * w : false)
    || (o.modality === 'ct' && o.airGuard && image[i] < -500)
    || (!!o.guard && (image[i] < o.guard.lo || image[i] > o.guard.hi));
  let data = o.growth === 'fuzzy'
    ? fuzzyGrow(image, w, h, x, y, band, o.fuzzyThreshold, blocked)
    : binaryGrow(image, w, h, x, y, (i) => !blocked(i) && image[i] >= band.lo && image[i] <= band.hi);
  let plane: MaskPlane = { width: w, height: h, data };
  if (!data.some((v) => v)) return empty;
  if (o.fillHoles) plane = fillHoles(plane, { x: 1, y: 1 });
  if (o.smoothing !== 'none') {
    plane = gaussianSmooth(plane, { sigma: o.smoothing === 'gentle' ? 0.8 : o.smoothing === 'standard' ? 1.2 : 2, threshold: 0.5 });
  }
  if (o.simplifyPx > 0 || o.roundCorners > 0) {
    // The outline of the CLICKED region: smoothing can split it, and the tracer follows the
    // first component in scan order.
    const pre = labelComponents(plane.data, w, h, 8);
    const at = pre.labels[x + y * w];
    if (at) plane = { width: w, height: h, data: Uint8Array.from(pre.labels, (l) => (l === at ? 1 : 0)) };
    let poly = traceBoundary(plane);
    if (o.simplifyPx > 0) poly = simplify(poly, o.simplifyPx);
    if (o.roundCorners > 0) poly = chaikin(poly, o.roundCorners);
    plane = { width: w, height: h, data: rasterizeTraced(poly, w, h) };
  }
  // Keep the component containing (or nearest) the click.
  const cc = labelComponents(plane.data, w, h, 8);
  const id = cc.labels[x + y * w];
  if (id) data = Uint8Array.from(cc.labels, (l) => (l === id ? 1 : 0));
  else data = plane.data;
  return { width: w, height: h, data };
}
