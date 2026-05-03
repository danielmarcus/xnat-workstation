/**
 * Labelmap hit-testing — Phase 3.5c-canvas-labelmap.
 *
 * Sister to `contourHitTest.ts`. The contour case answers "is the cursor
 * near a polyline?" via canvas-space distance. The labelmap case answers
 * "what segment does this voxel belong to?" by sampling the underlying
 * labelmap volume at the cursor's world position.
 *
 * Cornerstone exposes `csTools.utilities.segmentation.getSegmentIndexAtWorldPoint`
 * as a stable public API — it abstracts over stack vs volume labelmaps and
 * does the world→IJK→sample work internally. We just enumerate the
 * labelmap segmentations attached to the viewport and ask each one in turn.
 *
 * Returns the first non-zero hit. Multi-segmentation overlap is rare in
 * practice (each container is typically one segmentation), and the
 * iteration order matches `getViewportSegmentationRepresentations` which
 * is the on-screen draw order — so "first hit" is also the visually
 * topmost segment, which is what users expect.
 */
import { utilities as csToolsUtilities, Enums as ToolEnums, segmentation as csSegmentation } from '@cornerstonejs/tools';
import type { Types as CoreTypes } from '@cornerstonejs/core';
import type { HitTestViewport } from './contourHitTest';

/**
 * Find the (segmentationId, segmentIndex) at a world point on this
 * viewport, scanning labelmap segmentations attached to the viewport.
 * Returns null when no labelmap segment is hit.
 *
 * The Cornerstone `getSegmentIndexAtWorldPoint` API needs the viewport's
 * full IViewport interface (uses `canvasToWorld` and the volume cache).
 * The HitTestViewport type is structural — the actual cs viewport
 * satisfies it plus the rest of IViewport.
 */
export function findLabelmapSegmentAtWorldPoint(
  viewport: HitTestViewport | null | undefined,
  worldPoint: [number, number, number],
): { segmentationId: string; segmentIndex: number } | null {
  if (!viewport || !viewport.id) return null;

  const reps = (() => {
    try {
      return csSegmentation.state.getViewportSegmentationRepresentations(viewport.id) ?? [];
    } catch {
      return [];
    }
  })();

  for (const rep of reps) {
    if (rep?.type !== ToolEnums.SegmentationRepresentations.Labelmap) continue;
    const segmentationId = (rep as { segmentationId?: string }).segmentationId;
    if (!segmentationId) continue;

    let segmentIndex: number | undefined;
    try {
      segmentIndex = csToolsUtilities.segmentation.getSegmentIndexAtWorldPoint(
        segmentationId,
        worldPoint as CoreTypes.Point3,
        {
          representationType: ToolEnums.SegmentationRepresentations.Labelmap,
          viewport: viewport as unknown as CoreTypes.IViewport,
        },
      );
    } catch {
      // Sampling can throw on a freshly-attached labelmap that hasn't
      // finished loading; treat as miss and continue.
      continue;
    }

    if (Number.isInteger(segmentIndex) && segmentIndex! > 0) {
      return { segmentationId, segmentIndex: segmentIndex! };
    }
  }

  return null;
}
