/**
 * Slice-to-slice mask propagation (SegWorks parity #169–181; branch 3 I3).
 *
 * Starting from a painted slice, each next slice takes the region whose intensity fits the
 * segment's (CT: within ±HU of the reference; MR: within kσ) and that is connected to the
 * previous slice's mask — optionally limited to a few pixels of growth, hole-filled and kept
 * off strong image edges. The walk stops after a maximum number of slices, when nothing
 * qualifies, or when the area jumps by more than the allowed fraction (a leak into
 * neighbouring tissue of similar intensity).
 *
 * The reference intensity is re-estimated from each previous slice (mean), or — in
 * stable mode — fixed from the seed slice (median, robust to stray voxels).
 */
import { labelComponents, type MaskPlane } from '../maskOps/plane';
import { fillHoles } from '../maskOps/cleanup';
import { sobelMagnitude } from './interpolate';

export interface PropagateOptions {
  modality: 'ct' | 'mr';
  /** CT: accept |HU − reference| ≤ this. */
  huTolerance: number;
  /** MR: accept |value − reference| ≤ sigma × the reference spread. */
  sigma: number;
  /** Fix the reference from the seed slice (median) instead of re-estimating each slice. */
  stable: boolean;
  /** How far (pixels) the region may grow beyond the previous slice's mask; 0 = no limit. */
  growPx: number;
  fillHoles: boolean;
  /** Treat strong image edges as walls. */
  edgeGuard: boolean;
  /** Stop when the area changes by more than this fraction from one slice to the next. */
  maxAreaChange: number;
}

export const DEFAULT_PROPAGATE: PropagateOptions = {
  modality: 'ct', huTolerance: 150, sigma: 2, stable: true, growPx: 0, fillHoles: true, edgeGuard: false, maxAreaChange: 0.6,
};

export interface IntensityReference {
  centre: number;
  spread: number;
}

/** Reference intensity of the image under a mask: mean or median, and the standard deviation. */
export function intensityReference(mask: MaskPlane, image: ArrayLike<number>, robust: boolean): IntensityReference | null {
  const v: number[] = [];
  for (let i = 0; i < mask.data.length; i++) if (mask.data[i]) v.push(image[i]);
  if (!v.length) return null;
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const spread = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length) || 1;
  if (!robust) return { centre: mean, spread };
  v.sort((a, b) => a - b);
  return { centre: v[Math.floor(v.length / 2)], spread };
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
          if (xx >= 0 && xx < w && dx * dx + dy * dy <= r * r) out[xx + yy * w] = 1;
        }
      }
    }
  }
  return out;
}

/**
 * The next slice's mask from the previous one, or null to stop (nothing qualifies, or the
 * area jumped by more than `maxAreaChange`).
 */
export function propagateStep(
  prev: MaskPlane,
  image: ArrayLike<number>,
  ref: IntensityReference,
  o: PropagateOptions,
  /** Area the runaway check compares against (default: the previous mask's). */
  compareArea?: number,
): MaskPlane | null {
  const { width: w, height: h } = prev;
  const grown = o.growPx > 0 ? dilate(prev.data, w, h, Math.round(o.growPx)) : null;
  const edge = o.edgeGuard ? sobelMagnitude(image, w, h) : null;
  const lo = o.modality === 'ct' ? ref.centre - o.huTolerance : ref.centre - o.sigma * ref.spread;
  const hi = o.modality === 'ct' ? ref.centre + o.huTolerance : ref.centre + o.sigma * ref.spread;
  const cand = new Uint8Array(w * h);
  for (let i = 0; i < cand.length; i++) {
    if (grown && !grown[i]) continue;
    const v = image[i];
    if (v < lo || v > hi) continue;
    if (edge && edge[i] > 0.5) continue;
    cand[i] = 1;
  }
  // Keep the parts connected to (overlapping) the prior.
  const cc = labelComponents(cand, w, h, 8);
  const keep = new Uint8Array(cc.count + 1);
  for (let i = 0; i < cand.length; i++) if (cc.labels[i] && prev.data[i]) keep[cc.labels[i]] = 1;
  let out: Uint8Array = new Uint8Array(w * h);
  let area = 0;
  for (let i = 0; i < out.length; i++) if (keep[cc.labels[i]]) { out[i] = 1; area++; }
  if (area === 0) return null;
  if (o.fillHoles) {
    out = fillHoles({ width: w, height: h, data: out }, { x: 1, y: 1 }).data;
    area = out.reduce((s, x) => s + x, 0);
  }
  const prevArea = compareArea ?? prev.data.reduce((s, x) => s + (x ? 1 : 0), 0);
  if (prevArea > 0 && Math.abs(area - prevArea) / prevArea > o.maxAreaChange) return null;
  return { width: w, height: h, data: out };
}

/**
 * Smooth a stack of propagated slices through z: each pixel takes the majority of itself
 * and its neighbours above and below (the seed slice is never changed).
 */
export function zSmooth(stack: MaskPlane[], seedIndex: number): MaskPlane[] {
  return stack.map((p, k) => {
    if (k === seedIndex) return p;
    const out = new Uint8Array(p.data.length);
    for (let i = 0; i < out.length; i++) {
      let votes = p.data[i] ? 1 : 0;
      let n = 1;
      if (k > 0) { votes += stack[k - 1].data[i] ? 1 : 0; n++; }
      if (k < stack.length - 1) { votes += stack[k + 1].data[i] ? 1 : 0; n++; }
      out[i] = votes * 2 > n ? 1 : 0;
    }
    return { ...p, data: out };
  });
}
