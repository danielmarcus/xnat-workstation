/**
 * Contour-edit prerequisite (signal 30) — a tiny, dependency-light helper that
 * makes the `LabelmapEditWithContour` ("Contour Fill") tool able to draw.
 *
 * Why this is its own module: it must be importable from `unifiedToolService`
 * (tool activation), and `unifiedToolService` is in turn imported by widely-used
 * modules. Folding this into `unifiedSegService` would drag that service's
 * `@cornerstonejs/polymorphic-segmentation` dependency — whose top-level worker
 * init throws under the unit-test (vitest) environment — into every consumer of
 * `unifiedToolService`. This module imports ONLY `@cornerstonejs/tools`, so the
 * tool service stays polyseg-free.
 *
 * The behaviour mirrors Cornerstone's own `LabelMapEditWithContourTool.
 * checkContourSegmentation`: `ContourSegmentationBaseTool.createAnnotation` THROWS
 * ("A contour segmentation must be active") unless the active labelmap segmentation
 * already carries a Contour representation on the drawing viewport — so the freehand
 * gesture is a swallowed no-op. The tool adds that representation reactively
 * (TOOLGROUP_VIEWPORT_ADDED / SEGMENTATION_MODIFIED), but neither event fires when
 * the tool is selected with the viewport + labelmap already present. We add it here,
 * at tool-activation time.
 */
import { segmentation as csSegmentation, Enums as ToolEnums } from '@cornerstonejs/tools';

/**
 * Ensure the active segmentation on each viewport carries a Contour representation,
 * so the Contour Fill tool can draw (and then rasterize into the labelmap).
 * Idempotent: a segmentation that already has a Contour representation is skipped.
 */
export function ensureContourEditPrereq(viewportIds: string[]): void {
  for (const viewportId of viewportIds) {
    const activeSeg = csSegmentation.getActiveSegmentation(viewportId) as
      | { segmentationId?: string; representationData?: { Contour?: unknown } }
      | undefined;
    const segmentationId = activeSeg?.segmentationId;
    if (!segmentationId || activeSeg?.representationData?.Contour) continue;
    // The viewport representation renders the in-progress contour while drawing;
    // representationData.Contour is what satisfies createAnnotation's guard.
    try {
      csSegmentation.addContourRepresentationToViewport(viewportId, [{ segmentationId }]);
    } catch {
      /* viewport not ready — the guard is still satisfied by addRepresentationData */
    }
    csSegmentation.addRepresentationData({
      segmentationId,
      type: ToolEnums.SegmentationRepresentations.Contour,
      data: {} as never,
    });
  }
}
