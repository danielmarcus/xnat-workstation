/**
 * Max-pool resampling for the 3D view (SegWorks #239): the longest axis is brought within
 * the target by an integer factor, and a block is inside if ANY voxel in it is — so a
 * one-voxel speck is never resampled away, which is the point of a QC view.
 */
import type { Dims } from './components';

export function maxPoolResample(mask: ArrayLike<number>, dims: Dims, target: number): { data: Uint8Array; dims: Dims; factor: number } {
  return maxPoolByFactor(mask, dims, Math.max(1, Math.ceil(Math.max(...dims) / target)));
}

/**
 * Max-pool by a given integer factor, or one per axis (the build applies volume-wide factors to
 * every crop — per axis, so 40 thick slices are not pooled because the slices have 512 pixels).
 */
export function maxPoolByFactor(mask: ArrayLike<number>, dims: Dims, factor: number | Dims): { data: Uint8Array; dims: Dims; factor: number } {
  const [nx, ny, nz] = dims;
  const [fx, fy, fz] = typeof factor === 'number' ? [factor, factor, factor] : factor;
  const f = Math.max(fx, fy, fz);
  if (f === 1) return { data: Uint8Array.from(mask, (v) => (v ? 1 : 0)), dims: [nx, ny, nz], factor: f };
  const out: Dims = [Math.ceil(nx / fx), Math.ceil(ny / fy), Math.ceil(nz / fz)];
  const data = new Uint8Array(out[0] * out[1] * out[2]);
  for (let k = 0; k < nz; k++) {
    const K = Math.floor(k / fz);
    for (let j = 0; j < ny; j++) {
      const J = Math.floor(j / fy);
      const row = nx * (j + ny * k);
      const orow = out[0] * (J + out[1] * K);
      for (let i = 0; i < nx; i++) if (mask[row + i]) data[orow + Math.floor(i / fx)] = 1;
    }
  }
  return { data, dims: out, factor: f };
}
