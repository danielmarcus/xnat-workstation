/**
 * Live Wire path costs (SegWorks parity branch 6, F1; inventory #75–79).
 *
 * Pure. Live Wire (intelligent scissors, Mortensen & Barrett 1995) finds the cheapest path
 * between anchors; cheap pixels are on boundaries. Cornerstone's LivewireScissors computes
 * its own maps with fixed weights (0.43 gradient, 0.43 Laplacian, 0.11 direction); the
 * Advanced mode here builds the same three cues from a pre-smoothed image with a chosen
 * gradient kernel, and weights them as the user sets (SegWorks defaults: gradient 0.85,
 * direction 0.15, Laplacian 0.12, σ 0.8, Scharr). F2 supplies these maps to a subclass of
 * the scissors, so Cornerstone's search and tool stay as they are.
 *
 *  - gradient cost: 1 − |∇I| / max|∇I|  (0 on the strongest edge, 1 on flat image)
 *  - Laplacian cue: 0 at a zero crossing of ∇²I (the edge's centre), else 1
 *  - direction cost (per link): penalises a link that runs across the local edge direction
 */

export interface LivewireCostOptions {
  /** Weight of the gradient-magnitude cost (#75). */
  gradientWeight: number;
  /** Weight of the edge-direction consistency cost (#77). */
  directionWeight: number;
  /** Weight of the Laplacian zero-crossing cue (#79). */
  laplacianWeight: number;
  /** Gaussian pre-smoothing σ in pixels; 0 = none (#78). */
  preSmoothSigma: number;
  /** Gradient kernel (#76). */
  edgeKernel: 'scharr' | 'sobel';
}

export const DEFAULT_LIVEWIRE_COST: LivewireCostOptions = {
  gradientWeight: 0.85,
  directionWeight: 0.15,
  laplacianWeight: 0.12,
  preSmoothSigma: 0.8,
  edgeKernel: 'scharr',
};

export interface LivewireCostMaps {
  width: number;
  height: number;
  /** 1 − normalised gradient magnitude. */
  gradientCost: Float32Array;
  /** 0 at a Laplacian zero crossing, 1 elsewhere. */
  laplacianCue: Float32Array;
  /** Gradient components of the smoothed image (for the direction term). */
  gx: Float32Array;
  gy: Float32Array;
}

/** Separable Gaussian blur, edges clamped. σ ≤ 0 returns a copy. */
export function gaussianBlur(image: ArrayLike<number>, width: number, height: number, sigma: number): Float32Array {
  const src = Float32Array.from(image as ArrayLike<number>);
  if (!(sigma > 0)) return src;
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); sum += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = 0;
      for (let i = -r; i <= r; i++) v += k[i + r] * src[y * width + Math.min(width - 1, Math.max(0, x + i))];
      tmp[y * width + x] = v;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = 0;
      for (let i = -r; i <= r; i++) v += k[i + r] * tmp[Math.min(height - 1, Math.max(0, y + i)) * width + x];
      out[y * width + x] = v;
    }
  }
  return out;
}

/** The three cost cues for an image (any intensity scale; it is normalised). */
export function livewireCostMaps(image: ArrayLike<number>, width: number, height: number, options: Partial<LivewireCostOptions> = {}): LivewireCostMaps {
  const o = { ...DEFAULT_LIVEWIRE_COST, ...options };
  const img = gaussianBlur(image, width, height, o.preSmoothSigma);
  const n = width * height;
  const gx = new Float32Array(n), gy = new Float32Array(n), mag = new Float32Array(n), lap = new Float32Array(n);
  const p = (x: number, y: number) => img[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))];
  // Scharr [3 10 3]/32 or Sobel [1 2 1]/8, normalised so a unit step gives |∇| ≈ 1.
  const [c, e, norm] = o.edgeKernel === 'scharr' ? [3, 10, 32] : [1, 2, 8];
  let max = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const a = p(x - 1, y - 1), b = p(x, y - 1), cc = p(x + 1, y - 1);
      const d = p(x - 1, y), f = p(x + 1, y);
      const g = p(x - 1, y + 1), h = p(x, y + 1), k = p(x + 1, y + 1);
      gx[i] = (c * (cc - a) + e * (f - d) + c * (k - g)) / norm;
      gy[i] = (c * (g - a) + e * (h - b) + c * (k - cc)) / norm;
      mag[i] = Math.hypot(gx[i], gy[i]);
      if (mag[i] > max) max = mag[i];
      lap[i] = b + d + f + h - 4 * p(x, y);
    }
  }
  const gradientCost = new Float32Array(n);
  for (let i = 0; i < n; i++) gradientCost[i] = max > 0 ? 1 - mag[i] / max : 1;
  // Zero crossing: the Laplacian changes sign to a 4-neighbour, and this pixel is the one
  // nearer zero (so a crossing marks one pixel, not two). Weak crossings (|∇| < 5 % of the
  // strongest) are noise, not edges.
  const laplacianCue = new Float32Array(n).fill(1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (max === 0 || mag[i] < 0.05 * max) continue;
      const v = lap[i];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const w = lap[ny * width + nx];
        if (v * w < 0 && Math.abs(v) <= Math.abs(w)) { laplacianCue[i] = 0; break; }
      }
    }
  }
  return { width, height, gradientCost, laplacianCue, gx, gy };
}

const TWO_THIRD_PI = 2 / (3 * Math.PI);

/**
 * Direction cost of the link a → b (8-neighbours), as in Mortensen & Barrett: 0 when the
 * link runs along the edge at both ends, up to 1 when it cuts across. Flat pixels (no
 * gradient) cost 1/2 either way.
 */
export function directionCost(maps: LivewireCostMaps, ax: number, ay: number, bx: number, by: number): number {
  const unit = (x: number, y: number) => {
    const i = y * maps.width + x;
    const l = Math.hypot(maps.gx[i], maps.gy[i]);
    return l < 1e-12 ? null : [maps.gx[i] / l, maps.gy[i] / l];
  };
  const ua = unit(ax, ay), ub = unit(bx, by);
  if (!ua || !ub) return 0.5;
  // Edge direction is the gradient rotated 90°: D = (gy, −gx).
  let dp = ua[1] * (bx - ax) - ua[0] * (by - ay);
  let dq = ub[1] * (bx - ax) - ub[0] * (by - ay);
  if (dp < 0) { dp = -dp; dq = -dq; }
  if (ax !== bx && ay !== by) { dp *= Math.SQRT1_2; dq *= Math.SQRT1_2; }
  const v = TWO_THIRD_PI * (Math.acos(Math.min(dp, 1)) + Math.acos(Math.min(Math.max(dq, -1), 1)));
  return Number.isFinite(v) ? v : 1;
}

/** Cost of stepping from pixel a to its 8-neighbour b. */
export function linkCost(maps: LivewireCostMaps, ax: number, ay: number, bx: number, by: number, options: Partial<LivewireCostOptions> = {}): number {
  const o = { ...DEFAULT_LIVEWIRE_COST, ...options };
  const i = by * maps.width + bx;
  let g = maps.gradientCost[i];
  if (ax === bx || ay === by) g *= Math.SQRT1_2; // as Cornerstone: straight links are shorter
  return o.gradientWeight * g + o.laplacianWeight * maps.laplacianCue[i] + o.directionWeight * directionCost(maps, ax, ay, bx, by);
}
