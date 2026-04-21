/**
 * Source Image Tracking — typed lifecycle for "which image IDs was this
 * segmentation derived from?" attribution.
 *
 * Used during DICOM SEG / RTSTRUCT export to attribute per-frame references
 * back to the source image series.
 *
 * Replaces the prior module-level `sourceImageIdsMap` in `segmentationService`
 * that had 17 scattered read/write sites and 6 manual `.delete()` cleanup
 * calls. This module centralizes ownership and adds an automatic cleanup
 * listener on Cornerstone's `SEGMENTATION_REMOVED` event so entries for
 * real Cornerstone-backed segmentations are reaped even if a caller forgets
 * to call `clearSourceImageIds`.
 *
 * NOTE: Some IDs tracked here are NOT real Cornerstone segmentations
 * (e.g. multi-layer group IDs that are internal to segmentationService).
 * For those, explicit `clearSourceImageIds` is still required — the event
 * listener never fires for them.
 */
import { eventTarget } from '@cornerstonejs/core';
import { Enums as ToolEnums } from '@cornerstonejs/tools';

const sourceImageIdsMap = new Map<string, readonly string[]>();

// ─── Public API ───────────────────────────────────────────────────

/**
 * Record the source image IDs a segmentation was derived from. Replaces any
 * prior entry for this segmentationId. Array is defensively copied.
 */
export function setSourceImageIds(
  segmentationId: string,
  imageIds: readonly string[],
): void {
  if (!segmentationId) return;
  sourceImageIdsMap.set(segmentationId, [...imageIds]);
}

/**
 * Get the tracked source image IDs for a segmentation, or null if none
 * are tracked. Returns a read-only reference — callers must not mutate.
 */
export function getSourceImageIds(segmentationId: string): readonly string[] | null {
  if (!segmentationId) return null;
  return sourceImageIdsMap.get(segmentationId) ?? null;
}

/**
 * Return a mutable copy of the tracked source image IDs, or an empty
 * array if none are tracked. Convenience for callers that need to extend
 * or filter the list locally without mutating the tracked state.
 */
export function getSourceImageIdsCopy(segmentationId: string): string[] {
  const ids = sourceImageIdsMap.get(segmentationId);
  return ids ? [...ids] : [];
}

/**
 * Drop tracking for a segmentation. Idempotent. Safe to call for IDs that
 * were never tracked.
 */
export function clearSourceImageIds(segmentationId: string): void {
  if (!segmentationId) return;
  sourceImageIdsMap.delete(segmentationId);
}

/**
 * Drop all tracking state. Intended for service dispose().
 */
export function clearAll(): void {
  sourceImageIdsMap.clear();
}

// ─── Auto-cleanup listener ────────────────────────────────────────

let initialized = false;
let onSegmentationRemoved: EventListener | null = null;

/**
 * Subscribe to Cornerstone's SEGMENTATION_REMOVED event so tracked entries
 * for real segmentations are automatically reaped. Call once during
 * service initialization. Idempotent.
 *
 * This is a safety net — callers that manage lifecycles explicitly (e.g.
 * non-Cornerstone internal IDs like multi-layer group IDs) still need to
 * call `clearSourceImageIds` themselves; the event will not fire for
 * those.
 */
export function initialize(): void {
  if (initialized) return;

  onSegmentationRemoved = (evt: Event) => {
    const detail = (evt as CustomEvent<{ segmentationId?: string }>).detail;
    const segmentationId = detail?.segmentationId;
    if (typeof segmentationId === 'string' && segmentationId.length > 0) {
      sourceImageIdsMap.delete(segmentationId);
    }
  };

  eventTarget.addEventListener(
    ToolEnums.Events.SEGMENTATION_REMOVED,
    onSegmentationRemoved,
  );
  initialized = true;
}

/**
 * Remove the auto-cleanup listener and clear all tracked state.
 */
export function dispose(): void {
  if (initialized && onSegmentationRemoved) {
    eventTarget.removeEventListener(
      ToolEnums.Events.SEGMENTATION_REMOVED,
      onSegmentationRemoved,
    );
  }
  onSegmentationRemoved = null;
  initialized = false;
  sourceImageIdsMap.clear();
}
