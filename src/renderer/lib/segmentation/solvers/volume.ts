/**
 * Volumes for the 3D solvers (SegWorks parity branch 5, G1; docs/segworks-parity.md §11).
 *
 * A solver works on one box of the segment's voxel grid, in index space (so oblique series
 * behave): `dims` = [nx, ny, nz], voxel (x, y, z) at `x + nx·(y + ny·z)`, `spacing` in mm.
 * The service crops the box, the solver never sees world coordinates.
 */

export type Dims = readonly [number, number, number];
export type Spacing = readonly [number, number, number];

export const voxelCount = (d: Dims) => d[0] * d[1] * d[2];

/**
 * Call `f(q, axis)` for each 6-neighbour q of voxel i that is INSIDE the box (axis 0/1/2 =
 * x/y/z). Bounds are real: x ± 1 never wraps to the next row, y ± 1 never to the next slice
 * (SegWorks' GrowCut checked only the flat index, so its neighbours wrapped).
 */
export function forEachNeighbour6(d: Dims, i: number, f: (q: number, axis: 0 | 1 | 2) => void): void {
  const nx = d[0], nxy = d[0] * d[1];
  const z = Math.floor(i / nxy);
  const r = i - z * nxy;
  const y = Math.floor(r / nx);
  const x = r - y * nx;
  if (x > 0) f(i - 1, 0);
  if (x < nx - 1) f(i + 1, 0);
  if (y > 0) f(i - nx, 1);
  if (y < d[1] - 1) f(i + nx, 1);
  if (z > 0) f(i - nxy, 2);
  if (z < d[2] - 1) f(i + nxy, 2);
}

/** Call `f(p, q, axis)` once per 6-connected voxel pair (q = the + neighbour along axis). */
export function forEachPair6(d: Dims, f: (p: number, q: number, axis: 0 | 1 | 2) => void): void {
  const [nx, ny, nz] = d;
  const nxy = nx * ny;
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const p = x + nx * y + nxy * z;
        if (x + 1 < nx) f(p, p + 1, 0);
        if (y + 1 < ny) f(p, p + nx, 1);
        if (z + 1 < nz) f(p, p + nxy, 2);
      }
    }
  }
}

/** Number of 6-connected pairs in a box. */
export const pairCount6 = (d: Dims) => (d[0] - 1) * d[1] * d[2] + d[0] * (d[1] - 1) * d[2] + d[0] * d[1] * (d[2] - 1);

/** A seed stroke on one slice of the box, in index coordinates; class 0 erases. */
export interface SeedStroke {
  cls: number;
  z: number;
  points: ReadonlyArray<readonly [number, number]>;
  /** Brush radius in voxels along x and y (the brush is round in mm). */
  rx: number;
  ry: number;
}

/**
 * Rasterise seed strokes into a class per voxel (0 = no seed): a round brush stamped along
 * each stroke, in order, so a later stroke (or an erasing one) wins.
 */
export function rasterizeSeeds(d: Dims, strokes: readonly SeedStroke[]): Uint8Array {
  const out = new Uint8Array(voxelCount(d));
  const [nx, ny, nz] = d;
  for (const s of strokes) {
    const z = Math.round(s.z);
    if (z < 0 || z >= nz || !s.points.length) continue;
    const rx = Math.max(0.5, s.rx), ry = Math.max(0.5, s.ry);
    const stamp = (cx: number, cy: number) => {
      for (let y = Math.max(0, Math.ceil(cy - ry)); y <= Math.min(ny - 1, Math.floor(cy + ry)); y++) {
        for (let x = Math.max(0, Math.ceil(cx - rx)); x <= Math.min(nx - 1, Math.floor(cx + rx)); x++) {
          if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) out[x + nx * (y + ny * z)] = s.cls;
        }
      }
    };
    stamp(s.points[0][0], s.points[0][1]);
    for (let k = 1; k < s.points.length; k++) {
      const [x0, y0] = s.points[k - 1], [x1, y1] = s.points[k];
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.5));
      for (let t = 1; t <= steps; t++) stamp(x0 + ((x1 - x0) * t) / steps, y0 + ((y1 - y0) * t) / steps);
    }
  }
  return out;
}

/**
 * A class's intensity model: mean and variance of the image under its seeds. The variance has
 * a floor (σ ≥ 5 intensity units) — seeds on a uniform region would otherwise give a
 * zero-width model whose likelihood explodes for any other value.
 */
export function seedModels(image: ArrayLike<number>, seeds: Uint8Array, classes: number): Array<{ mean: number; variance: number; count: number }> {
  const sum = new Float64Array(classes + 1), sq = new Float64Array(classes + 1), n = new Float64Array(classes + 1);
  for (let i = 0; i < seeds.length; i++) {
    const c = seeds[i];
    if (!c) continue;
    const v = image[i];
    sum[c] += v; sq[c] += v * v; n[c]++;
  }
  return Array.from({ length: classes }, (_, k) => {
    const c = k + 1;
    if (!n[c]) return { mean: 0, variance: 25, count: 0 };
    const mean = sum[c] / n[c];
    return { mean, variance: Math.max(25, sq[c] / n[c] - mean * mean), count: n[c] };
  });
}

/** Gaussian negative log-likelihood of v under a model, capped (outliers cost the same). */
export function nll(v: number, m: { mean: number; variance: number }, cap = 100): number {
  return Math.min(cap, ((v - m.mean) ** 2) / (2 * m.variance) + 0.5 * Math.log(m.variance));
}
