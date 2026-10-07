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
import type { Types as CoreTypes } from '@cornerstonejs/core';

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
