/**
 * Cleanup operations on one segment's binary plane (SegWorks parity, branch 1 S1 —
 * inventory #188–205, #29). Behaviour follows SegWorks v2.0.610's `_volCleanOp`, written
 * fresh against `MaskPlane`; where SegWorks was ambiguous or wrong the choice is
 * documented on the function (magnet bridge, border handling).
 *
 * Every function is pure: it returns a NEW plane (or arrays) and never mutates its input.
 * What may actually be written — other members' pixels, locks, ROI — is the transaction
 * layer's decision, not these functions'.
 */
import { labelComponents, type MaskPlane, type PlaneSpacing } from './plane';

function withData(p: MaskPlane, data: Uint8Array): MaskPlane {
  return { width: p.width, height: p.height, data };
}

// ─── Component operations ────────────────────────────────────────────────────

export interface FillHolesOptions {
  /** Only holes with area ≤ this (mm²) are filled. Default: every enclosed hole. */
  maxHoleAreaMm2?: number;
}

/**
 * Fill enclosed background regions. Background is 4-connected (the dual of the
 * 8-connected foreground), so a hole whose only way out is a diagonal gap between two
 * wall pixels counts as enclosed — the wall is one 8-connected island.
 */
export function fillHoles(p: MaskPlane, spacing: PlaneSpacing, opts: FillHolesOptions = {}): MaskPlane {
  // Only the set pixels' box, grown by one, can hold a hole: the background around it reaches
  // the plane border, so a component reaching the box's edge is not enclosed either (O8).
  const box = reach(p, 1);
  if (!box) return withData(p, new Uint8Array(p.data));
  const cw = box.x1 - box.x0 + 1;
  const ch = box.y1 - box.y0 + 1;
  if (cw === p.width && ch === p.height) return fillHolesIn(p, spacing, opts);
  const crop = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) crop.set(p.data.subarray(box.x0 + (box.y0 + y) * p.width, box.x0 + (box.y0 + y) * p.width + cw), y * cw);
  const filled = fillHolesIn({ width: cw, height: ch, data: crop }, spacing, opts).data;
  const out = new Uint8Array(p.data);
  for (let y = 0; y < ch; y++) out.set(filled.subarray(y * cw, (y + 1) * cw), box.x0 + (box.y0 + y) * p.width);
  return withData(p, out);
}

function fillHolesIn(p: MaskPlane, spacing: PlaneSpacing, opts: FillHolesOptions): MaskPlane {
  const { width: w, height: h } = p;
  const bg = labelComponents(p.data, w, h, 4, 0);
  const touchesBorder = new Uint8Array(bg.count + 1);
  for (let x = 0; x < w; x++) {
    touchesBorder[bg.labels[x]] = 1;
    touchesBorder[bg.labels[x + (h - 1) * w]] = 1;
  }
  for (let y = 0; y < h; y++) {
    touchesBorder[bg.labels[y * w]] = 1;
    touchesBorder[bg.labels[w - 1 + y * w]] = 1;
  }
  const pxArea = spacing.x * spacing.y;
  const maxArea = opts.maxHoleAreaMm2 ?? Infinity;
  const out = new Uint8Array(p.data);
  for (let i = 0; i < out.length; i++) {
    const id = bg.labels[i];
    if (id === 0 || touchesBorder[id]) continue;
    if (bg.sizes[id] * pxArea <= maxArea) out[i] = 1;
  }
  return withData(p, out);
}

export interface KeepLargestOptions {
  /** Also keep components at least this % of the largest's size (0 = only the largest). */
  alsoKeepPct?: number;
}

export function keepLargest(p: MaskPlane, opts: KeepLargestOptions = {}): MaskPlane {
  const cc = labelComponents(p.data, p.width, p.height);
  if (cc.count <= 1) return withData(p, new Uint8Array(p.data));
  let largest = 0;
  for (let id = 1; id <= cc.count; id++) largest = Math.max(largest, cc.sizes[id]);
  const pct = opts.alsoKeepPct ?? 0;
  const floor = pct > 0 ? (pct / 100) * largest : largest;
  let keptLargest = false;
  const keep = new Uint8Array(cc.count + 1);
  for (let id = 1; id <= cc.count; id++) {
    // Ties at the largest size keep only the first — "keep largest" yields one component.
    if (cc.sizes[id] === largest && pct <= 0) {
      if (!keptLargest) keep[id] = 1;
      keptLargest = true;
    } else if (cc.sizes[id] >= floor) keep[id] = 1;
  }
  const out = new Uint8Array(p.data.length);
  for (let i = 0; i < out.length; i++) if (keep[cc.labels[i]]) out[i] = 1;
  return withData(p, out);
}

export interface RemoveSpecklesOptions {
  /** Components smaller than this area (mm²) are removed. */
  minAreaMm2: number;
}

export function removeSpeckles(p: MaskPlane, spacing: PlaneSpacing, opts: RemoveSpecklesOptions): MaskPlane {
  const cc = labelComponents(p.data, p.width, p.height);
  const pxArea = spacing.x * spacing.y;
  const out = new Uint8Array(p.data);
  for (let i = 0; i < out.length; i++) {
    const id = cc.labels[i];
    if (id !== 0 && cc.sizes[id] * pxArea < opts.minAreaMm2) out[i] = 0;
  }
  return withData(p, out);
}

export interface RemoveStraysOptions {
  /** Components whose centroid is farther than this (mm) from the largest's are removed. */
  maxDistanceMm: number;
  /** Components at least this % of the largest's size are never removed. Default 15. */
  protectPct?: number;
}

export function removeStrays(p: MaskPlane, spacing: PlaneSpacing, opts: RemoveStraysOptions): MaskPlane {
  const cc = labelComponents(p.data, p.width, p.height);
  if (cc.count <= 1) return withData(p, new Uint8Array(p.data));
  let big = 1;
  for (let id = 2; id <= cc.count; id++) if (cc.sizes[id] > cc.sizes[big]) big = id;
  const protectPct = opts.protectPct ?? 15;
  const protectSize = protectPct > 0 ? Math.max(1, (protectPct / 100) * cc.sizes[big]) : Infinity;
  const remove = new Uint8Array(cc.count + 1);
  const c0 = cc.centroids[big];
  for (let id = 1; id <= cc.count; id++) {
    if (id === big || cc.sizes[id] >= protectSize) continue;
    const dx = (cc.centroids[id].x - c0.x) * spacing.x;
    const dy = (cc.centroids[id].y - c0.y) * spacing.y;
    if (Math.hypot(dx, dy) > opts.maxDistanceMm) remove[id] = 1;
  }
  const out = new Uint8Array(p.data);
  for (let i = 0; i < out.length; i++) if (remove[cc.labels[i]]) out[i] = 0;
  return withData(p, out);
}

// ─── Smoothing ───────────────────────────────────────────────────────────────

/**
 * The window a neighbourhood operation of radius `r` can set pixels in: the set pixels'
 * bounding box grown by `r`, clipped to the plane — null when nothing is set. Outside it
 * every window is empty, so a vote / blur thresholded above 0 leaves it 0 (O8).
 */
function reach(p: MaskPlane, r: number): { x0: number; x1: number; y0: number; y1: number } | null {
  const { width: w, height: h, data } = p;
  let x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (!data[row + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { x0: Math.max(0, x0 - r), x1: Math.min(w - 1, x1 + r), y0: Math.max(0, y0 - r), y1: Math.min(h - 1, y1 + r) };
}

/** Majority vote over a (2r+1)² window, clipped at the plane edge. */
export function medianSmooth(p: MaskPlane, opts: { radius: number }): MaskPlane {
  const { width: w, data } = p;
  const r = Math.max(1, Math.floor(opts.radius));
  const out = new Uint8Array(data.length);
  const h = p.height;
  const box = reach(p, r);
  if (!box) return withData(p, out);
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      let set = 0;
      let total = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          total++;
          if (data[xx + yy * w]) set++;
        }
      }
      out[x + y * w] = set > total / 2 ? 1 : 0;
    }
  }
  return withData(p, out);
}

/** Blur with a normalised kernel (clipped at the edge, renormalised) and re-threshold. */
function convolveThreshold(p: MaskPlane, kernel: Float64Array, radius: number, threshold: number): MaskPlane {
  const { width: w, height: h, data } = p;
  const kw = 2 * radius + 1;
  const out = new Uint8Array(data.length);
  const box = threshold > 0 ? reach(p, radius) : { x0: 0, x1: w - 1, y0: 0, y1: h - 1 };
  if (!box) return withData(p, out);
  for (let y = box.y0; y <= box.y1; y++) {
    for (let x = box.x0; x <= box.x1; x++) {
      let sum = 0;
      let wsum = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const k = kernel[dx + radius + (dy + radius) * kw];
          wsum += k;
          if (data[xx + yy * w]) sum += k;
        }
      }
      out[x + y * w] = wsum > 0 && sum / wsum >= threshold ? 1 : 0;
    }
  }
  return withData(p, out);
}

export interface GaussianSmoothOptions {
  /** Kernel σ in pixels. */
  sigma: number;
  /** Re-threshold level; SegWorks' default 0.45 keeps slightly more than half. */
  threshold?: number;
}

/**
 * Gaussian blur (clipped at the plane edge, renormalised) and re-threshold — SEPARABLY: the
 * 2D kernel is g(dx)·g(dy) and the edge-clipped weight sum factors the same way, so a row
 * pass then a column pass give the 2D convolution in 2(2r+1) multiplies a pixel, not
 * (2r+1)² (σ = 4: 50, not 625 — O8). Only the set pixels' reach is computed. It equals the 2D
 * form up to floating-point rounding (cleanup.test compares the two on painted masks).
 */
export function gaussianSmooth(p: MaskPlane, opts: GaussianSmoothOptions): MaskPlane {
  const sigma = Math.max(0.1, opts.sigma);
  const r = Math.ceil(sigma * 3);
  const threshold = opts.threshold ?? 0.45;
  const { width: w, height: h, data } = p;
  const out = new Uint8Array(data.length);
  if (!(threshold > 0)) return withData(p, out.fill(1)); // every renormalised blur value is ≥ 0
  const box = reach(p, r);
  if (!box) return withData(p, out);
  const g = new Float64Array(2 * r + 1);
  for (let d = -r; d <= r; d++) g[d + r] = Math.exp(-(d * d) / (2 * sigma * sigma));
  // Weight of the kernel's part inside the plane, per column / row (the edge clipping).
  const clipped = (n: number) => Float64Array.from({ length: n }, (_, c) => {
    let s = 0;
    for (let d = Math.max(-r, -c); d <= Math.min(r, n - 1 - c); d++) s += g[d + r];
    return s;
  });
  const wx = clipped(w);
  const wy = clipped(h);
  // Row pass over the box: a row outside it is more than r from every set pixel, so sums to 0.
  const bw = box.x1 - box.x0 + 1;
  const rowsLo = box.y0, rowsHi = box.y1; // rows beyond the box hold no set pixel
  const rowSum = new Float64Array(bw * (rowsHi - rowsLo + 1));
  for (let y = rowsLo; y <= rowsHi; y++) {
    const src = y * w;
    const dst = (y - rowsLo) * bw;
    for (let x = box.x0; x <= box.x1; x++) {
      let s = 0;
      const lo = Math.max(-r, -x), hi = Math.min(r, w - 1 - x);
      for (let dx = lo; dx <= hi; dx++) if (data[src + x + dx]) s += g[dx + r];
      rowSum[dst + x - box.x0] = s;
    }
  }
  for (let y = box.y0; y <= box.y1; y++) {
    const lo = Math.max(-r, -y, rowsLo - y), hi = Math.min(r, h - 1 - y, rowsHi - y);
    for (let x = box.x0; x <= box.x1; x++) {
      let s = 0;
      for (let dy = lo; dy <= hi; dy++) s += g[dy + r] * rowSum[(y + dy - rowsLo) * bw + x - box.x0];
      out[x + y * w] = s / (wx[x] * wy[y]) >= threshold ? 1 : 0;
    }
  }
  return withData(p, out);
}

/**
 * A light 3×3 weighted vote ([1 2 1; 2 4 2; 1 2 1]/16) that rounds isolated jagged
 * pixels without a global blur. `strength` 0.5 (default) thresholds at 0.5; higher
 * strength lowers the threshold (keeps/fills more), as in SegWorks.
 */
export function smoothEdges(p: MaskPlane, opts: { strength?: number } = {}): MaskPlane {
  const kernel = Float64Array.from([1, 2, 1, 2, 4, 2, 1, 2, 1]);
  const strength = opts.strength ?? 0.5;
  return convolveThreshold(p, kernel, 1, 0.5 - (strength - 0.5) * 0.15);
}

// ─── Morphology (square structuring element, as SegWorks) ───────────────────

function erode(data: Uint8Array, w: number, h: number, r: number): Uint8Array {
  // Outside the plane counts as background, so the plane edge erodes (SegWorks behaviour).
  const out = new Uint8Array(data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!data[x + y * w]) continue;
      let ok = 1;
      for (let dy = -r; dy <= r && ok; dy++) {
        const yy = y + dy;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (yy < 0 || yy >= h || xx < 0 || xx >= w || !data[xx + yy * w]) { ok = 0; break; }
        }
      }
      out[x + y * w] = ok;
    }
  }
  return out;
}

function dilate(data: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!data[x + y * w]) continue;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w) out[xx + yy * w] = 1;
        }
      }
    }
  }
  return out;
}

/** Erode then dilate: removes protrusions and bridges thinner than 2r+1. */
export function openMask(p: MaskPlane, opts: { radius: number }): MaskPlane {
  const r = Math.max(1, Math.floor(opts.radius));
  return withData(p, dilate(erode(p.data, p.width, p.height, r), p.width, p.height, r));
}

/** Dilate then erode: seals grooves and gaps narrower than 2r+1. */
export function closeMask(p: MaskPlane, opts: { radius: number }): MaskPlane {
  const r = Math.max(1, Math.floor(opts.radius));
  return withData(p, erode(dilate(p.data, p.width, p.height, r), p.width, p.height, r));
}

// ─── Anisotropic diffusion (Perona & Malik 1990) ─────────────────────────────

export interface AnisotropicDiffusionOptions {
  /** Iterations (1–50). */
  iterations: number;
  /** Edge-stopping scale κ, in image intensity units (5–200). */
  kappa: number;
  /** 'exp': g = exp(−(∇/κ)²), gentler. 'quadratic': g = 1/(1+(∇/κ)²), sharper. */
  conduction: 'exp' | 'quadratic';
  /** The image under the plane (same layout). Without it the mask diffuses freely. */
  image?: ArrayLike<number>;
}

/**
 * Diffuse the mask as a 0–1 field inside a ±3 px band around its boundary, with
 * conductance from the IMAGE gradient: where the image has a strong edge, the mask
 * does not flow across it, so boundaries the anatomy supports survive while unsupported
 * jaggedness melts. Re-thresholded at 0.5. The outermost frame is held fixed, as in
 * SegWorks (dt = 0.125, the 4-neighbour stability limit).
 */
export function anisotropicDiffusion(p: MaskPlane, opts: AnisotropicDiffusionOptions): MaskPlane {
  const { width: w, height: h, data } = p;
  const n = data.length;
  const iterations = Math.max(1, Math.min(50, Math.floor(opts.iterations)));
  const kappa = Math.max(5, Math.min(200, opts.kappa));
  const k2 = kappa * kappa;
  const g = opts.conduction === 'quadratic'
    ? (d: number) => 1 / (1 + (d * d) / k2)
    : (d: number) => Math.exp(-(d * d) / k2);
  const img = opts.image;

  const BAND = 3;
  const band = new Uint8Array(n);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = x + y * w;
      const v = data[i];
      if (v === data[i - 1] && v === data[i + 1] && v === data[i - w] && v === data[i + w]) continue;
      for (let dy = -BAND; dy <= BAND; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -BAND; dx <= BAND; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w) band[xx + yy * w] = 1;
        }
      }
    }
  }

  const dt = 0.125;
  let field = new Float32Array(n);
  for (let i = 0; i < n; i++) field[i] = data[i] ? 1 : 0;
  for (let t = 0; t < iterations; t++) {
    const prev = field;
    field = new Float32Array(prev);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = x + y * w;
        if (!band[i]) continue;
        const cN = img ? g(img[i - w] - img[i]) : 1;
        const cS = img ? g(img[i + w] - img[i]) : 1;
        const cE = img ? g(img[i + 1] - img[i]) : 1;
        const cW = img ? g(img[i - 1] - img[i]) : 1;
        const v = prev[i] + dt * (
          cN * (prev[i - w] - prev[i]) + cS * (prev[i + w] - prev[i])
          + cE * (prev[i + 1] - prev[i]) + cW * (prev[i - 1] - prev[i])
        );
        field[i] = v < 0 ? 0 : v > 1 ? 1 : v;
      }
    }
  }
  const out = new Uint8Array(data);
  for (let i = 0; i < n; i++) if (band[i]) out[i] = field[i] >= 0.5 ? 1 : 0;
  return withData(p, out);
}

// ─── Magnet bridge ───────────────────────────────────────────────────────────

export interface MagnetBridgeInput {
  width: number;
  height: number;
  source: Uint8Array;
  target: Uint8Array;
  /** Pixels owned by other members. 'fill' never crosses or claims them; 'overwrite' may. */
  blocked?: Uint8Array;
  /** Pixels never crossed or claimed in either mode (e.g. a locked member's). */
  protectedMask?: Uint8Array;
  /** Longest gap (pixels, 4-connected steps) that may be bridged. */
  maxGapPx: number;
  mode: 'fill' | 'overwrite';
}

export interface MagnetBridgeResult {
  /** The new target plane. */
  target: Uint8Array;
  /** Pixels taken from `blocked` (overwrite mode) — the caller clears them from their owners. */
  claimed: Uint8Array;
  /** Pixels newly added to the target. */
  written: number;
}

/**
 * Join a Source segment to a Target segment across a small gap by growing the Target.
 *
 * The bridge zone is every pixel lying on some path of at most `maxGapPx` free pixels
 * between the two: with dS / dT the step distance from the nearest source / target pixel,
 * a free pixel is in the zone when dS + dT ≤ maxGapPx + 1. SegWorks instead filled only
 * pixels nearer the target than the source, which stops one pixel short and never
 * actually joins them; this definition closes the gap. The source is never modified.
 */
export function magnetBridge(input: MagnetBridgeInput): MagnetBridgeResult {
  const { width: w, height: h, source, target, blocked, protectedMask, mode } = input;
  const n = w * h;
  const gap = Math.max(1, Math.floor(input.maxGapPx));
  const passable = (i: number) => !protectedMask?.[i] && (mode === 'overwrite' || !blocked?.[i]);

  const distance = (seedMask: Uint8Array, otherMask: Uint8Array): Int32Array => {
    const dist = new Int32Array(n).fill(0x3fffffff);
    const queue = new Int32Array(n);
    let head = 0;
    let tail = 0;
    for (let i = 0; i < n; i++) if (seedMask[i]) { dist[i] = 0; queue[tail++] = i; }
    while (head < tail) {
      const i = queue[head++];
      const d = dist[i] + 1;
      if (d > gap + 1) continue;
      const y = (i / w) | 0;
      const x = i - y * w;
      const nbrs = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of nbrs) {
        if (j < 0 || dist[j] <= d || seedMask[j]) continue;
        // Reaching the other segment ends a path; it is not travelled through.
        if (otherMask[j]) { dist[j] = d; continue; }
        if (!passable(j)) continue;
        dist[j] = d;
        queue[tail++] = j;
      }
    }
    return dist;
  };

  const dS = distance(source, target);
  const dT = distance(target, source);
  const out = new Uint8Array(target);
  const claimed = new Uint8Array(n);
  let written = 0;
  for (let i = 0; i < n; i++) {
    if (source[i] || target[i] || !passable(i)) continue;
    if (dS[i] + dT[i] > gap + 1) continue;
    out[i] = 1;
    written++;
    if (blocked?.[i]) claimed[i] = 1;
  }
  return { target: out, claimed, written };
}
