/**
 * Whether a viewport displays a segment's labelmap — the guard every operation that takes
 * "the slice on screen" from a viewport's camera needs (#91, ledger X3). Without it, the
 * active viewport's camera was projected into the active container's grid even when that
 * viewport showed another scan: the edit landed on a slice nobody was looking at.
 *
 * `csSegmentationId` is the Cornerstone segmentation that holds the segment's voxels —
 * for a multi-layer group, the member's sub-segmentation (`SegmentVoxelGrid` resolves it).
 */
import { segmentation as csSegmentation } from '@cornerstonejs/tools';

export function viewportShowsSegmentation(viewportId: string, grid: { csSegmentationId: string }): boolean {
  try {
    return csSegmentation.state.getViewportIdsWithSegmentation(grid.csSegmentationId).includes(viewportId);
  } catch {
    return false; // not attached anywhere
  }
}
