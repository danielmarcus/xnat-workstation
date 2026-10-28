/**
 * A box of a segment's voxel grid laid out along the viewing plane (branch 5, shared with branch
 * 9's module operations): x and y in-plane, z through the slices, in the grid's own index space —
 * so oblique series behave. Solvers and modules work on boxes; these map them back to the grid.
 */
import { worldToIndexFloat, type Vec3, type VoxelGridGeometry } from './segmentationService/voxelClipboard';
import { type Axis, planeAxes } from '../segmentation/maskOps/planeIO';
import type { Dims, Spacing } from '../segmentation/solvers/volume';

export interface Box {
  geometry: VoxelGridGeometry;
  axis: Axis;
  ax: Axis;
  ay: Axis;
  /** Lowest corner in (in-plane x, in-plane y, slice) grid indices. */
  lo: [number, number, number];
  dims: Dims;
  spacing: Spacing;
}

/** A world point in (in-plane x, in-plane y, slice) grid index coordinates. */
export function toPlane(geometry: VoxelGridGeometry, axis: Axis, w: number[]): [number, number, number] {
  const ijk = worldToIndexFloat(geometry, w as Vec3);
  const [ax, ay] = planeAxes(axis);
  return [ijk[ax], ijk[ay], ijk[axis]];
}

/** The grid flat index of box voxel (x, y, z). */
export const flatOf = (box: Box, x: number, y: number, z: number) => {
  const ijk = [0, 0, 0];
  ijk[box.ax] = box.lo[0] + x; ijk[box.ay] = box.lo[1] + y; ijk[box.axis] = box.lo[2] + z;
  const d = box.geometry.dimensions;
  return ijk[0] + d[0] * (ijk[1] + d[1] * ijk[2]);
};

/** A box from its lowest and highest corners (inclusive), in plane coordinates. */
export function makeBox(geometry: VoxelGridGeometry, axis: Axis, lo: number[], hi: number[]): Box {
  const [ax, ay] = planeAxes(axis);
  const dims: Dims = [hi[0] - lo[0] + 1, hi[1] - lo[1] + 1, hi[2] - lo[2] + 1];
  const spacing: Spacing = [geometry.spacing[ax], geometry.spacing[ay], geometry.spacing[axis]];
  return { geometry, axis, ax, ay, lo: [lo[0], lo[1], lo[2]], dims, spacing };
}

/** Visit every voxel of a box: its index in box order and its grid flat index. */
export function forEachBoxVoxel(box: Box, f: (i: number, flat: number) => void): void {
  for (let z = 0, i = 0; z < box.dims[2]; z++) for (let y = 0; y < box.dims[1]; y++) for (let x = 0; x < box.dims[0]; x++, i++) f(i, flatOf(box, x, y, z));
}
