/**
 * Canvas → row hover wiring (Phase 3.5c-canvas, contour direction).
 *
 * Reciprocal of Phase 3.5c-row's row→canvas sync. When the user moves the
 * cursor over a contour annotation on a viewport, the matching member row
 * in the list panel highlights. Implemented via:
 *
 *   1. mousemove on the viewport element → throttled via requestAnimationFrame.
 *   2. Hit-test the cursor against current-slice contours
 *      (`contourHitTest.findContourAtCanvasPoint`).
 *   3. Resolve the hit annotationUID → memberId via the bridge
 *      (`annotation.data.segmentation.{segmentationId, segmentIndex}`
 *      → containerId → member with matching segmentIndex).
 *   4. Push the resolved memberId (or null) into
 *      `useContainerSelectionStore.setHover`.
 *
 * mouseleave on the viewport clears hover.
 *
 * The labelmap canvas → row direction (cursor over a labelmap voxel →
 * resolve the segment index at that voxel) is staged separately as
 * Phase 3.5c-canvas-labelmap because it needs Cornerstone's voxel-sample
 * helpers which aren't a stable public API yet.
 */
import { annotation as csAnnotation } from '@cornerstonejs/tools';
import { useContainerSelectionStore } from '../../stores/containerSelectionStore';
import * as containerBridge from './containerBridge';
import { findContourAtCanvasPoint, type HitTestViewport } from './contourHitTest';
import { findLabelmapSegmentAtWorldPoint } from './labelmapHitTest';

/**
 * Resolve a (segmentationId, segmentIndex) pair to a Member.id via the
 * bridge. Returns null when the segmentation isn't bridge-tracked or the
 * container has no matching member.
 *
 * Shared by both the contour direction (annotation → segmentation/index
 * via `data.segmentation`) and the labelmap direction (worldPoint sample
 * via `getSegmentIndexAtWorldPoint`).
 */
export function resolveMemberIdFromSegment(
  segmentationId: string,
  segmentIndex: number,
): string | null {
  if (!segmentationId || !Number.isInteger(segmentIndex) || segmentIndex <= 0) {
    return null;
  }
  const containerId = containerBridge.getContainerId(segmentationId);
  if (!containerId) return null;
  const container = containerBridge.getContainer(containerId);
  return (
    container?.members.find((m) => m.segmentIndex === segmentIndex)?.id
    ?? null
  );
}

/**
 * Resolve a contour annotation UID to a Member.id via the bridge.
 *
 * Cornerstone contour-segmentation annotations carry
 * `data.segmentation.{segmentationId, segmentIndex}` — that's the link
 * back to a segment, which `resolveMemberIdFromSegment` maps to a
 * (container, member) pair. Returns null when the annotation isn't a
 * contour-segmentation, isn't registered in the bridge, or has an
 * unrecognized segmentIndex.
 */
export function resolveMemberIdFromAnnotation(annotationUID: string): string | null {
  if (!annotationUID) return null;
  let ann: { data?: { segmentation?: { segmentationId?: string; segmentIndex?: number } } } | undefined;
  try {
    ann = csAnnotation.state.getAnnotation?.(annotationUID) as typeof ann;
  } catch {
    return null;
  }
  const segmentationId = ann?.data?.segmentation?.segmentationId;
  const segmentIndex = ann?.data?.segmentation?.segmentIndex;
  if (typeof segmentationId !== 'string' || !Number.isInteger(segmentIndex) || segmentIndex! <= 0) {
    return null;
  }
  return resolveMemberIdFromSegment(segmentationId, segmentIndex!);
}

/**
 * Wire mousemove + mouseleave hover detection on a single viewport
 * element. Returns a disposer that removes the listeners + cancels the
 * pending rAF.
 *
 * The viewport passed in is the live Cornerstone viewport object — its
 * `getCurrentImageId` and `worldToCanvas` are read on every mousemove
 * (intentional: the current slice can change without the wiring being
 * torn down).
 */
export function wireContourHoverDetection(
  element: HTMLElement,
  resolveViewport: () => HitTestViewport | null,
): () => void {
  let rafId: number | null = null;
  let lastClientX = 0;
  let lastClientY = 0;

  const onMouseMove = (event: MouseEvent) => {
    lastClientX = event.clientX;
    lastClientY = event.clientY;
    if (rafId !== null) return; // already scheduled — coalesce.
    rafId = requestAnimationFrame(() => {
      rafId = null;
      runHitTest(element, resolveViewport, lastClientX, lastClientY);
    });
  };

  const onMouseLeave = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    // Clearing on leave is unconditional so we don't strand a hover
    // highlight after disabling the flag. Cheap when already null.
    useContainerSelectionStore.getState().setHover(null);
  };

  element.addEventListener('mousemove', onMouseMove);
  element.addEventListener('mouseleave', onMouseLeave);

  return () => {
    element.removeEventListener('mousemove', onMouseMove);
    element.removeEventListener('mouseleave', onMouseLeave);
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };
}

// ─── Internals ──────────────────────────────────────────────────

/**
 * Run a single hit-test pass for the latest cursor position. Tries
 * contour first; falls back to labelmap if the contour test misses.
 * Pushes the resolved memberId (or null) into the selection store.
 * Pulled out of the rAF callback so tests can drive it deterministically.
 *
 * Two-stage strategy:
 *
 *   1. Contour hit-test — fast (canvas-space distance to polylines on
 *      the current slice) and matches the existing click-to-select
 *      threshold (12px).
 *   2. Labelmap hit-test — only if (1) misses. Converts canvas → world
 *      via `viewport.canvasToWorld`, then calls
 *      `getSegmentIndexAtWorldPoint` per attached labelmap segmentation.
 *      Cornerstone abstracts the stack/volume sampling internally.
 *
 * Contour-first matches the user mental model: when a contour outline
 * passes over a filled labelmap region, hovering near the outline
 * highlights the contour-side member (which is what they're aiming at);
 * only when the cursor is in the interior of the labelmap fill (away
 * from any contour edge) does the labelmap detection win.
 */
export function runHitTest(
  element: HTMLElement,
  resolveViewport: () => HitTestViewport | null,
  clientX: number,
  clientY: number,
): void {
  const viewport = resolveViewport();
  if (!viewport) {
    useContainerSelectionStore.getState().setHover(null);
    return;
  }
  const rect = element.getBoundingClientRect();
  const canvasPoint: [number, number] = [clientX - rect.left, clientY - rect.top];

  // 1. Contour hit-test (canvas-space).
  const contourHit = findContourAtCanvasPoint(viewport, canvasPoint);
  if (contourHit) {
    const memberId = resolveMemberIdFromAnnotation(contourHit.annotationUID);
    useContainerSelectionStore.getState().setHover(memberId);
    return;
  }

  // 2. Labelmap fallback (world-space sample). Skip when the viewport
  //    can't translate canvas→world, or when no viewport id is set
  //    (labelmap enumeration needs viewportId).
  const cw = viewport.canvasToWorld;
  if (typeof cw !== 'function' || !viewport.id) {
    useContainerSelectionStore.getState().setHover(null);
    return;
  }
  let worldPoint: [number, number, number] | null = null;
  try {
    const w = cw(canvasPoint);
    if (Array.isArray(w) && w.length >= 3) {
      worldPoint = [Number(w[0]), Number(w[1]), Number(w[2])];
    }
  } catch {
    worldPoint = null;
  }
  if (!worldPoint) {
    useContainerSelectionStore.getState().setHover(null);
    return;
  }
  const labelmapHit = findLabelmapSegmentAtWorldPoint(viewport, worldPoint);
  if (!labelmapHit) {
    useContainerSelectionStore.getState().setHover(null);
    return;
  }
  const memberId = resolveMemberIdFromSegment(
    labelmapHit.segmentationId,
    labelmapHit.segmentIndex,
  );
  useContainerSelectionStore.getState().setHover(memberId);
}
