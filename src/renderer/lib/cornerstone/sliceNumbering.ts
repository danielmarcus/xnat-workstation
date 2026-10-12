/**
 * Grid slice ↔ the slice number a viewport DISPLAYS ("8 / 16"), for one viewport.
 *
 * A segment's voxel grid orders slices by position along its k axis; a viewport numbers
 * them its own way — a stack by image order, a volume viewport along its view-plane
 * normal — and the two often run in opposite directions (an axial stack listed head to
 * foot sits in a grid built foot to head). Anything shown to the user (operation
 * summaries, range fields, the slice track) must use the viewport's numbering, or "slice
 * 9" is printed while the overlay says 8.
 *
 * Both orderings are linear in the same slices, so the map is display = d₀ + s·(k − k₀):
 * (d₀, k₀) is where the viewport is now, and the sign s comes from the neighbouring
 * image's position (stack) or the view-plane normal (volume viewports scroll along it).
 */
import { Enums, metaData } from '@cornerstonejs/core';
import { viewportService } from './viewportService';
import { worldToIndex, type Vec3, type VoxelGridGeometry } from './segmentationService/voxelClipboard';
import type { Axis } from '../segmentation/maskOps/planeIO';

export interface SliceNumbering {
  /** Grid slice → displayed index (0-based; the overlay shows it + 1). */
  toDisplay(k: number): number;
  /** Displayed index (0-based) → grid slice. */
  toGrid(d: number): number;
}

type AnyViewport = {
  type?: string;
  getCamera?: () => { focalPoint?: number[]; viewPlaneNormal?: number[] };
  getCurrentImageIdIndex?: () => number;
  getSliceIndex?: () => number;
  getImageIds?: () => string[];
};

/** The linear map from (d₀, k₀) and direction s. Exported for unit tests. */
export function linearNumbering(d0: number, k0: number, s: 1 | -1): SliceNumbering {
  return {
    toDisplay: (k) => d0 + s * (k - k0),
    toGrid: (d) => k0 + s * (d - d0),
  };
}

export function sliceNumbering(viewportId: string, geometry: VoxelGridGeometry, axis: Axis): SliceNumbering | null {
  const vp = viewportService.getViewport(viewportId) as AnyViewport | undefined;
  const cam = vp?.getCamera?.();
  if (!vp || !cam?.focalPoint || !cam.viewPlaneNormal) return null;
  const k0 = worldToIndex(geometry, cam.focalPoint as Vec3)[axis];

  if (vp.type === Enums.ViewportType.STACK) {
    const ids = vp.getImageIds?.() ?? [];
    const d0 = vp.getCurrentImageIdIndex?.() ?? 0;
    const neighbour = d0 + 1 < ids.length ? d0 + 1 : d0 - 1;
    const ipp = neighbour >= 0 ? (metaData.get('imagePlaneModule', ids[neighbour]) as { imagePositionPatient?: number[] } | undefined)?.imagePositionPatient : undefined;
    if (!ipp) return linearNumbering(d0, k0, 1);
    const kn = worldToIndex(geometry, ipp as Vec3)[axis];
    const forward = (kn - k0) * (neighbour - d0) >= 0;
    return linearNumbering(d0, k0, forward ? 1 : -1);
  }

  // Volume viewports number slices increasing along the view-plane normal.
  const d0 = vp.getSliceIndex?.() ?? 0;
  const n = cam.viewPlaneNormal;
  const dir = geometry.direction;
  const along = dir[axis] * n[0] + dir[3 + axis] * n[1] + dir[6 + axis] * n[2];
  return linearNumbering(d0, k0, along >= 0 ? 1 : -1);
}
