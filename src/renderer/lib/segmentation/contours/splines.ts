/**
 * Closed spline families for contour drawing (SegWorks parity branch 6, F1; inventory
 * #93–99 — docs/segworks-parity.md §10).
 *
 * Pure: control points in, a closed polyline out (the last point is NOT repeated). Every
 * family ships (decision 5); they differ in whether the curve passes through the control
 * points and how it behaves where their spacing or direction changes sharply:
 *
 *  - centripetalCR — centripetal Catmull-Rom (Yuksel, Schaefer & Keyser 2011): interpolating,
 *    no cusps or self-loops within a segment. The default.
 *  - cubicBSpline — uniform cubic B-spline: approximating (smooths the points, does not pass
 *    through them), C².
 *  - monotoneCubic — Fritsch–Carlson monotone cubic per coordinate, parametrised by chord
 *    length: interpolating, and never overshoots the range of two neighbouring points.
 *  - akima — Akima (1970) per coordinate, chord-length parametrised: interpolating, a run of
 *    three equal slopes stays straight (little overshoot where spacing changes).
 *  - localCR — cardinal (tension-scaled) Catmull-Rom: interpolating, tension 0…0.95.
 *  - tensionSpline — the same cardinal form with tension up to 0.98 (SegWorks keeps both).
 *  - roiActiveSpline — localCR, then nudged toward image edges inside an ROI
 *    (`refineTowardEdges`, which needs the image; `splinePath` returns the localCR curve).
 */

export interface Point {
  x: number;
  y: number;
}

export type SplineAlgorithm =
  | 'centripetalCR'
  | 'cubicBSpline'
  | 'monotoneCubic'
  | 'akima'
  | 'localCR'
  | 'tensionSpline'
  | 'roiActiveSpline';

export const SPLINE_ALGORITHMS: ReadonlyArray<{ id: SplineAlgorithm; label: string; interpolating: boolean }> = [
  { id: 'centripetalCR', label: 'Centripetal Catmull-Rom', interpolating: true },
  { id: 'cubicBSpline', label: 'Cubic B-spline', interpolating: false },
  { id: 'monotoneCubic', label: 'Monotone cubic', interpolating: true },
  { id: 'akima', label: 'Akima', interpolating: true },
  { id: 'localCR', label: 'Local Catmull-Rom+', interpolating: true },
  { id: 'tensionSpline', label: 'Tension spline', interpolating: true },
  { id: 'roiActiveSpline', label: 'ROI active spline', interpolating: true },
];

export interface SplineOptions {
  /** Base samples between two control points (SegWorks 8–64, default 22); longer spans get more. */
  samplesPerSegment: number;
  /** Cardinal tension for localCR / tensionSpline (0 = Catmull-Rom, higher = tighter). */
  tension: number;
}

export const DEFAULT_SPLINE_OPTIONS: SplineOptions = { samplesPerSegment: 22, tension: 0.38 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
const at = <T>(a: T[], i: number) => a[((i % a.length) + a.length) % a.length];

function samplesFor(a: Point, b: Point, o: SplineOptions, max = 64): number {
  return clamp(Math.round(o.samplesPerSegment + dist(a, b) / 10), 10, max);
}

/** Append a segment's samples, dropping its last (= the next segment's first) and duplicates. */
function pushSegment(out: Point[], pts: Point[]): void {
  for (let j = 0; j < pts.length - 1; j++) {
    const p = pts[j];
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-9 && Math.abs(last.y - p.y) < 1e-9) continue;
    out.push(p);
  }
}

// ─── Centripetal Catmull-Rom ──────────────────────────────────────────────────

function centripetalSegment(p0: Point, p1: Point, p2: Point, p3: Point, n: number): Point[] {
  const t1 = Math.sqrt(dist(p0, p1)) || 1e-6;
  const t2 = t1 + (Math.sqrt(dist(p1, p2)) || 1e-6);
  const t3 = t2 + (Math.sqrt(dist(p2, p3)) || 1e-6);
  const lerp = (a: Point, b: Point, ta: number, tb: number, t: number): Point => {
    const u = (t - ta) / (tb - ta);
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
  };
  const out: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const t = t1 + ((t2 - t1) * i) / n;
    const a1 = lerp(p0, p1, 0, t1, t);
    const a2 = lerp(p1, p2, t1, t2, t);
    const a3 = lerp(p2, p3, t2, t3, t);
    const b1 = lerp(a1, a2, 0, t2, t);
    const b2 = lerp(a2, a3, t1, t3, t);
    out.push(lerp(b1, b2, t1, t2, t));
  }
  return out;
}

function centripetalCR(ctrl: Point[], o: SplineOptions): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < ctrl.length; i++) {
    const p1 = ctrl[i];
    const p2 = at(ctrl, i + 1);
    pushSegment(out, centripetalSegment(at(ctrl, i - 1), p1, p2, at(ctrl, i + 2), samplesFor(p1, p2, o)));
  }
  return out;
}

// ─── Uniform cubic B-spline ───────────────────────────────────────────────────

function cubicBSpline(ctrl: Point[], o: SplineOptions): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < ctrl.length; i++) {
    const p0 = at(ctrl, i - 1), p1 = ctrl[i], p2 = at(ctrl, i + 1), p3 = at(ctrl, i + 2);
    const n = samplesFor(p1, p2, o);
    const seg: Point[] = [];
    for (let s = 0; s <= n; s++) {
      const u = s / n, u2 = u * u, u3 = u2 * u;
      const b0 = (1 - u) ** 3 / 6;
      const b1 = (3 * u3 - 6 * u2 + 4) / 6;
      const b2 = (-3 * u3 + 3 * u2 + 3 * u + 1) / 6;
      const b3 = u3 / 6;
      seg.push({ x: b0 * p0.x + b1 * p1.x + b2 * p2.x + b3 * p3.x, y: b0 * p0.y + b1 * p1.y + b2 * p2.y + b3 * p3.y });
    }
    pushSegment(out, seg);
  }
  return out;
}

// ─── Hermite forms: cardinal, monotone, Akima ─────────────────────────────────

/** Cubic Hermite through (y0, y1) with tangents m0, m1 already scaled to the interval. */
function hermite(y0: number, y1: number, m0: number, m1: number, u: number): number {
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * y0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * y1 + (u3 - u2) * m1;
}

function cardinal(ctrl: Point[], o: SplineOptions, maxTension: number): Point[] {
  const s = 1 - clamp(o.tension, 0, maxTension);
  const out: Point[] = [];
  for (let i = 0; i < ctrl.length; i++) {
    const p0 = at(ctrl, i - 1), p1 = ctrl[i], p2 = at(ctrl, i + 1), p3 = at(ctrl, i + 2);
    const m1 = { x: (s * (p2.x - p0.x)) / 2, y: (s * (p2.y - p0.y)) / 2 };
    const m2 = { x: (s * (p3.x - p1.x)) / 2, y: (s * (p3.y - p1.y)) / 2 };
    const n = samplesFor(p1, p2, o, 72);
    const seg: Point[] = [];
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      seg.push({ x: hermite(p1.x, p2.x, m1.x, m2.x, u), y: hermite(p1.y, p2.y, m1.y, m2.y, u) });
    }
    pushSegment(out, seg);
  }
  return out;
}

/** Periodic chord-length knot spacing h[k] = |P[k+1] − P[k]|. */
function chordSpacing(ctrl: Point[]): number[] {
  return ctrl.map((p, k) => dist(p, at(ctrl, k + 1)) || 1e-6);
}

/** Fritsch–Carlson slopes for one periodic coordinate. */
function monotoneSlopes(v: number[], h: number[]): number[] {
  const n = v.length;
  const d = v.map((y, k) => (at(v, k + 1) - y) / h[k]);
  const m = new Array<number>(n);
  for (let k = 0; k < n; k++) {
    const dl = at(d, k - 1), dr = d[k];
    m[k] = dl * dr <= 0 ? 0 : (dl + dr) / 2;
  }
  // Limit so each interval stays monotone (alpha² + beta² ≤ 9).
  for (let k = 0; k < n; k++) {
    if (d[k] === 0) { m[k] = 0; m[(k + 1) % n] = 0; continue; }
    const a = m[k] / d[k], b = at(m, k + 1) / d[k];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[k] = t * a * d[k];
      m[(k + 1) % n] = t * b * d[k];
    }
  }
  return m;
}

/** Akima slopes for one periodic coordinate. */
function akimaSlopes(v: number[], h: number[]): number[] {
  const d = v.map((y, k) => (at(v, k + 1) - y) / h[k]);
  return v.map((_, k) => {
    const dm2 = at(d, k - 2), dm1 = at(d, k - 1), d0 = d[k], dp1 = at(d, k + 1);
    const wa = Math.abs(dp1 - d0);
    const wb = Math.abs(dm1 - dm2);
    return wa + wb < 1e-12 ? (dm1 + d0) / 2 : (wa * dm1 + wb * d0) / (wa + wb);
  });
}

function perCoordinate(ctrl: Point[], o: SplineOptions, slopes: (v: number[], h: number[]) => number[]): Point[] {
  const h = chordSpacing(ctrl);
  const xs = ctrl.map((p) => p.x), ys = ctrl.map((p) => p.y);
  const mx = slopes(xs, h), my = slopes(ys, h);
  const out: Point[] = [];
  for (let k = 0; k < ctrl.length; k++) {
    const p1 = ctrl[k], p2 = at(ctrl, k + 1);
    const n = samplesFor(p1, p2, o);
    const seg: Point[] = [];
    for (let s = 0; s <= n; s++) {
      const u = s / n;
      seg.push({
        x: hermite(p1.x, p2.x, mx[k] * h[k], at(mx, k + 1) * h[k], u),
        y: hermite(p1.y, p2.y, my[k] * h[k], at(my, k + 1) * h[k], u),
      });
    }
    pushSegment(out, seg);
  }
  return out;
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

/**
 * The closed curve through (or near) `ctrl` for `algorithm`. Fewer than three control
 * points are returned as they are (no closed curve yet).
 */
export function splinePath(ctrl: Point[], algorithm: SplineAlgorithm, options: Partial<SplineOptions> = {}): Point[] {
  const o = { ...DEFAULT_SPLINE_OPTIONS, ...options };
  if (ctrl.length < 3) return ctrl.map((p) => ({ ...p }));
  switch (algorithm) {
    case 'cubicBSpline': return cubicBSpline(ctrl, o);
    case 'monotoneCubic': return perCoordinate(ctrl, o, monotoneSlopes);
    case 'akima': return perCoordinate(ctrl, o, akimaSlopes);
    case 'localCR':
    case 'roiActiveSpline': return cardinal(ctrl, o, 0.95);
    case 'tensionSpline': return cardinal(ctrl, o, 0.98);
    case 'centripetalCR':
    default: return centripetalCR(ctrl, o);
  }
}

// ─── ROI active spline: nudge toward image edges ──────────────────────────────

export interface EdgeRefineOptions {
  /** Pixels searched along the normal on each side (SegWorks 1–6, default 3). */
  radius: number;
  /** Passes over the curve (SegWorks 1–30, default 12). */
  iterations: number;
}

/**
 * Move each curve point toward the strongest Sobel edge along its normal, a little per pass
 * (65 % stay, 35 % toward the best), only for points inside `roi` (pixel rectangle; null =
 * everywhere). The ROI active spline (#99): the user keeps control of the control points;
 * only the drawn curve is pulled onto the boundary.
 */
export function refineTowardEdges(
  curve: Point[],
  image: ArrayLike<number>,
  width: number,
  height: number,
  roi: { x0: number; y0: number; x1: number; y1: number } | null,
  options: Partial<EdgeRefineOptions> = {},
): Point[] {
  const radius = clamp(options.radius ?? 3, 1, 6);
  const iterations = clamp(options.iterations ?? 12, 1, 30);
  const inRoi = (x: number, y: number) => !roi || (x >= roi.x0 && x <= roi.x1 && y >= roi.y0 && y <= roi.y1);
  const px = (x: number, y: number) => Number(image[clamp(y, 0, height - 1) * width + clamp(x, 0, width - 1)]) || 0;
  const sobel = (x: number, y: number) => {
    const gx = -px(x - 1, y - 1) - 2 * px(x - 1, y) - px(x - 1, y + 1) + px(x + 1, y - 1) + 2 * px(x + 1, y) + px(x + 1, y + 1);
    const gy = -px(x - 1, y - 1) - 2 * px(x, y - 1) - px(x + 1, y - 1) + px(x - 1, y + 1) + 2 * px(x, y + 1) + px(x + 1, y + 1);
    return Math.hypot(gx, gy);
  };
  const out = curve.map((p) => ({ ...p }));
  if (out.length < 3) return out;
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < out.length; i++) {
      const cur = out[i];
      if (!inRoi(cur.x, cur.y)) continue;
      const prev = at(out, i - 1), next = at(out, i + 1);
      const tl = Math.hypot(next.x - prev.x, next.y - prev.y) || 1e-6;
      const nx = -(next.y - prev.y) / tl, ny = (next.x - prev.x) / tl;
      let best = { g: -1, x: cur.x, y: cur.y };
      for (let d = -radius; d <= radius; d++) {
        const sx = clamp(Math.round(cur.x + nx * d), 0, width - 1);
        const sy = clamp(Math.round(cur.y + ny * d), 0, height - 1);
        if (!inRoi(sx, sy)) continue;
        const g = sobel(sx, sy);
        if (g > best.g) best = { g, x: sx, y: sy };
      }
      out[i] = { x: 0.65 * cur.x + 0.35 * best.x, y: 0.65 * cur.y + 0.35 * best.y };
    }
  }
  return out;
}
