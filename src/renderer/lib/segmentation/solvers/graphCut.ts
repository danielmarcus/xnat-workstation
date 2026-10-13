/**
 * Binary Graph Cut (SegWorks #116–123; branch 5, G1) — Boykov & Jolly, "Interactive graph
 * cuts for optimal boundary & region segmentation", ICCV 2001; solved by Boykov–Kolmogorov.
 *
 *   E = Σ_p U_p(x_p) + λ Σ_(p,q) exp(−(I_p − I_q)² / 2σ²) · [x_p ≠ x_q]
 *
 * U is the Gaussian negative log-likelihood under the foreground / background seed models
 * (capped, see `nll`), rescaled so its largest value is 100 — SegWorks' scale, so λ means what
 * it meant there (default 50). Seeds are hard constraints. 6-connected.
 */
import { BinaryEnergy } from './energy';
import { forEachPair6, nll, pairCount6, seedModels, voxelCount, type Dims } from './volume';

export interface GraphCutOptions {
  /** Smoothness weight λ (SegWorks 50; 5–200). */
  lambda: number;
  /** Edge sensitivity σ in intensity units (SegWorks 30; 5–150). */
  sigma: number;
}

export const DEFAULT_GRAPH_CUT: GraphCutOptions = { lambda: 50, sigma: 30 };

const HARD = 1e9;

/**
 * Foreground (1) / background (0) per voxel. `seeds`: 1 = foreground seed, 2 = background
 * seed, 0 = none. Returns null without seeds of both kinds.
 */
export function graphCut(image: ArrayLike<number>, d: Dims, seeds: Uint8Array, o: GraphCutOptions = DEFAULT_GRAPH_CUT): Uint8Array | null {
  const n = voxelCount(d);
  const [fg, bg] = seedModels(image, seeds, 2);
  if (!fg.count || !bg.count) return null;
  const uFg = new Float32Array(n), uBg = new Float32Array(n);
  let max = 0;
  for (let i = 0; i < n; i++) {
    uFg[i] = nll(image[i], fg); uBg[i] = nll(image[i], bg);
    max = Math.max(max, uFg[i], uBg[i]);
  }
  const scale = max > 0 ? 100 / max : 1;
  const e = new BinaryEnergy(n, pairCount6(d));
  // x = 0 foreground (source side), x = 1 background.
  for (let i = 0; i < n; i++) {
    if (seeds[i] === 1) e.addUnary(i, 0, HARD);
    else if (seeds[i] === 2) e.addUnary(i, HARD, 0);
    else e.addUnary(i, uFg[i] * scale, uBg[i] * scale);
  }
  const k = 1 / (2 * o.sigma * o.sigma);
  forEachPair6(d, (p, q) => {
    const w = o.lambda * Math.exp(-((image[p] - image[q]) ** 2) * k);
    e.addPairwise(p, q, 0, w, w, 0);
  });
  const { labels } = e.minimize();
  return Uint8Array.from(labels, (x) => (x === 0 ? 1 : 0));
}
