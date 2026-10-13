/**
 * Multi-label graph cut by α-expansion (SegWorks #124–135; branch 5, G1) — Boykov, Veksler &
 * Zabih, "Fast approximate energy minimization via graph cuts", PAMI 2001.
 *
 *   E(f) = Σ_p D_p(f_p) + Σ_(p,q) w_pq · [f_p ≠ f_q],   w_pq = smooth · exp(−(I_p − I_q)² / 2σ²)
 *
 * The Potts term is a metric, so each α-expansion move (every voxel keeps its label or takes
 * α) is one exact binary graph cut, and E never rises. A sweep tries every class once; the
 * solve stops after `sweeps` sweeps or a sweep that changes nothing. Background is an
 * ordinary class (the caller seeds it): SegWorks' "one-vs-rest expansion" had no pairwise
 * term between two non-α labels and pushed every voxel of the box into some seeded label.
 *
 * D_p(k) = uInt · NLL_k(I_p) + uLoc · 100 · (distance to class k's seed centroid / box
 * diagonal) — the intensity and locality terms of SegWorks' unary, on the 0–100 scale its
 * smoothness defaults assume. Seeds are hard. Background (when the caller names its class) is
 * "everything else": its intensity cost is capped at half the others' (50), so a voxel unlike
 * every seeded structure — air in the box, an unseeded organ — is Background, not whichever
 * structure happens to be nearest. The starting labelling is SegWorks'
 * initialiser: each voxel's nearest model by locality, intensity and seed bias.
 */
import { BinaryEnergy } from './energy';
import { forEachPair6, nll, pairCount6, seedModels, voxelCount, type Dims, type Spacing } from './volume';

export interface AlphaExpansionOptions {
  /** Pairwise weight (SegWorks smooth 6; 1–16). */
  smooth: number;
  /** Boundary sensitivity σ (SegWorks 30; 5–80). */
  sigma: number;
  /** Maximum sweeps (SegWorks 2; 1–4). */
  sweeps: number;
  /** Unary weights (SegWorks U-Int 0.75, U-Loc 0.25). */
  uInt: number;
  uLoc: number;
  /** Initialiser weights (SegWorks locality 0.65, intensity 0.35, seed bias 0.9). */
  locality: number;
  intensity: number;
  seedBias: number;
}

export const DEFAULT_ALPHA_EXPANSION: AlphaExpansionOptions = {
  smooth: 6, sigma: 30, sweeps: 2, uInt: 0.75, uLoc: 0.25, locality: 0.65, intensity: 0.35, seedBias: 0.9,
};

const HARD = 1e9;

export interface AlphaExpansionResult {
  /** Class index (0-based) per voxel. */
  labels: Uint8Array;
  /** The starting labelling (the initialiser's), for the preview's "init" view. */
  initial: Uint8Array;
  energy: number;
  sweeps: number;
}

/**
 * `seeds`: class k + 1 per seeded voxel (0 = none), `classes` classes. Needs at least two
 * seeded classes (else null).
 */
export function alphaExpansion(
  image: ArrayLike<number>, d: Dims, spacing: Spacing, seeds: Uint8Array, classes: number,
  o: AlphaExpansionOptions = DEFAULT_ALPHA_EXPANSION, onProgress?: (fraction: number) => void,
  backgroundClass?: number,
): AlphaExpansionResult | null {
  const n = voxelCount(d);
  const models = seedModels(image, seeds, classes);
  const seeded = models.map((m) => m.count > 0);
  if (seeded.filter(Boolean).length < 2) return null;
  const [nx, ny] = d;
  // Seed centroids (mm) and the box diagonal, for the locality term.
  const cen = Array.from({ length: classes }, () => [0, 0, 0, 0]);
  for (let i = 0; i < n; i++) {
    const c = seeds[i];
    if (!c) continue;
    const x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / (nx * ny));
    cen[c - 1][0] += x * spacing[0]; cen[c - 1][1] += y * spacing[1]; cen[c - 1][2] += z * spacing[2]; cen[c - 1][3]++;
  }
  for (const c of cen) if (c[3]) { c[0] /= c[3]; c[1] /= c[3]; c[2] /= c[3]; }
  const diag = Math.hypot(d[0] * spacing[0], d[1] * spacing[1], d[2] * spacing[2]) || 1;
  const locOf = (i: number, k: number) => {
    const x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / (nx * ny));
    const c = cen[k];
    return Math.hypot(x * spacing[0] - c[0], y * spacing[1] - c[1], z * spacing[2] - c[2]) / diag;
  };
  // Data costs D[i·classes + k]; unseeded classes are never chosen.
  const D = new Float32Array(n * classes);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < classes; k++) {
      let v: number;
      if (!seeded[k]) v = HARD;
      else if (seeds[i]) v = seeds[i] === k + 1 ? 0 : HARD;
      else v = o.uInt * nll(image[i], models[k], k === backgroundClass ? 50 : 100) + o.uLoc * 100 * locOf(i, k);
      D[i * classes + k] = v;
    }
  }
  // Initialiser: the nearest model by locality + intensity, seeds biased to their own class.
  const labels = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (seeds[i]) { labels[i] = seeds[i] - 1; continue; }
    let best = -1, bestScore = Infinity;
    for (let k = 0; k < classes; k++) {
      if (!seeded[k]) continue;
      const m = models[k];
      const s = o.locality * locOf(i, k) + o.intensity * Math.abs(image[i] - m.mean) / Math.max(15, 2.5 * Math.sqrt(m.variance));
      if (s < bestScore) { bestScore = s; best = k; }
    }
    labels[i] = best;
  }
  const initial = labels.slice();
  // Edge weights per 6-pair, computed once.
  const pairs = pairCount6(d);
  const pp = new Int32Array(pairs), pq = new Int32Array(pairs), pw = new Float32Array(pairs);
  {
    const k2 = 1 / (2 * o.sigma * o.sigma);
    let e = 0;
    forEachPair6(d, (p, q) => { pp[e] = p; pq[e] = q; pw[e] = o.smooth * Math.exp(-((image[p] - image[q]) ** 2) * k2); e++; });
  }
  const energyOf = (f: Uint8Array) => {
    let E = 0;
    for (let i = 0; i < n; i++) E += D[i * classes + f[i]];
    for (let e = 0; e < pairs; e++) if (f[pp[e]] !== f[pq[e]]) E += pw[e];
    return E;
  };
  let energy = energyOf(labels);
  const order = seeded.map((s, k) => (s ? k : -1)).filter((k) => k >= 0);
  const totalMoves = Math.max(1, o.sweeps) * order.length;
  let moves = 0;
  let sweep = 0;
  for (; sweep < Math.max(1, o.sweeps); sweep++) {
    let changed = false;
    for (const alpha of order) {
      // x_p = 0 keeps f_p, x_p = 1 takes α.
      const e = new BinaryEnergy(n, pairs);
      for (let i = 0; i < n; i++) e.addUnary(i, D[i * classes + labels[i]], D[i * classes + alpha]);
      for (let k = 0; k < pairs; k++) {
        const p = pp[k], q = pq[k], w = pw[k];
        const fp = labels[p], fq = labels[q];
        const A = fp !== fq ? w : 0, B = fp !== alpha ? w : 0, C = alpha !== fq ? w : 0;
        e.addPairwise(p, q, A, B, C, 0);
      }
      const { labels: x } = e.minimize();
      const next = Uint8Array.from(labels, (f, i) => (x[i] ? alpha : f));
      const nextEnergy = energyOf(next);
      if (nextEnergy < energy - 1e-6) { labels.set(next); energy = nextEnergy; changed = true; }
      onProgress?.(++moves / totalMoves);
    }
    if (!changed) { sweep++; break; }
  }
  return { labels, initial, energy, sweeps: sweep };
}
