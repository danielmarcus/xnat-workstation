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
import { readSegmentVoxelGrid, type SegmentVoxelGrid } from './segmentVoxelGrid';
import { sliceNumbering } from './sliceNumbering';
import { viewportSlice } from './maskOpsService';
import type { Axis } from '../segmentation/maskOps/planeIO';

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
  const axis = where.axis as Axis;
  const hit = occupiedGridSlices(grid, axis);
  const out: number[] = [];
  for (let k = 0; k < hit.length; k++) if (hit[k]) out.push(numbering.toDisplay(k));
  return out.sort((a, b) => a - b);
}

/**
 * Which grid slices along `axis` hold the segment — in ONE pass over the grid, a stored slice
 * (`grid.slice`) at a time, as plain arrays. It runs on every labelmap edit while a slice
 * track is shown; reading voxel by voxel (`voxelAt`) made a Contour Fill drag on 512² × 40
 * about 50% slower.
 */
export function occupiedGridSlices(grid: SegmentVoxelGrid, axis: Axis): Uint8Array {
  const [nx, ny, nz] = grid.geometry.dimensions;
  const hit = new Uint8Array(axis === 0 ? nx : axis === 1 ? ny : nz);
  const value = grid.value;
  const plane = nx * ny;
  const whole = grid.slice ? null : grid.data;
  for (let k = 0; k < nz; k++) {
    const px = grid.slice ? grid.slice(k) : null;
    const data = px ?? whole;
    if (!data) continue;
    const off = px ? 0 : k * plane;
    if (axis === 2) {
      for (let p = 0; p < plane; p++) if (data[off + p] === value) { hit[k] = 1; break; }
      continue;
    }
    for (let y = 0; y < ny; y++) {
      const row = off + y * nx;
      for (let x = 0; x < nx; x++) {
        if (data[row + x] !== value) continue;
        if (axis === 0) hit[x] = 1;
        else { hit[y] = 1; break; }
      }
    }
  }
  return hit;
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
