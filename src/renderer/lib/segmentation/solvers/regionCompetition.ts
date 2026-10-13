/**
 * Region competition, multiphase (SegWorks' "Chan-Vese", #136–151; branch 5, G1).
 *
 * What SegWorks implements under the Chan-Vese name is piecewise-constant region competition
 * on the existing label map (Chan & Vese's data term, a Potts length penalty), improved voxel
 * by voxel (ICM). This is the same model with SegWorks' parameters and defaults, but updated in
 * CHECKERBOARD order — the two parity classes of the grid in turn, each voxel deciding from
 * neighbours that cannot change in the same half-step — so the result does not depend on the
 * order voxels are visited (SegWorks swept in place).
 *
 * A voxel may take label l (one of the movable labels) at cost
 *
 *   dataW·(I − μ_l)² + smoothXY·#(in-plane neighbours ≠ l) + smoothZ·zCoupling·#(z neighbours ≠ l)
 *   − stay·[l = its initial label] + (|∇I| > gate and l ≠ its current label ? edgeW·|∇I| : 0)
 *
 * Voxels whose label is not movable never change (#149: unselected and locked members, and an
 * excluded segment). μ_l is re-estimated every iteration. Islands of a movable label smaller than
 * `cleanup` voxels join their dominant neighbour at the end (0 = off — SegWorks read 0 as "use
 * the default").
 */
import { voxelCount, type Dims, type Spacing } from './volume';

export interface RegionCompetitionOptions {
  /** Labels a voxel may take and lose (label values in `labels`; 0 = background). */
  movable: ReadonlySet<number>;
  iterations: number;
  smoothXY: number;
  dataWeight: number;
  stay: number;
  edgeWeight: number;
  edgeGate: number;
  cleanup: number;
  smoothZ: number;
  zCoupling: number;
  /** Intensity clip before the solve (CT HU; null for MR). */
  clip: { lo: number; hi: number } | null;
  onProgress?: (fraction: number) => void;
}

export const DEFAULT_REGION_COMPETITION: Omit<RegionCompetitionOptions, 'movable' | 'onProgress'> = {
  iterations: 18, smoothXY: 2.4, dataWeight: 0.002, stay: 0.35, edgeWeight: 0.012, edgeGate: 35, cleanup: 24,
  smoothZ: 1.1, zCoupling: 0.9, clip: { lo: -150, hi: 250 },
};

export function regionCompetition(image: ArrayLike<number>, d: Dims, spacing: Spacing, initial: Uint8Array, o: RegionCompetitionOptions): Uint8Array {
  const n = voxelCount(d);
  const [nx, ny, nz] = d;
  const nxy = nx * ny;
  const I = new Float32Array(n);
  for (let i = 0; i < n; i++) I[i] = o.clip ? Math.min(o.clip.hi, Math.max(o.clip.lo, image[i])) : image[i];
  // |∇I|: sum of absolute central differences per mm.
  const grad = new Float32Array(n);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = x + nx * y + nxy * z;
    let g = 0;
    if (nx > 1) g += Math.abs(I[x + 1 < nx ? i + 1 : i] - I[x > 0 ? i - 1 : i]) / (2 * spacing[0]);
    if (ny > 1) g += Math.abs(I[y + 1 < ny ? i + nx : i] - I[y > 0 ? i - nx : i]) / (2 * spacing[1]);
    if (nz > 1) g += Math.abs(I[z + 1 < nz ? i + nxy : i] - I[z > 0 ? i - nxy : i]) / (2 * spacing[2]);
    grad[i] = g;
  }
  const labels = initial.slice();
  const movable = [...o.movable].sort((a, b) => a - b);
  const isMovable = new Uint8Array(256);
  for (const l of movable) isMovable[l] = 1;
  // Starting means; a label with no voxels yet takes a quantile of the image.
  const mean = new Float64Array(256);
  const sorted = Float32Array.from(I).sort();
  movable.forEach((l, k) => { mean[l] = sorted[Math.floor(((k + 1) / (movable.length + 1)) * (n - 1))]; });
  const zw = o.smoothZ * o.zCoupling;
  const cost = new Float64Array(256);
  const counts = new Int32Array(256);
  for (let it = 0; it < Math.max(1, o.iterations); it++) {
    // Re-estimate the means.
    const sum = new Float64Array(256);
    counts.fill(0);
    for (let i = 0; i < n; i++) if (isMovable[labels[i]]) { sum[labels[i]] += I[i]; counts[labels[i]]++; }
    for (const l of movable) if (counts[l]) mean[l] = sum[l] / counts[l];
    let changes = 0;
    for (let parity = 0; parity < 2; parity++) {
      const next = labels.slice();
      for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) {
        for (let x = (y + z + parity) & 1; x < nx; x += 2) {
          const i = x + nx * y + nxy * z;
          const cur = labels[i];
          if (!isMovable[cur]) continue;
          let best = cur, bestCost = Infinity;
          for (const l of movable) {
            let c = o.dataWeight * (I[i] - mean[l]) ** 2;
            if (x > 0 && labels[i - 1] !== l) c += o.smoothXY;
            if (x + 1 < nx && labels[i + 1] !== l) c += o.smoothXY;
            if (y > 0 && labels[i - nx] !== l) c += o.smoothXY;
            if (y + 1 < ny && labels[i + nx] !== l) c += o.smoothXY;
            if (z > 0 && labels[i - nxy] !== l) c += zw;
            if (z + 1 < nz && labels[i + nxy] !== l) c += zw;
            if (l === initial[i]) c -= o.stay;
            if (l !== cur && grad[i] > o.edgeGate) c += o.edgeWeight * grad[i];
            cost[l] = c;
            if (c < bestCost) { bestCost = c; best = l; }
          }
          if (best !== cur) { next[i] = best; changes++; }
        }
      }
      labels.set(next);
    }
    o.onProgress?.((it + 1) / Math.max(1, o.iterations));
    if (!changes) break;
  }
  if (o.cleanup > 0) cleanupIslands(labels, d, isMovable, o.cleanup);
  return labels;
}

/** Islands (6-connected) of a movable label below `min` voxels take their most common movable neighbour label. */
function cleanupIslands(labels: Uint8Array, d: Dims, isMovable: Uint8Array, min: number): void {
  const [nx, ny, nz] = d;
  const nxy = nx * ny;
  const n = labels.length;
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const member: number[] = [];
  const neigh = (i: number, f: (q: number) => void) => {
    const z = Math.floor(i / nxy), y = Math.floor((i - z * nxy) / nx), x = i - z * nxy - y * nx;
    if (x > 0) f(i - 1); if (x + 1 < nx) f(i + 1);
    if (y > 0) f(i - nx); if (y + 1 < ny) f(i + nx);
    if (z > 0) f(i - nxy); if (z + 1 < nz) f(i + nxy);
  };
  for (let s = 0; s < n; s++) {
    if (seen[s] || !isMovable[labels[s]]) continue;
    const l = labels[s];
    member.length = 0;
    let top = 0;
    stack[top++] = s; seen[s] = 1;
    while (top) {
      const i = stack[--top];
      member.push(i);
      neigh(i, (q) => { if (!seen[q] && labels[q] === l) { seen[q] = 1; stack[top++] = q; } });
    }
    if (member.length >= min) continue;
    const votes = new Map<number, number>();
    for (const i of member) neigh(i, (q) => { const m = labels[q]; if (m !== l && isMovable[m]) votes.set(m, (votes.get(m) ?? 0) + 1); });
    let to = -1, most = 0;
    for (const [m, v] of votes) if (v > most) { most = v; to = m; }
    if (to >= 0) for (const i of member) labels[i] = to;
  }
}
