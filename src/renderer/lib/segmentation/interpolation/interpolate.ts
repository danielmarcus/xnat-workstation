/**
 * Slice interpolation between two anchor planes (SegWorks parity branch 3 I1; #161–167).
 *
 * Every method takes anchor masks A and B (same plane size) and α ∈ [0, 1] (0 = A, 1 = B)
 * and returns the in-between plane. They are written fresh from the published methods
 * SegWorks cites; departures from SegWorks are noted where its version misbehaves.
 *
 *  - sdfLinear       Raya & Udupa 1990: blend signed distance fields, threshold at 0.
 *  - sdfArea         the same blend, thresholded so the area follows the linear blend of
 *                    the anchor areas (counters SDF shrink-on-concave / grow-on-convex).
 *  - morphology      Schenk, Prause & Peitgen 2000: grow A ∩ B toward A ∪ B by conditional
 *                    dilation until the target area. SegWorks seeds from A ∩ B only, so
 *                    anchors that do not overlap (a structure moving between slices) give
 *                    EMPTY intermediates. Here non-overlapping anchors are first aligned on
 *                    their centroids, interpolated, and the result placed at the
 *                    interpolated centroid — the shape moves across instead of vanishing.
 *                    (No SDF blend can do this: between far-apart shapes it is positive
 *                    everywhere, so the middle is empty.)
 *  - components      Lee & Wang 2000: match connected components across the anchors by
 *                    centroid + area, interpolate each pair; unmatched ones fade by area.
 *  - volumeMorphology morphology for shape, then fine-tuned with the SDF blend to hit the
 *                    linear target area exactly.
 *  - imageGuided     SDF blend as a shape prior, boundary snapped to nearby strong image
 *                    edges (Sobel) along the SDF normal (Kass et al. 1988 concept).
 */
import { labelComponents, type MaskPlane } from '../maskOps/plane';
import { signedDistance, type DistanceMethod } from './distance';

export type InterpolationMethod = 'sdfLinear' | 'sdfArea' | 'morphology' | 'components' | 'volumeMorphology' | 'imageGuided';

export interface InterpolationContext {
  distance?: DistanceMethod;
  /** Image intensities of the slice being made (imageGuided only). */
  image?: ArrayLike<number>;
}

const area = (d: ArrayLike<number>) => { let n = 0; for (let i = 0; i < d.length; i++) if (d[i]) n++; return n; };
const plane = (ref: MaskPlane, data: Uint8Array): MaskPlane => ({ width: ref.width, height: ref.height, data });

function blendSDF(a: MaskPlane, b: MaskPlane, alpha: number, method: DistanceMethod): Float32Array {
  const sa = signedDistance(a.data, a.width, a.height, method);
  const sb = signedDistance(b.data, b.width, b.height, method);
  const out = new Float32Array(sa.length);
  for (let i = 0; i < out.length; i++) out[i] = sa[i] * (1 - alpha) + sb[i] * alpha;
  return out;
}

function thresholdAt(blended: Float32Array, t: number): Uint8Array {
  const out = new Uint8Array(blended.length);
  for (let i = 0; i < out.length; i++) if (blended[i] <= t) out[i] = 1;
  return out;
}

const targetArea = (a: MaskPlane, b: MaskPlane, alpha: number) => Math.round(area(a.data) * (1 - alpha) + area(b.data) * alpha);

export function sdfLinear(a: MaskPlane, b: MaskPlane, alpha: number, ctx: InterpolationContext = {}): MaskPlane {
  if (alpha <= 0) return plane(a, new Uint8Array(a.data));
  if (alpha >= 1) return plane(b, new Uint8Array(b.data));
  return plane(a, thresholdAt(blendSDF(a, b, alpha, ctx.distance ?? 'exact'), 0));
}

/** Pick exactly `target` pixels with the lowest blended SDF (deepest inside first). */
function lowestN(blended: Float32Array, target: number): Uint8Array {
  const idx = Array.from(blended.keys()).sort((p, q) => blended[p] - blended[q]);
  const out = new Uint8Array(blended.length);
  for (let k = 0; k < Math.min(target, idx.length); k++) out[idx[k]] = 1;
  return out;
}

export function sdfArea(a: MaskPlane, b: MaskPlane, alpha: number, ctx: InterpolationContext = {}): MaskPlane {
  if (alpha <= 0 || alpha >= 1) return sdfLinear(a, b, alpha, ctx);
  const target = targetArea(a, b, alpha);
  if (target <= 0) return plane(a, new Uint8Array(a.data.length));
  return plane(a, lowestN(blendSDF(a, b, alpha, ctx.distance ?? 'exact'), target));
}

function centroid(p: MaskPlane): { x: number; y: number } | null {
  let sx = 0, sy = 0, n = 0;
  for (let i = 0; i < p.data.length; i++) if (p.data[i]) { sx += i % p.width; sy += Math.floor(i / p.width); n++; }
  return n ? { x: sx / n, y: sy / n } : null;
}

/** The plane translated by (dx, dy) whole pixels; what leaves the plane is dropped. */
function shift(p: MaskPlane, dx: number, dy: number): MaskPlane {
  const { width: w, height: h } = p;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!p.data[x + y * w]) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) out[nx + ny * w] = 1;
    }
  }
  return plane(p, out);
}

/** Schenk growth of A ∩ B toward A ∪ B (anchors assumed to overlap). */
function grow(a: MaskPlane, b: MaskPlane, target: number): Uint8Array {
  const { width: w, height: h } = a;
  const n = w * h;
  let grown = new Uint8Array(n);
  const uni = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (a.data[i] && b.data[i]) grown[i] = 1;
    if (a.data[i] || b.data[i]) uni[i] = 1;
  }
  if (area(uni) <= target) return uni;
  let grownArea = area(grown);
  while (grownArea < target) {
    const next = new Uint8Array(grown);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = x + y * w;
        if (grown[i] || !uni[i]) continue;
        if ((x > 0 && grown[i - 1]) || (x < w - 1 && grown[i + 1]) || (y > 0 && grown[i - w]) || (y < h - 1 && grown[i + w])) next[i] = 1;
      }
    }
    const nextArea = area(next);
    if (nextArea === grownArea) break;
    grown = next;
    grownArea = nextArea;
  }
  return grown;
}

export function morphology(a: MaskPlane, b: MaskPlane, alpha: number, ctx: InterpolationContext = {}): MaskPlane {
  if (alpha <= 0 || alpha >= 1) return sdfLinear(a, b, alpha, ctx);
  const target = targetArea(a, b, alpha);
  if (target <= 0) return plane(a, new Uint8Array(a.data.length));
  let overlap = false;
  for (let i = 0; i < a.data.length && !overlap; i++) if (a.data[i] && b.data[i]) overlap = true;
  if (overlap) return plane(a, grow(a, b, target));
  const ca = centroid(a);
  const cb = centroid(b);
  if (!ca || !cb) return sdfArea(a, b, alpha, ctx); // one anchor empty: shrink/grow in place
  // Align both anchors on the interpolated centroid, then grow as usual.
  const tx = ca.x + (cb.x - ca.x) * alpha;
  const ty = ca.y + (cb.y - ca.y) * alpha;
  const a2 = shift(a, Math.round(tx - ca.x), Math.round(ty - ca.y));
  const b2 = shift(b, Math.round(tx - cb.x), Math.round(ty - cb.y));
  let aligned = false;
  for (let i = 0; i < a2.data.length && !aligned; i++) if (a2.data[i] && b2.data[i]) aligned = true;
  return aligned ? plane(a, grow(a2, b2, target)) : sdfArea(a2, b2, 0.5, ctx);
}

export function volumeMorphology(a: MaskPlane, b: MaskPlane, alpha: number, ctx: InterpolationContext = {}): MaskPlane {
  if (alpha <= 0 || alpha >= 1) return sdfLinear(a, b, alpha, ctx);
  const shape = morphology(a, b, alpha, ctx).data;
  const target = targetArea(a, b, alpha);
  let have = area(shape);
  if (have === target) return plane(a, shape);
  const blended = blendSDF(a, b, alpha, ctx.distance ?? 'exact');
  const out = new Uint8Array(shape);
  if (have < target) {
    const cands = Array.from(blended.keys()).filter((i) => !out[i]).sort((p, q) => blended[p] - blended[q]);
    for (const i of cands) { if (have >= target) break; out[i] = 1; have++; }
  } else {
    const cands = Array.from(blended.keys()).filter((i) => out[i]).sort((p, q) => blended[q] - blended[p]);
    for (const i of cands) { if (have <= target) break; out[i] = 0; have--; }
  }
  return plane(a, out);
}

export function components(a: MaskPlane, b: MaskPlane, alpha: number, ctx: InterpolationContext = {}): MaskPlane {
  if (alpha <= 0 || alpha >= 1) return sdfLinear(a, b, alpha, ctx);
  const { width: w, height: h } = a;
  const ca = labelComponents(a.data, w, h, 8);
  const cb = labelComponents(b.data, w, h, 8);
  if (ca.count <= 1 && cb.count <= 1) return morphology(a, b, alpha, ctx);
  const sub = (cc: typeof ca, id: number) => {
    const d = new Uint8Array(w * h);
    for (let i = 0; i < d.length; i++) if (cc.labels[i] === id) d[i] = 1;
    return plane(a, d);
  };
  const out = new Uint8Array(w * h);
  const usedB = new Set<number>();
  const order = Array.from({ length: ca.count }, (_, k) => k + 1).sort((p, q) => ca.sizes[q] - ca.sizes[p]);
  const unmatchedA: number[] = [];
  for (const ia of order) {
    let best = 0;
    let bestScore = Infinity;
    for (let ib = 1; ib <= cb.count; ib++) {
      if (usedB.has(ib)) continue;
      const dx = ca.centroids[ia].x - cb.centroids[ib].x;
      const dy = ca.centroids[ia].y - cb.centroids[ib].y;
      const ratio = Math.max(ca.sizes[ia], cb.sizes[ib]) / Math.max(1, Math.min(ca.sizes[ia], cb.sizes[ib]));
      const score = (dx * dx + dy * dy + 1) * ratio;
      if (score < bestScore) { bestScore = score; best = ib; }
    }
    if (!best) { unmatchedA.push(ia); continue; }
    usedB.add(best);
    const r = morphology(sub(ca, ia), sub(cb, best), alpha, ctx).data;
    for (let i = 0; i < out.length; i++) if (r[i]) out[i] = 1;
  }
  // Unmatched components fade by area around their centroid: A's out, B's in.
  const fade = (cc: typeof ca, id: number, keep: number) => {
    const target = Math.round(cc.sizes[id] * keep);
    if (target <= 0) return;
    const c = cc.centroids[id];
    const px: number[] = [];
    for (let i = 0; i < cc.labels.length; i++) if (cc.labels[i] === id) px.push(i);
    px.sort((p, q) => {
      const dp = ((p % w) - c.x) ** 2 + (Math.floor(p / w) - c.y) ** 2;
      const dq = ((q % w) - c.x) ** 2 + (Math.floor(q / w) - c.y) ** 2;
      return dp - dq;
    });
    for (let k = 0; k < target; k++) out[px[k]] = 1;
  };
  for (const ia of unmatchedA) fade(ca, ia, 1 - alpha);
  for (let ib = 1; ib <= cb.count; ib++) if (!usedB.has(ib)) fade(cb, ib, alpha);
  return plane(a, out);
}

/** Sobel gradient magnitude, normalised to [0, 1]. */
export function sobelMagnitude(image: ArrayLike<number>, w: number, h: number): Float32Array {
  const mag = new Float32Array(w * h);
  let max = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = x + y * w;
      const gx = (image[i - w + 1] + 2 * image[i + 1] + image[i + w + 1]) - (image[i - w - 1] + 2 * image[i - 1] + image[i + w - 1]);
      const gy = (image[i + w - 1] + 2 * image[i + w] + image[i + w + 1]) - (image[i - w - 1] + 2 * image[i - w] + image[i - w + 1]);
      const m = Math.hypot(gx, gy);
      mag[i] = m;
      if (m > max) max = m;
    }
  }
  if (max > 0) for (let i = 0; i < mag.length; i++) mag[i] /= max;
  return mag;
}

/**
 * SDF blend as the shape prior, then each boundary pixel looks up to `radius` pixels in and
 * out along the SDF normal for a stronger image edge and moves the boundary there. Without
 * an image this is sdfLinear.
 */
export function imageGuided(a: MaskPlane, b: MaskPlane, alpha: number, ctx: InterpolationContext = {}, radius = 4): MaskPlane {
  if (alpha <= 0 || alpha >= 1 || !ctx.image) return sdfLinear(a, b, alpha, ctx);
  const { width: w, height: h } = a;
  const blended = blendSDF(a, b, alpha, ctx.distance ?? 'exact');
  const shape = thresholdAt(blended, 0);
  const out = new Uint8Array(shape);
  const edge = sobelMagnitude(ctx.image, w, h);
  const EDGE_MIN = 0.12;
  const GAIN = 1.4;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = x + y * w;
      if (!shape[i] || (shape[i - 1] && shape[i + 1] && shape[i - w] && shape[i + w])) continue;
      const gx = (blended[i + 1] - blended[i - 1]) / 2;
      const gy = (blended[i + w] - blended[i - w]) / 2;
      const len = Math.hypot(gx, gy);
      if (len < 1e-6) continue;
      const nx = gx / len;
      const ny = gy / len; // points outward (SDF increases outward)
      let bestT = 0;
      let best = edge[i];
      for (let t = -radius; t <= radius; t++) {
        if (!t) continue;
        const sx = Math.round(x + t * nx);
        const sy = Math.round(y + t * ny);
        if (sx < 1 || sy < 1 || sx >= w - 1 || sy >= h - 1) continue;
        if (edge[sx + sy * w] > best) { best = edge[sx + sy * w]; bestT = t; }
      }
      if (!bestT || best < EDGE_MIN || best < edge[i] * GAIN) continue;
      if (bestT > 0) {
        for (let t = 1; t <= bestT; t++) out[Math.round(x + t * nx) + Math.round(y + t * ny) * w] = 1;
      } else {
        for (let t = 0; t > bestT; t--) out[Math.round(x + t * nx) + Math.round(y + t * ny) * w] = 0;
      }
    }
  }
  // Fill any pinholes the outward pushes left inside.
  const bg = labelComponents(out, w, h, 4, 0);
  const touches = new Uint8Array(bg.count + 1);
  for (let x = 0; x < w; x++) { touches[bg.labels[x]] = 1; touches[bg.labels[x + (h - 1) * w]] = 1; }
  for (let y = 0; y < h; y++) { touches[bg.labels[y * w]] = 1; touches[bg.labels[w - 1 + y * w]] = 1; }
  for (let i = 0; i < out.length; i++) if (bg.labels[i] && !touches[bg.labels[i]]) out[i] = 1;
  return plane(a, out);
}

export const INTERPOLATORS: Record<InterpolationMethod, (a: MaskPlane, b: MaskPlane, alpha: number, ctx?: InterpolationContext) => MaskPlane> = {
  sdfLinear, sdfArea, morphology, components, volumeMorphology, imageGuided,
};

export const INTERPOLATION_LABELS: Record<InterpolationMethod, { label: string; hint: string }> = {
  sdfLinear: { label: 'Linear SDF', hint: 'Blend signed distance fields (Raya & Udupa 1990). Fast, smooth.' },
  sdfArea: { label: 'Area-preserving SDF', hint: 'SDF blend with each slice’s area following the anchors linearly.' },
  morphology: { label: 'Morphology', hint: 'Grow the shared core toward the union (Schenk 2000). Keeps organic shapes.' },
  components: { label: 'Component matching', hint: 'Match separate parts across the anchors (Lee & Wang 2000). For branching or multi-part masks.' },
  volumeMorphology: { label: 'Volume-accurate morphology', hint: 'Morphology for shape, area corrected to the linear target.' },
  imageGuided: { label: 'Image-guided snap', hint: 'SDF shape snapped to nearby image edges.' },
};

/** Interior gaps: runs of empty slices with filled slices on both sides. */
export function findGaps(occupied: ArrayLike<boolean | number>): Array<{ from: number; to: number }> {
  const gaps: Array<{ from: number; to: number }> = [];
  let lastFilled = -1;
  for (let k = 0; k < occupied.length; k++) {
    if (!occupied[k]) continue;
    if (lastFilled >= 0 && k - lastFilled > 1) gaps.push({ from: lastFilled + 1, to: k - 1 });
    lastFilled = k;
  }
  return gaps;
}
