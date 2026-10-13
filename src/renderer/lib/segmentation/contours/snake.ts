/**
 * Snake Refine (SegWorks parity branch 6, F1; inventory #200–201, #89).
 *
 * Pure, on one binary plane: move a segment's boundary on a slice toward the image edges.
 * Every SegWorks variant ships (decision 5):
 *
 *  - edge    — the boundary follows the gradient of the edge map (Kass, Witkin & Terzopoulos
 *              1988, discrete form): short capture range, for a mask already near its edge.
 *  - gvf     — the same, driven by gradient vector flow (Xu & Prince 1998), which carries
 *              edge information into flat regions: a loose mask is pulled in from afar.
 *  - balloon — edge attraction plus a constant inflation (>0) or deflation (<0) that edges
 *              stop (Cohen 1991): grows a small mask out to its boundary.
 *  - morph   — morphological geodesic active contour (Márquez-Neila, Baumela & Alvarez 2014):
 *              balloon, image attachment and curvature smoothing as binary morphology.
 *              Used after propagation (#89). SegWorks' own version only ever grew (its
 *              retract step was a no-op); this is the published algorithm, keeping SegWorks'
 *              safety stop (no single step may grow the area by more than 15 % or shrink it
 *              by more than 30 %).
 *
 * Neighbours (#201): pixels owned by another segment are never taken unless the caller
 * allows replacement, and then only where the two segments already touch; locked pixels are
 * never taken. Pixels outside an optional ROI keep their original value.
 */
import type { MaskPlane } from '../maskOps/plane';
import { gaussianBlur } from './livewireCost';

export type SnakeVariant = 'edge' | 'gvf' | 'balloon' | 'morph';

export interface SnakeOptions {
  variant: SnakeVariant;
  /** Evolution steps (edge/gvf/balloon 1–100, default 20; morph 1–8, default 4). */
  iterations: number;
  /** Morph: how strongly edges stop the contour, 0–1 (SegWorks 0.55). */
  edgeWeight: number;
  /** Balloon / morph inflation: >0 grows, <0 shrinks, 0 none (SegWorks 0.15). */
  balloon: number;
  /** GVF regularisation μ (SegWorks 0.2) and diffusion iterations (40). */
  gvfMu: number;
  gvfIterations: number;
  /** Gaussian σ (px) applied before the edge map. */
  preSmoothSigma: number;
}

export const DEFAULT_SNAKE: SnakeOptions = {
  variant: 'edge',
  iterations: 20,
  edgeWeight: 0.55,
  balloon: 0.15,
  gvfMu: 0.2,
  gvfIterations: 40,
  preSmoothSigma: 1,
};

export interface SnakeContext {
  /** Pixels of other segments that may be taken where they touch this one (if allowed). */
  others?: Uint8Array | null;
  /** Pixels that must never be taken (locked segments, outside the scan). */
  protect?: Uint8Array | null;
  /** #201: reassign shared-boundary pixels of `others`. Default false (preserve neighbours). */
  allowReplace?: boolean;
  /** Only pixels where roi = 1 may change. */
  roi?: Uint8Array | null;
}

/** Normalised (0–1) Scharr gradient magnitude of the smoothed image. */
export function edgeMap(image: ArrayLike<number>, width: number, height: number, sigma: number): Float32Array {
  const img = gaussianBlur(image, width, height, sigma);
  const out = new Float32Array(width * height);
  const p = (x: number, y: number) => img[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))];
  let max = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gx = 3 * (p(x + 1, y - 1) - p(x - 1, y - 1)) + 10 * (p(x + 1, y) - p(x - 1, y)) + 3 * (p(x + 1, y + 1) - p(x - 1, y + 1));
      const gy = 3 * (p(x - 1, y + 1) - p(x - 1, y - 1)) + 10 * (p(x, y + 1) - p(x, y - 1)) + 3 * (p(x + 1, y + 1) - p(x + 1, y - 1));
      const m = Math.hypot(gx, gy);
      out[y * width + x] = m;
      if (m > max) max = m;
    }
  }
  if (max > 0) for (let i = 0; i < out.length; i++) out[i] /= max;
  return out;
}

/** Central-difference gradient of a scalar field, edges clamped. */
function gradientOf(f: Float32Array, width: number, height: number): { u: Float32Array; v: Float32Array } {
  const u = new Float32Array(f.length), v = new Float32Array(f.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      u[i] = (f[y * width + Math.min(width - 1, x + 1)] - f[y * width + Math.max(0, x - 1)]) / 2;
      v[i] = (f[Math.min(height - 1, y + 1) * width + x] - f[Math.max(0, y - 1) * width + x]) / 2;
    }
  }
  return { u, v };
}

/**
 * Gradient vector flow (Xu & Prince 1998): the field (u, v) minimising
 * μ|∇u|² + μ|∇v|² + |∇f|²|w − ∇f|² — equal to ∇f near edges, smoothly diffused elsewhere.
 */
export function computeGVF(edge: Float32Array, width: number, height: number, mu: number, iterations: number): { u: Float32Array; v: Float32Array } {
  const { u: fx, v: fy } = gradientOf(edge, width, height);
  const n = edge.length;
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) b[i] = fx[i] * fx[i] + fy[i] * fy[i];
  let u = Float32Array.from(fx), v = Float32Array.from(fy);
  const dt = Math.min(1, 0.24 / Math.max(mu, 1e-6)); // explicit scheme is stable for dt·μ ≤ 1/4
  for (let it = 0; it < iterations; it++) {
    const nu = new Float32Array(n), nv = new Float32Array(n);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const l = y * width + Math.max(0, x - 1), r = y * width + Math.min(width - 1, x + 1);
        const t = Math.max(0, y - 1) * width + x, d = Math.min(height - 1, y + 1) * width + x;
        const lu = u[l] + u[r] + u[t] + u[d] - 4 * u[i];
        const lv = v[l] + v[r] + v[t] + v[d] - 4 * v[i];
        nu[i] = u[i] + dt * (mu * lu - b[i] * (u[i] - fx[i]));
        nv[i] = v[i] + dt * (mu * lv - b[i] * (v[i] - fy[i]));
      }
    }
    u = nu; v = nv;
  }
  return { u, v };
}

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

function area(d: Uint8Array): number {
  let s = 0;
  for (let i = 0; i < d.length; i++) s += d[i];
  return s;
}

/** 3×3 majority vote (curvature smoothing): a pixel is in if ≥ 5 of its 9 are. */
function majority(d: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(d.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let c = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < width && yy < height) c += d[yy * width + xx];
        }
      }
      out[y * width + x] = c >= 5 ? 1 : 0;
    }
  }
  return out;
}

function dilate(d: Uint8Array, width: number, height: number): Uint8Array {
  const out = Uint8Array.from(d);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (d[y * width + x]) continue;
      for (const [dx, dy] of N4) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < width && yy < height && d[yy * width + xx]) { out[y * width + x] = 1; break; }
      }
    }
  }
  return out;
}

function erode(d: Uint8Array, width: number, height: number): Uint8Array {
  const out = Uint8Array.from(d);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!d[y * width + x]) continue;
      for (const [dx, dy] of N4) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= width || yy >= height || !d[yy * width + xx]) { out[y * width + x] = 0; break; }
      }
    }
  }
  return out;
}

/** Discrete active contour: boundary pixels move along the force field's outward component. */
function pixelSnake(mask: Uint8Array, width: number, height: number, fu: Float32Array, fv: Float32Array, stop: Float32Array, balloon: number, iterations: number): Uint8Array {
  // Normalise the force field so one threshold suits every image.
  let fmax = 0;
  for (let i = 0; i < fu.length; i++) fmax = Math.max(fmax, Math.hypot(fu[i], fv[i]));
  const s = fmax > 0 ? 1 / fmax : 0;
  const TAU = 0.02;
  let cur = Uint8Array.from(mask);
  for (let it = 0; it < iterations; it++) {
    // Outward normal from the smoothed mask: −∇(blur(mask)).
    const soft = gaussianBlur(cur, width, height, 1);
    const { u: nu, v: nv } = gradientOf(soft, width, height);
    const next = Uint8Array.from(cur);
    let changed = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        let edgeOfMask = false;
        for (const [dx, dy] of N4) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
          if (cur[yy * width + xx] !== cur[i]) { edgeOfMask = true; break; }
        }
        if (!edgeOfMask) continue;
        const nl = Math.hypot(nu[i], nv[i]);
        if (nl < 1e-9) continue;
        const ox = -nu[i] / nl, oy = -nv[i] / nl;
        const speed = s * (fu[i] * ox + fv[i] * oy) + balloon * stop[i];
        if (!cur[i] && speed > TAU) { next[i] = 1; changed++; }
        else if (cur[i] && speed < -TAU) { next[i] = 0; changed++; }
      }
    }
    cur = next;
    if (!changed) break;
  }
  return majority(cur, width, height);
}

/** Morphological geodesic active contour (MorphGAC), with SegWorks' area guard. */
function morphSnake(mask: Uint8Array, width: number, height: number, edge: Float32Array, o: SnakeOptions): Uint8Array {
  const ew = Math.min(1, Math.max(0, o.edgeWeight));
  const g = new Float32Array(edge.length);
  for (let i = 0; i < g.length; i++) g[i] = 1 / (1 + 9 * edge[i] * edge[i]);
  const theta = 0.6 - 0.3 * ew; // balloon acts only where g > θ (away from edges)
  const { u: gu, v: gv } = gradientOf(g, width, height);
  let cur: Uint8Array = Uint8Array.from(mask);
  const iterations = Math.min(8, Math.max(1, Math.round(o.iterations)));
  for (let it = 0; it < iterations; it++) {
    const before = area(cur);
    let next = cur;
    if (o.balloon !== 0) {
      const moved = o.balloon > 0 ? dilate(cur, width, height) : erode(cur, width, height);
      next = Uint8Array.from(cur);
      for (let i = 0; i < next.length; i++) if (g[i] > theta) next[i] = moved[i];
    }
    // Image attachment: move toward lower g (the edge) along ∇u.
    const { u: uu, v: uv } = gradientOf(Float32Array.from(next), width, height);
    const attached = Uint8Array.from(next);
    for (let i = 0; i < attached.length; i++) {
      const dot = uu[i] * gu[i] + uv[i] * gv[i];
      if (dot > 1e-6) attached[i] = 1;
      else if (dot < -1e-6) attached[i] = 0;
    }
    const smoothed = majority(attached, width, height);
    // SegWorks' safety stop, per step: a step that grows the mask by more than 15 % (a leak)
    // or shrinks it by more than 30 % is not taken, and evolution ends.
    const a = area(smoothed);
    if (a > before * 1.15 || a < before * 0.7) break;
    cur = smoothed;
  }
  return cur;
}

/** Refine `mask` toward the edges of `image` (same plane geometry). */
export function snakeRefine(mask: MaskPlane, image: ArrayLike<number>, options: Partial<SnakeOptions> = {}, ctx: SnakeContext = {}): MaskPlane {
  const o = { ...DEFAULT_SNAKE, ...options };
  const { width, height } = mask;
  const edge = edgeMap(image, width, height, o.preSmoothSigma);
  let result: Uint8Array;
  if (o.variant === 'morph') {
    result = morphSnake(mask.data, width, height, edge, o);
  } else {
    const field = o.variant === 'gvf' ? computeGVF(edge, width, height, o.gvfMu, o.gvfIterations) : gradientOf(edge, width, height);
    const stop = new Float32Array(edge.length);
    for (let i = 0; i < stop.length; i++) stop[i] = 1 / (1 + 9 * edge[i] * edge[i]);
    const balloon = o.variant === 'balloon' ? o.balloon : 0;
    result = pixelSnake(mask.data, width, height, field.u, field.v, stop, balloon, Math.min(100, Math.max(1, Math.round(o.iterations))));
  }
  return { width, height, data: competeWithNeighbours(mask.data, result, width, height, ctx) };
}

/**
 * Apply the neighbour rules (#201) and the ROI to a proposed result: protected pixels are
 * never taken; other segments' pixels only when replacement is allowed and they touch the
 * original segment; outside the ROI nothing changes.
 */
export function competeWithNeighbours(original: Uint8Array, proposed: Uint8Array, width: number, height: number, ctx: SnakeContext): Uint8Array {
  const out = Uint8Array.from(proposed);
  const touching = ctx.allowReplace ? dilate(original, width, height) : null;
  for (let i = 0; i < out.length; i++) {
    if (ctx.roi && !ctx.roi[i]) { out[i] = original[i]; continue; }
    if (out[i] && !original[i]) {
      if (ctx.protect?.[i]) out[i] = 0;
      else if (ctx.others?.[i] && !(touching && touching[i])) out[i] = 0;
    }
  }
  return out;
}
