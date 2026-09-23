/**
 * One segment's labelmap voxels as a world-oriented 3D grid, whatever storage holds them.
 *
 * The voxel clipboard (D6 / signal 23) works on a 3D grid with a world transform. What
 * users actually paint is a multi-layer group ("New Segmentation" creates one): each
 * segment is its own Cornerstone sub-seg whose voxels are value 1, stored as a STACK —
 * one labelmap image per source image. A flat segmentation stores every segment in one
 * labelmap, as its segment index. Either can be stack- or volume-backed. This resolves
 * the segment to the Cornerstone segmentation + value that hold it, assembles a stack
 * into a grid (slices ordered along the plane normal), and writes back through each
 * image's voxelManager — the brush's own write path.
 */
import { cache, metaData } from '@cornerstonejs/core';
import { segmentation as csSegmentation } from '@cornerstonejs/tools';
import * as mlg from './multiLayerGroup';
import { labelmapStorage } from './labelmapLayers';
import type { Vec3, VoxelGridGeometry } from './segmentationService/voxelClipboard';

export interface SegmentVoxelGrid {
  geometry: VoxelGridGeometry;
  /** Labelmap values, column-major over geometry.dimensions. */
  data: ArrayLike<number>;
  /** The value this segment is stored as in `data` (1 on a multi-layer sub-seg). */
  value: number;
  /** The Cornerstone segmentation holding the voxels (the target for modified events). */
  csSegmentationId: string;
  /** Write one voxel (flat column-major index) through the live storage. */
  write(flatIndex: number, value: number): void;
}

/** The imagePlaneModule fields a stack slice needs to place it in world space. */
export interface SlicePlane {
  rows: number;
  columns: number;
  imagePositionPatient: Vec3;
  rowCosines: Vec3;
  columnCosines: Vec3;
  /** Spacing between rows (along columnCosines, the j axis). */
  rowPixelSpacing: number;
  /** Spacing between columns (along rowCosines, the i axis). */
  columnPixelSpacing: number;
  sliceThickness?: number;
}

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * The clipboard's `direction` is row-major with the AXES AS COLUMNS
 * (world = origin + D · (index .* spacing)), i.e. the transpose of Cornerstone's
 * `[iAxis, jAxis, kAxis]` layout.
 */
export function axesToDirection(iAxis: Vec3, jAxis: Vec3, kAxis: Vec3): number[] {
  return [iAxis[0], jAxis[0], kAxis[0], iAxis[1], jAxis[1], kAxis[1], iAxis[2], jAxis[2], kAxis[2]];
}

/**
 * Place a stack's slices as one regular grid: returns the geometry and the slice order
 * (order[k] = the input slice at grid index k), or null when the slices are not a
 * single regular volume (mixed size or orientation, uneven spacing) — a 3D region
 * cannot be copied out of those faithfully.
 */
export function stackGridGeometry(planes: SlicePlane[]): { geometry: VoxelGridGeometry; order: number[] } | null {
  if (planes.length === 0) return null;
  const p0 = planes[0];
  const normal = cross(p0.rowCosines, p0.columnCosines);
  for (const p of planes) {
    if (p.rows !== p0.rows || p.columns !== p0.columns) return null;
    if (dot(p.rowCosines, p0.rowCosines) < 0.999 || dot(p.columnCosines, p0.columnCosines) < 0.999) return null;
  }
  const order = planes.map((_, i) => i);
  const depth = planes.map((p) => dot(p.imagePositionPatient, normal));
  order.sort((a, b) => depth[a] - depth[b]);

  let kSpacing = p0.sliceThickness && p0.sliceThickness > 0 ? p0.sliceThickness : 1;
  if (planes.length > 1) {
    kSpacing = (depth[order[order.length - 1]] - depth[order[0]]) / (planes.length - 1);
    if (!(kSpacing > 0)) return null;
    for (let k = 1; k < order.length; k++) {
      const gap = depth[order[k]] - depth[order[k - 1]];
      if (Math.abs(gap - kSpacing) > Math.max(0.01, kSpacing * 0.01)) return null;
    }
  }

  return {
    geometry: {
      dimensions: [p0.columns, p0.rows, planes.length],
      spacing: [p0.columnPixelSpacing, p0.rowPixelSpacing, kSpacing],
      origin: [...planes[order[0]].imagePositionPatient] as Vec3,
      direction: axesToDirection(p0.rowCosines, p0.columnCosines, normal),
    },
    order,
  };
}

type ImageLike = {
  referencedImageId?: string;
  voxelManager?: { getScalarData?: () => ArrayLike<number>; setAtIndex?: (i: number, v: number) => void };
  getPixelData?: () => { [i: number]: number; length: number };
};

function slicePlane(imageId: string, image: ImageLike): SlicePlane | null {
  const plane = (metaData.get('imagePlaneModule', imageId)
    ?? (image.referencedImageId ? metaData.get('imagePlaneModule', image.referencedImageId) : undefined)) as
    | Partial<SlicePlane>
    | undefined;
  if (!plane?.imagePositionPatient || !plane.rowCosines || !plane.columnCosines || !plane.rows || !plane.columns) {
    return null;
  }
  return {
    rows: plane.rows,
    columns: plane.columns,
    imagePositionPatient: [...plane.imagePositionPatient] as Vec3,
    rowCosines: [...plane.rowCosines] as Vec3,
    columnCosines: [...plane.columnCosines] as Vec3,
    rowPixelSpacing: plane.rowPixelSpacing || 1,
    columnPixelSpacing: plane.columnPixelSpacing || 1,
    sliceThickness: plane.sliceThickness,
  };
}

function readStack(labelmapImageIds: string[]): Pick<SegmentVoxelGrid, 'geometry' | 'data' | 'write'> | null {
  const images: ImageLike[] = [];
  const planes: SlicePlane[] = [];
  for (const id of labelmapImageIds) {
    const image = cache.getImage(id) as ImageLike | undefined;
    const plane = image ? slicePlane(id, image) : null;
    if (!image || !plane) return null;
    images.push(image);
    planes.push(plane);
  }
  const placed = stackGridGeometry(planes);
  if (!placed) return null;
  const [nx, ny, nz] = placed.geometry.dimensions;
  const sliceSize = nx * ny;
  const data = new Uint16Array(sliceSize * nz);
  const sliceImages = placed.order.map((i) => images[i]);
  sliceImages.forEach((image, k) => {
    const pixels = image.voxelManager?.getScalarData?.() ?? image.getPixelData?.();
    if (pixels) for (let p = 0; p < sliceSize && p < pixels.length; p++) data[k * sliceSize + p] = pixels[p];
  });
  return {
    geometry: placed.geometry,
    data,
    write: (flatIndex, value) => {
      const image = sliceImages[Math.floor(flatIndex / sliceSize)];
      const p = flatIndex % sliceSize;
      if (typeof image?.voxelManager?.setAtIndex === 'function') image.voxelManager.setAtIndex(p, value);
      else {
        const pixels = image?.getPixelData?.();
        if (pixels) pixels[p] = value;
      }
    },
  };
}

function readVolume(volumeId: string): Pick<SegmentVoxelGrid, 'geometry' | 'data' | 'write'> | null {
  // Derived volume labelmaps expose data via getCompleteScalarDataArray() (getScalarData()
  // can be empty); WRITES must go through the voxelManager — the read array is a copy.
  const vol = cache.getVolume(volumeId) as any;
  if (!vol) return null;
  const img = vol.imageData;
  const dimensions = (vol.dimensions ?? img?.getDimensions?.()) as Vec3 | undefined;
  const spacing = (vol.spacing ?? img?.getSpacing?.()) as Vec3 | undefined;
  const origin = (vol.origin ?? img?.getOrigin?.()) as Vec3 | undefined;
  const d = Array.from((vol.direction ?? img?.getDirection?.()) ?? []) as number[];
  const voxelManager = vol.voxelManager;
  const data = (voxelManager?.getCompleteScalarDataArray?.() ?? voxelManager?.getScalarData?.() ?? vol.scalarData) as
    | ArrayLike<number>
    | undefined;
  if (!dimensions || !spacing || !origin || d.length < 9 || !data?.length) return null;
  const [nx, ny] = dimensions;
  return {
    geometry: {
      dimensions,
      spacing,
      origin,
      // Cornerstone lays the axes out as rows; the clipboard wants them as columns.
      direction: axesToDirection([d[0], d[1], d[2]], [d[3], d[4], d[5]], [d[6], d[7], d[8]]),
    },
    data,
    write: (flatIndex, value) => {
      if (typeof voxelManager.setAtIJK === 'function') {
        voxelManager.setAtIJK(flatIndex % nx, Math.floor(flatIndex / nx) % ny, Math.floor(flatIndex / (nx * ny)), value);
      } else {
        voxelManager.setAtIndex(flatIndex, value);
      }
    },
  };
}

/** Read segment `segmentIndex` of container `segmentationId`, or null if it has no labelmap grid. */
export function readSegmentVoxelGrid(segmentationId: string, segmentIndex: number): SegmentVoxelGrid | null {
  let csSegmentationId = segmentationId;
  let value = segmentIndex;
  if (mlg.isMultiLayerGroup(segmentationId)) {
    const subSegId = mlg.resolveSubSegId(segmentationId, segmentIndex);
    if (!subSegId) return null;
    csSegmentationId = subSegId;
    value = 1;
  }
  try {
    const seg = csSegmentation.state.getSegmentation(csSegmentationId) as
      | { representationData?: { Labelmap?: unknown } }
      | undefined;
    const storage = labelmapStorage(seg?.representationData?.Labelmap);
    const grid = storage.volumeIds[0]
      ? readVolume(storage.volumeIds[0])
      : storage.imageIdLists[0]?.length
        ? readStack(storage.imageIdLists[0])
        : null;
    return grid ? { ...grid, value, csSegmentationId } : null;
  } catch (err) {
    console.warn('[segmentVoxelGrid] could not read labelmap:', err);
    return null;
  }
}
