/**
 * 3D cleanup of a solver's result (SegWorks #123, #132, #148; branch 5, G1): keep the seeded
 * (or the largest) component, remove small islands, majority smoothing, shrink–grow. Binary
 * volumes, 6-connected, in place-free (each returns a new mask). Seeds are protected: a
 * component holding a seed is never removed and a seed voxel is never cleared.
 */
import { forEachNeighbour6, voxelCount, type Dims } from '../solvers/volume';

/** 6-connected components of a binary volume: a label per voxel (0 = background) and sizes. */
export function components3d(mask: Uint8Array, d: Dims): { labels: Int32Array; sizes: number[] } {
  const n = voxelCount(d);
  const labels = new Int32Array(n);
  const sizes: number[] = [0];
  const stack = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (!mask[s] || labels[s]) continue;
    const id = sizes.length;
    let size = 0, top = 0;
    stack[top++] = s; labels[s] = id;
    while (top) {
      const i = stack[--top];
      size++;
      forEachNeighbour6(d, i, (q) => { if (mask[q] && !labels[q]) { labels[q] = id; stack[top++] = q; } });
    }
    sizes.push(size);
  }
  return { labels, sizes };
}

/**
 * Keep only the components holding a seed (`mode: 'seed'`; if none does, the largest) or the
 * largest one (`mode: 'largest'`).
 */
export function keepComponent(mask: Uint8Array, d: Dims, mode: 'seed' | 'largest', seeds?: Uint8Array): Uint8Array {
  const { labels, sizes } = components3d(mask, d);
  const keep = new Set<number>();
  if (mode === 'seed' && seeds) for (let i = 0; i < mask.length; i++) if (seeds[i] && labels[i]) keep.add(labels[i]);
  if (!keep.size) {
    let best = 0;
    for (let c = 1; c < sizes.length; c++) if (sizes[c] > (sizes[best] ?? 0)) best = c;
    if (best) keep.add(best);
  }
  return Uint8Array.from(labels, (l) => (l && keep.has(l) ? 1 : 0));
}

/** Remove components smaller than `min` voxels, unless they hold a seed. */
export function removeIslands3d(mask: Uint8Array, d: Dims, min: number, seeds?: Uint8Array): Uint8Array {
  if (min <= 0) return mask.slice();
  const { labels, sizes } = components3d(mask, d);
  const seeded = new Set<number>();
  if (seeds) for (let i = 0; i < mask.length; i++) if (seeds[i] && labels[i]) seeded.add(labels[i]);
  return Uint8Array.from(labels, (l) => (l && (sizes[l] >= min || seeded.has(l)) ? 1 : 0));
}

/** Majority vote in the 3×3×3 neighbourhood (≥ 14 of 27), `passes` times; seeds stay set. */
export function majoritySmooth3d(mask: Uint8Array, d: Dims, passes: number, seeds?: Uint8Array): Uint8Array {
  const [nx, ny, nz] = d;
  const nxy = nx * ny;
  let cur = mask.slice();
  for (let p = 0; p < passes; p++) {
    const next = new Uint8Array(cur.length);
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const i = x + nx * y + nxy * z;
      let on = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy, zz = z + dz;
        // Outside the box counts as the voxel's own value (no shrinking at the box edge).
        if (xx < 0 || yy < 0 || zz < 0 || xx >= nx || yy >= ny || zz >= nz) on += cur[i];
        else on += cur[xx + nx * yy + nxy * zz];
      }
      next[i] = on >= 14 || (seeds && seeds[i]) ? 1 : 0;
    }
    cur = next;
  }
  return cur;
}

/** Erode then dilate (6-connected), `passes` times each — an opening; seeds stay set. */
export function shrinkGrow3d(mask: Uint8Array, d: Dims, passes: number, seeds?: Uint8Array): Uint8Array {
  let cur = mask.slice();
  const step = (src: Uint8Array, erode: boolean) => {
    const out = src.slice();
    for (let i = 0; i < src.length; i++) {
      if (erode ? !src[i] : src[i]) continue;
      let hit = false;
      forEachNeighbour6(d, i, (q) => { if (erode ? !src[q] : src[q]) hit = true; });
      if (hit) out[i] = erode ? 0 : 1;
    }
    return out;
  };
  for (let p = 0; p < passes; p++) cur = step(cur, true);
  for (let p = 0; p < passes; p++) cur = step(cur, false);
  if (seeds) for (let i = 0; i < cur.length; i++) if (seeds[i]) cur[i] = 1;
  return cur;
}

export interface PostProcessOptions {
  enabled: boolean;
  keep: 'off' | 'seed' | 'largest';
  /** Remove islands below this many voxels (0 = off). */
  minIsland: number;
  smoothPasses: number;
  shrinkGrowPasses: number;
}

export const DEFAULT_POST_PROCESS: PostProcessOptions = { enabled: false, keep: 'seed', minIsland: 300, smoothPasses: 0, shrinkGrowPasses: 0 };

/** The configured cleanup chain, in SegWorks' order: keep → islands → smooth → shrink–grow. */
export function postProcess3d(mask: Uint8Array, d: Dims, o: PostProcessOptions, seeds?: Uint8Array): Uint8Array {
  if (!o.enabled) return mask;
  let m = mask;
  if (o.keep !== 'off') m = keepComponent(m, d, o.keep, seeds);
  if (o.minIsland > 0) m = removeIslands3d(m, d, o.minIsland, seeds);
  if (o.smoothPasses > 0) m = majoritySmooth3d(m, d, o.smoothPasses, seeds);
  if (o.shrinkGrowPasses > 0) m = shrinkGrow3d(m, d, o.shrinkGrowPasses, seeds);
  return m;
}
