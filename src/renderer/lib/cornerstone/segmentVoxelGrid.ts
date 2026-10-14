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
  /**
   * Labelmap values, column-major over geometry.dimensions. On a stack this is a COPY of the
   * whole stack, made on first access (and a snapshot from then on): an operation that needs
   * a voxel or a plane reads `at` / `slice` instead (X4 — `voxelAt`, the transaction).
   */
  data: ArrayLike<number>;
  /** The value this segment is stored as in `data` (1 on a multi-layer sub-seg). */
  value: number;
  /** The Cornerstone segmentation holding the voxels (the target for modified events). */
  csSegmentationId: string;
  /** Write one voxel (flat column-major index) through the live storage. */
  write(flatIndex: number, value: number): void;
  /**
   * A reader for the SOURCE image intensity at a grid voxel (modality LUT applied: HU on
   * CT), in this grid's index space — for image-guided operations. Built on demand; null
   * when the source pixels are not available.
   */
  sourceReader?: () => ((flatIndex: number) => number) | null;
  /** The live labelmap value at a voxel, read without copying the whole grid. Absent on a
   *  plain in-memory grid, which reads `data`. */
  at?(flatIndex: number): number;
  /** The live values of grid slice `k` (axis 2, `i + j·nx`) — the labelmap image's own pixels,
   *  not a copy; null if unavailable. Absent where slices are not stored apart (a volume). */
  slice?(k: number): ArrayLike<number> | null;
}

/** The labelmap value at `flat` — through `at` when the grid has it, else `data`. */
export function voxelAt(grid: SegmentVoxelGrid, flat: number): number {
  return grid.at ? grid.at(flat) : grid.data[flat];
}

/**
 * Pixel value → modality value for one source image. The DICOM image loader pre-scales by
 * default (its pixels already ARE modality values — HU on CT), so the rescale is applied only to
 * an image the loader did not scale; applying it again read real CT 1024 HU low.
 */
function modalityLut(imageId: string, image?: ImageLike): (v: number) => number {
  if (image?.preScale?.scaled) return (v) => v;
  const m = metaData.get('modalityLutModule', imageId) as { rescaleSlope?: number; rescaleIntercept?: number } | undefined;
  const slope = Number.isFinite(m?.rescaleSlope) ? Number(m?.rescaleSlope) : 1;
  const intercept = Number.isFinite(m?.rescaleIntercept) ? Number(m?.rescaleIntercept) : 0;
  return (v) => v * slope + intercept;
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
  /** Set by the DICOM image loader when it applied the modality LUT to the pixels itself. */
  preScale?: { scaled?: boolean };
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

type GridPart = Pick<SegmentVoxelGrid, 'geometry' | 'data' | 'write' | 'sourceReader' | 'at' | 'slice'>;

/**
 * A stack's placement, per labelmap image-id list (Cornerstone keeps the list for the life
 * of the segmentation): reading a member is then a lookup, not one metadata query per slice.
 */
const placementCache = new WeakMap<string[], { geometry: VoxelGridGeometry; order: number[] }>();

function readStack(labelmapImageIds: string[]): GridPart | null {
  const images: ImageLike[] = [];
  const planes: SlicePlane[] = [];
  let placed = placementCache.get(labelmapImageIds) ?? null;
  for (const id of labelmapImageIds) {
    const image = cache.getImage(id) as ImageLike | undefined;
    if (!image) return null;
    images.push(image);
    if (placed) continue;
    const plane = slicePlane(id, image);
    if (!plane) return null;
    planes.push(plane);
  }
  if (!placed) {
    placed = stackGridGeometry(planes);
    if (!placed) return null;
    placementCache.set(labelmapImageIds, placed);
  }
  const [nx, ny, nz] = placed.geometry.dimensions;
  const sliceSize = nx * ny;
  const sliceImages = placed.order.map((i) => images[i]);
  // Each slice's pixels, fetched the first time a voxel on it is read: an operation on one
  // slice touches one image per member, never the whole stack (X4).
  const slicePixels: Array<ArrayLike<number> | null | undefined> = new Array(nz);
  const pixelsOf = (k: number): ArrayLike<number> | null => {
    let px = slicePixels[k];
    if (px === undefined) {
      const image = sliceImages[k];
      px = slicePixels[k] = (image?.voxelManager?.getScalarData?.() ?? image?.getPixelData?.()) ?? null;
    }
    return px;
  };
  return {
    geometry: placed.geometry,
    // On first access the getter replaces itself with the copy as a plain property: callers
    // loop over `grid.data[i]`, and a getter call per voxel made a whole-volume pass ~3× slower.
    get data(): Uint16Array {
      const copy = new Uint16Array(sliceSize * nz);
      for (let k = 0; k < nz; k++) {
        const pixels = pixelsOf(k);
        if (pixels) for (let p = 0; p < sliceSize && p < pixels.length; p++) copy[k * sliceSize + p] = pixels[p];
      }
      Object.defineProperty(this, 'data', { value: copy, writable: true, enumerable: true, configurable: true });
      return copy;
    },
    at: (flatIndex) => {
      const px = pixelsOf(Math.floor(flatIndex / sliceSize));
      return px ? (px[flatIndex % sliceSize] ?? 0) : 0;
    },
    slice: (k) => (k >= 0 && k < nz ? pixelsOf(k) : null),
    sourceReader: () => {
      // Each labelmap slice is derived from one source image; read that image's pixels.
      const slices = sliceImages.map((img) => {
        const ref = img.referencedImageId;
        const src = ref ? (cache.getImage(ref) as ImageLike | undefined) : undefined;
        const px = src?.voxelManager?.getScalarData?.() ?? src?.getPixelData?.();
        return px && ref ? { px, lut: modalityLut(ref, src) } : null;
      });
      if (slices.some((sl) => !sl)) return null;
      return (flatIndex) => {
        const sl = slices[Math.floor(flatIndex / sliceSize)]!;
        return sl.lut(sl.px[flatIndex % sliceSize] ?? 0);
      };
    },
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

function readVolume(volumeId: string): GridPart | null {
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
    sourceReader: () => {
      // A derived labelmap volume shares its source volume's grid; volumes hold modality
      // values already (the loader applies the LUT when it fills the volume).
      const src = vol.referencedVolumeId ? (cache.getVolume(vol.referencedVolumeId) as any) : null;
      const vm = src?.voxelManager;
      const arr = (vm?.getCompleteScalarDataArray?.() ?? vm?.getScalarData?.()) as ArrayLike<number> | undefined;
      if (!arr?.length) return null;
      return (flatIndex) => arr[flatIndex] ?? 0;
    },
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
    // Not spread: `data` is a lazy getter, which a spread would evaluate (copying the grid).
    return grid ? Object.assign(grid, { value, csSegmentationId }) : null;
  } catch (err) {
    console.warn('[segmentVoxelGrid] could not read labelmap:', err);
    return null;
  }
}
