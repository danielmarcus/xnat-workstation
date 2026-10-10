/**
 * Slice-track data (SegWorks parity D5): which slices of a viewport hold the active
 * segment, in the viewport's OWN numbering, so the scrollbar can mark them.
 *
 * Computed from the segment's voxel grid along the axis the viewport looks down, mapped
 * through sliceNumbering. Only for a viewport that actually shows the segment's container
 * (a mask belongs to its own scan).
 */
import { eventTarget } from '@cornerstonejs/core';
import { Enums as ToolEnums, segmentation as csSegmentation } from '@cornerstonejs/tools';
import { readSegmentVoxelGrid } from './segmentVoxelGrid';
import { sliceNumbering } from './sliceNumbering';
import { viewportSlice } from './maskOpsService';
import { gridIndexOf, planeSize, type Axis } from '../segmentation/maskOps/planeIO';

/** Displayed slice indices (0-based) on which the segment has at least one voxel, ascending. */
export function occupiedDisplaySlices(viewportId: string, containerId: string, segmentIndex: number): number[] | null {
  const grid = readSegmentVoxelGrid(containerId, segmentIndex);
  if (!grid) return null;
  let shown: string[] = [];
  try {
    shown = csSegmentation.state.getViewportIdsWithSegmentation(grid.csSegmentationId);
  } catch { /* not attached anywhere */ }
  if (!shown.includes(viewportId)) return null;
  const where = viewportSlice(viewportId, grid.geometry);
  if (!where) return null;
  const numbering = sliceNumbering(viewportId, grid.geometry, where.axis);
  if (!numbering) return null;
  const dims = grid.geometry.dimensions;
  const axis = where.axis as Axis;
  const { width, height } = planeSize(dims, axis);
  const out: number[] = [];
  for (let k = 0; k < dims[axis]; k++) {
    let hit = false;
    for (let y = 0; y < height && !hit; y++) {
      for (let x = 0; x < width; x++) {
        if (grid.data[gridIndexOf(dims, axis, k, x, y)] === grid.value) { hit = true; break; }
      }
    }
    if (hit) out.push(numbering.toDisplay(k));
  }
  return out.sort((a, b) => a - b);
}

/** Collapse sorted indices into inclusive runs. */
export function toRuns(indices: number[]): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  for (const i of indices) {
    const last = runs[runs.length - 1];
    if (last && i === last[1] + 1) last[1] = i;
    else runs.push([i, i]);
  }
  return runs;
}

/** Subscribe to labelmap edits (any segmentation). Returns the unsubscribe. */
export function onLabelmapModified(fn: () => void): () => void {
  const listener = () => fn();
  eventTarget.addEventListener(ToolEnums.Events.SEGMENTATION_DATA_MODIFIED, listener);
  return () => eventTarget.removeEventListener(ToolEnums.Events.SEGMENTATION_DATA_MODIFIED, listener);
}
