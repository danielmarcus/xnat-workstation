/**
 * The plane metadata a contour annotation needs to belong to a viewport slice — the
 * same fields a Cornerstone tool stroke records: `viewPlaneNormal` / `viewUp` from the
 * viewport's view (camera), and the slice index.
 *
 * Cornerstone matches contours to viewports (`getViewportsForAnnotation`) and pairs
 * them for interpolation by EXACT equality of `viewPlaneNormal` and `viewUp` with the
 * viewport camera's. A contour created outside a tool stroke must therefore take them
 * from the viewport, not from the image: left unset, Cornerstone's display filter
 * derives the normal from the image orientation (row × column), which is the reverse
 * of a stack viewport's view direction — and the contour then never matches.
 */
import { toPoint3 } from './segmentationService/contourGeometry';
import { utilities as csUtilities, type Types as CoreTypes } from '@cornerstonejs/core';

export interface PlaneViewport {
  getViewReference?: (options?: { sliceIndex?: number }) => Record<string, unknown> | undefined;
  getCamera?: () => { viewPlaneNormal?: unknown; viewUp?: unknown } | undefined;
}

export interface ContourPlaneMetadata {
  viewPlaneNormal?: CoreTypes.Point3;
  viewUp?: CoreTypes.Point3;
  sliceIndex?: number;
  FrameOfReferenceUID?: string;
}

export function contourPlaneMetadata(viewport: PlaneViewport | null | undefined, sliceIndex: number | null): ContourPlaneMetadata {
  if (!viewport) return {};
  const viewReference = sliceIndex != null
    ? viewport.getViewReference?.({ sliceIndex })
    : viewport.getViewReference?.();
  const camera = viewport.getCamera?.();
  const out: ContourPlaneMetadata = {};

  const viewPlaneNormal = toPoint3(viewReference?.viewPlaneNormal) ?? toPoint3(camera?.viewPlaneNormal);
  if (viewPlaneNormal) out.viewPlaneNormal = viewPlaneNormal;
  const viewUp = toPoint3(viewReference?.viewUp) ?? toPoint3(camera?.viewUp);
  if (viewUp) out.viewUp = viewUp;

  const referencedSliceIndex = Number.isInteger(viewReference?.sliceIndex)
    ? Number(viewReference?.sliceIndex)
    : sliceIndex;
  if (referencedSliceIndex != null) out.sliceIndex = referencedSliceIndex;

  if (typeof viewReference?.FrameOfReferenceUID === 'string') {
    out.FrameOfReferenceUID = viewReference.FrameOfReferenceUID;
  }
  return out;
}

/**
 * The viewport's own slice index for a contour lying on the plane through `point` — the
 * index a tool stroke on that slice records (`getCurrentImageIdIndex()`), which
 * Cornerstone's interpolation uses to find the gaps between a structure's contours.
 *
 * On a volume viewport that index is the camera's scroll step along the view normal, and
 * it need not run in the order of `getImageIds()`: with the view normal pointing against
 * the acquisition order (an axial series stored foot-to-head, viewed head-to-foot) the
 * two are reversed. Recording a loaded contour's position in the image list then puts it
 * on the wrong slice for interpolation, which bridges the wrong gap and generates a
 * contour between two slices, where it is drawn on neither.
 *
 * Computed as `getVolumeViewportScrollInfo` computes the camera's step, with the contour's
 * plane in place of the focal point. Returns null for a viewport that is not showing a
 * volume — a stack viewport's slice index IS the position in its image list.
 */
export function volumeSliceIndexForPoint(viewport: unknown, point: CoreTypes.Point3): number | null {
  const vp = viewport as { getVolumeId?: () => string | undefined } | null | undefined;
  const volumeId = typeof vp?.getVolumeId === 'function' ? vp.getVolumeId() : undefined;
  if (!volumeId) return null;
  let scrollInfo: ReturnType<typeof csUtilities.getVolumeViewportScrollInfo>;
  try {
    scrollInfo = csUtilities.getVolumeViewportScrollInfo(viewport as never, volumeId, true);
  } catch {
    return null;
  }
  const { numScrollSteps, sliceRangeInfo } = scrollInfo;
  const { sliceRange, camera } = sliceRangeInfo;
  const { focalPoint, viewPlaneNormal } = camera ?? {};
  const range = sliceRange.max - sliceRange.min;
  if (!focalPoint || !viewPlaneNormal || !(range > 0)) return null;
  const alongNormal =
    sliceRange.current
    + (point[0] - focalPoint[0]) * viewPlaneNormal[0]
    + (point[1] - focalPoint[1]) * viewPlaneNormal[1]
    + (point[2] - focalPoint[2]) * viewPlaneNormal[2];
  const step = Math.round(((alongNormal - sliceRange.min) / range) * numScrollSteps);
  return Number.isFinite(step) ? Math.min(Math.max(step, 0), numScrollSteps) : null;
}
