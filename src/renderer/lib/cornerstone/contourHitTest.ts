/**
 * Contour hit-testing — shared logic for click-to-select (existing) and
 * hover-to-highlight (Phase 3.5c-canvas, D7.8 canvas-side).
 *
 * Extracts the duplicated `selectContourAnnotationAtCanvasPoint` logic
 * from `CornerstoneViewport.tsx` and `VolumeViewport.tsx`. Both components
 * had near-identical implementations: filter annotations to the current
 * slice, project the polyline through `viewport.worldToCanvas`, find the
 * nearest segment to the click/hover point. The pure logic now lives here
 * so it can be reused for hover without copy-pasting.
 *
 * Returns the nearest annotationUID (within a configurable radius) or
 * null. Callers decide what to do with the result — selection, hover,
 * tooltips, etc.
 */
import { annotation as csAnnotation } from '@cornerstonejs/tools';

/**
 * Minimum viewport surface needed for hit-testing. Both stack and volume
 * viewports satisfy this; the function doesn't care which.
 *
 * `canvasToWorld` and `id` are required by the labelmap hit-test (Phase
 * 3.5c-canvas-labelmap) — the contour hit-test only reads `worldToCanvas`
 * and `getCurrentImageId`, so they stay optional for callers that only
 * need contour detection.
 */
export interface HitTestViewport {
  id?: string;
  getCurrentImageId?: () => string | null | undefined;
  worldToCanvas?: (point: [number, number, number]) => [number, number] | null | undefined;
  canvasToWorld?: (point: [number, number]) => [number, number, number] | null | undefined;
}

/** Default click-radius in canvas pixels. The existing select code used 12. */
export const DEFAULT_HIT_RADIUS_PX = 12;

/**
 * Find the contour annotation closest to a canvas point. Returns the
 * annotationUID (or null) and the distance for callers that want to
 * tie-break or implement a hover-on-near vs select-on-touch threshold.
 *
 * Filters annotations to those `referencedImageId === viewport.getCurrentImageId()`
 * — the existing per-slice scoping per audit doc §3 ("Annotations are
 * keyed by referencedImageId, not by viewport"). Cross-series annotations
 * (rendered via PolySeg projection) don't have a referencedImageId on the
 * current slice, so they're naturally excluded — which is correct for
 * hit-testing, since the click/hover point lives in the current slice's
 * canvas space.
 */
export function findContourAtCanvasPoint(
  viewport: HitTestViewport | null | undefined,
  canvasPoint: [number, number],
  options: { hitRadiusPx?: number } = {},
): { annotationUID: string; distance: number } | null {
  if (!viewport) return null;
  const currentImageId = viewport.getCurrentImageId?.();
  if (!currentImageId || typeof viewport.worldToCanvas !== 'function') return null;

  const radius = options.hitRadiusPx ?? DEFAULT_HIT_RADIUS_PX;

  let nearest: { annotationUID: string; distance: number } | null = null;
  for (const annotation of csAnnotation.state.getAllAnnotations()) {
    const referencedImageId = annotation?.metadata?.referencedImageId;
    const polyline = annotation?.data?.contour?.polyline;
    if (referencedImageId !== currentImageId || !Array.isArray(polyline) || polyline.length < 2) {
      continue;
    }
    const annotationUID = annotation?.annotationUID;
    if (!annotationUID) continue;

    const canvasPoints: Array<[number, number]> = [];
    for (const point of polyline) {
      if (!Array.isArray(point) || point.length < 3) continue;
      const projected = viewport.worldToCanvas?.([
        Number(point[0]),
        Number(point[1]),
        Number(point[2]),
      ]);
      if (Array.isArray(projected) && projected.length >= 2) {
        canvasPoints.push([projected[0], projected[1]]);
      }
    }
    if (canvasPoints.length < 2) continue;

    let minDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < canvasPoints.length; i++) {
      const a = canvasPoints[i];
      const b = canvasPoints[(i + 1) % canvasPoints.length];
      minDistance = Math.min(minDistance, distanceToSegment(canvasPoint, a, b));
    }

    if (minDistance <= radius && (!nearest || minDistance < nearest.distance)) {
      nearest = { annotationUID, distance: minDistance };
    }
  }

  return nearest;
}

/** Pixel-space distance from a point to a line segment AB. */
export function distanceToSegment(
  point: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const abX = b[0] - a[0];
  const abY = b[1] - a[1];
  const apX = point[0] - a[0];
  const apY = point[1] - a[1];
  const lengthSquared = abX * abX + abY * abY;
  if (lengthSquared === 0) {
    return Math.hypot(apX, apY);
  }
  const t = Math.max(0, Math.min(1, (apX * abX + apY * abY) / lengthSquared));
  const closestX = a[0] + abX * t;
  const closestY = a[1] + abY * t;
  return Math.hypot(point[0] - closestX, point[1] - closestY);
}
