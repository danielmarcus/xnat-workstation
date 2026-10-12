/**
 * 3D connected components for segmentation QC (SegWorks parity #242–244, #252; branch 7).
 * 26-connected, so voxels touching at an edge or corner belong together — what a reader
 * sees as one piece in a surface view.
 */

export type Dims = [number, number, number];

export interface Component3d {
  /** Label value in `labels` (1-based). */
  id: number;
  voxels: number;
  /** [i0, j0, k0, i1, j1, k1], inclusive, in index space. */
  bbox: [number, number, number, number, number, number];
  /** Mean voxel index. */
  centroid: [number, number, number];
  /** Flat index of one of its voxels (where a flood fill can start). */
  seed: number;
}

export interface Components3d {
  labels: Int32Array;
  /** Largest first. */
  components: Component3d[];
}

export function labelComponents3d(mask: ArrayLike<number>, dims: Dims): Components3d {
  const [nx, ny, nz] = dims;
  const nxy = nx * ny;
  const labels = new Int32Array(nx * ny * nz);
  const components: Component3d[] = [];
  const stack = new Int32Array(nx * ny * nz);
  let next = 1;
  for (let start = 0; start < labels.length; start++) {
    if (!mask[start] || labels[start]) continue;
    const id = next++;
    let top = 0;
    stack[top++] = start;
    labels[start] = id;
    let n = 0, si = 0, sj = 0, sk = 0;
    let i0 = Infinity, j0 = Infinity, k0 = Infinity, i1 = -1, j1 = -1, k1 = -1;
    while (top) {
      const p = stack[--top];
      const k = Math.floor(p / nxy), rem = p - k * nxy, j = Math.floor(rem / nx), i = rem - j * nx;
      n++; si += i; sj += j; sk += k;
      if (i < i0) i0 = i; if (j < j0) j0 = j; if (k < k0) k0 = k;
      if (i > i1) i1 = i; if (j > j1) j1 = j; if (k > k1) k1 = k;
      for (let dk = -1; dk <= 1; dk++) {
        const z = k + dk;
        if (z < 0 || z >= nz) continue;
        for (let dj = -1; dj <= 1; dj++) {
          const y = j + dj;
          if (y < 0 || y >= ny) continue;
          for (let di = -1; di <= 1; di++) {
            const x = i + di;
            if (x < 0 || x >= nx) continue;
            const q = x + nx * (y + ny * z);
            if (mask[q] && !labels[q]) { labels[q] = id; stack[top++] = q; }
          }
        }
      }
    }
    components.push({ id, voxels: n, bbox: [i0, j0, k0, i1, j1, k1], centroid: [si / n, sj / n, sk / n], seed: start });
  }
  components.sort((a, b) => b.voxels - a.voxels || a.id - b.id);
  return { labels, components };
}

export type ComponentBand = 'main' | 'fragment' | 'stray' | 'speck';

export interface BandThresholds {
  /** A component this size or smaller (voxels) is a stray island. */
  strayVoxels: number;
  /** …and this size or smaller, a speck. */
  speckVoxels: number;
}

/** Bands for components sorted largest first: the largest is the main structure. */
export function classifyComponents(components: Component3d[], t: BandThresholds): ComponentBand[] {
  return components.map((c, idx) => {
    if (idx === 0) return 'main';
    if (c.voxels <= t.speckVoxels) return 'speck';
    if (c.voxels <= t.strayVoxels) return 'stray';
    return 'fragment';
  });
}
