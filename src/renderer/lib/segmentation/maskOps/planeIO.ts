/**
 * Moving between a segment's 3D voxel grid and the 2D planes cleanup operations work on.
 *
 * A grid is column-major `i + j·nx + k·nx·ny` (Cornerstone, SegmentVoxelGrid). A plane is
 * the slice of constant index along `axis` — the grid axis the viewer looks along
 * (`sliceAxisFor`) — so the same code serves axial, sagittal, coronal and oblique
 * acquisitions without touching world space. Plane x / y are the two remaining grid
 * axes in increasing order (axis 2 → x=i, y=j; axis 1 → x=i, y=k; axis 0 → x=j, y=k).
 */
import type { MaskPlane, PlaneSpacing } from './plane';

export type Axis = 0 | 1 | 2;
export type Dims = readonly [number, number, number] | readonly number[];

/** The grid axes that become plane x and plane y for a slice along `axis`. */
export function planeAxes(axis: Axis): [Axis, Axis] {
  return axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
}

export function planeSize(dims: Dims, axis: Axis): { width: number; height: number } {
  const [ax, ay] = planeAxes(axis);
  return { width: dims[ax], height: dims[ay] };
}

export function planeSpacing(spacing: Dims, axis: Axis): PlaneSpacing {
  const [ax, ay] = planeAxes(axis);
  return { x: spacing[ax], y: spacing[ay] };
}

/** Flat grid index of plane pixel (x, y) on slice `slice` along `axis`. */
export function gridIndexOf(dims: Dims, axis: Axis, slice: number, x: number, y: number): number {
  const nx = dims[0];
  const nxy = dims[0] * dims[1];
  if (axis === 2) return x + y * nx + slice * nxy;
  if (axis === 1) return x + slice * nx + y * nxy;
  return slice + x * nx + y * nxy;
}

/** Every grid index of a slice, in plane order (`x + y·width`). */
export function sliceIndices(dims: Dims, axis: Axis, slice: number): Int32Array {
  const { width, height } = planeSize(dims, axis);
  const out = new Int32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) out[x + y * width] = gridIndexOf(dims, axis, slice, x, y);
  }
  return out;
}

/** The plane of a slice, set where `read(gridIndex) === value`. */
export function extractPlane(
  dims: Dims,
  axis: Axis,
  slice: number,
  read: (gridIndex: number) => number,
  value: number,
): MaskPlane {
  const { width, height } = planeSize(dims, axis);
  const idx = sliceIndices(dims, axis, slice);
  const data = new Uint8Array(idx.length);
  for (let p = 0; p < idx.length; p++) if (read(idx[p]) === value) data[p] = 1;
  return { width, height, data };
}

/** A slice's raw values (e.g. image intensities) in plane order. */
export function extractValues(dims: Dims, axis: Axis, slice: number, read: (gridIndex: number) => number): Float32Array {
  const idx = sliceIndices(dims, axis, slice);
  const out = new Float32Array(idx.length);
  for (let p = 0; p < idx.length; p++) out[p] = read(idx[p]);
  return out;
}

/** Number of slices along `axis`. */
export function sliceCount(dims: Dims, axis: Axis): number {
  return dims[axis];
}
