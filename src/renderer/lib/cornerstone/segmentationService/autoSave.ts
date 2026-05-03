/**
 * Auto-save subsystem for the segmentation service.
 *
 * Owns:
 *   - dirty-tracking suppression counter (and time-based suppression window),
 *   - load-in-progress / manual-save flags that gate auto-save,
 *   - debounced auto-save timer + the actual `performAutoSave()` invocation,
 *   - debounced labelmap-interpolation timer + orchestration,
 *   - the two event handlers (`onSegmentationDataModified`, `onAnnotationAutoSave`)
 *     wired by the orchestrator.
 *
 * Extracted from segmentationService.ts (Phase 0.5.C).
 *
 * Service-layer dependencies are injected via `wireAutoSave()` to avoid
 * a circular import. The orchestrator calls it once during
 * `segmentationService.initialize()`.
 *
 * Public API:
 *   - State manipulation:
 *       incrementSuppression / decrementSuppression / runWithDirtyTrackingSuppressed
 *       setDirtyTrackingSuppressedFor(segId, ms) / isDirtyTrackingSuppressed(segId?)
 *       clearAllSuppressionDeadlines (test helper)
 *       beginSegLoad / endSegLoad
 *       beginManualSave / endManualSave
 *   - Save lifecycle:
 *       scheduleAutoSave / cancelAutoSave / performAutoSave
 *   - Event handlers (wired by orchestrator):
 *       onSegmentationDataModified / onAnnotationAutoSave
 *   - Misc:
 *       formatTimestamp (auto-save filename helper)
 */
import { getEnabledElementByViewportId } from '@cornerstonejs/core';
import {
  segmentation as csSegmentation,
  utilities as csToolUtilities,
} from '@cornerstonejs/tools';
import { useConnectionStore } from '../../../stores/connectionStore';
import { usePreferencesStore } from '../../../stores/preferencesStore';
import { useSegmentationManagerStore } from '../../../stores/segmentationManagerStore';
import { useSegmentationStore } from '../../../stores/segmentationStore';
import { useViewerStore } from '../../../stores/viewerStore';
import { backupService } from '../../backup/backupService';
import * as mlg from '../multiLayerGroup';
import {
  hasSegmentPixelsOnSlice,
  interpolateMorphological,
  interpolateNearestSlice,
  interpolateLinearBlend,
  interpolateSDF,
} from './interpolation';
import * as containerBridge from '../containerBridge';
import * as transport from './transport';

// ─── Module-state ────────────────────────────────────────────────

let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
const AUTO_SAVE_DELAY = 10_000; // 10 seconds after last edit
const LABELMAP_INTERPOLATION_DELAY = 250;

/**
 * Reference counter for suppressing _markDirty() and scheduleAutoSave() calls.
 * Incremented during load operations (addToViewport, loadDicomSeg) where Cornerstone
 * fires SEGMENTATION_DATA_MODIFIED events internally during initialization,
 * which would falsely mark the state as dirty.
 * Using a counter instead of a boolean prevents race conditions when
 * multiple async load operations overlap (e.g., loadDicomSeg + addToViewport).
 *
 * The counter is the *blanket* suppression: when > 0, ALL events are suppressed.
 * Used by `runWithDirtyTrackingSuppressed` to scope a synchronous block.
 */
let suppressDirtyTrackingCount = 0;

/**
 * Per-segmentation deadline map for time-based suppression.
 *
 * Operations like `addToViewport` / `removeSegmentationsFromViewport` /
 * `restorePresentationState` schedule async `SEGMENTATION_DATA_MODIFIED` events
 * that fire AFTER the operation returns. To swallow only those, we record an
 * expiry deadline keyed on the segmentationId being mutated. The handler
 * checks `isDirtyTrackingSuppressed(detail.segmentationId)` and only the
 * matching segmentation's events get dropped — unrelated user edits on other
 * segmentations during the same window are NOT swallowed.
 *
 * Replaces an earlier global wall-clock window
 * (`suppressDirtyTrackingUntilMs`) which dropped legitimate edits when one
 * operation's grace period happened to span another segmentation's user
 * action — most visibly in tests, where a layout transition + segmentation
 * create + brush stroke all completed inside a single 1500ms window.
 */
const suppressedSegmentationsUntilMs = new Map<string, number>();

/**
 * Reference counter for SEG/RTSTRUCT load operations in progress.
 * When > 0, performAutoSave() is blocked to prevent exporting incomplete
 * segmentation data (which causes "Error inserting pixels in PixelData").
 * Incremented by beginSegLoad(), decremented by endSegLoad().
 */
let loadInProgressCount = 0;

/**
 * Flag indicating a manual save/export is in progress.
 * When true, performAutoSave() is blocked and onSegmentationDataModified()
 * won't schedule auto-save. This prevents a race where a brush stroke during
 * the async export window (between cancelAutoSave and export completion)
 * triggers a competing auto-save that writes partial data.
 * Set via beginManualSave()/endManualSave() from SegmentationPanel.
 */
let manualSaveInProgress = false;
let backupInProgress = false;
let labelmapInterpolationTimer: ReturnType<typeof setTimeout> | null = null;
let labelmapInterpolationInProgress = false;
let pendingLabelmapInterpolation: { segmentationId: string; segmentIndex: number | null } | null = null;

// ─── Dependency injection ────────────────────────────────────────

export interface AutoSaveDeps {
  /** Detect representation type for an active segmentation. */
  getSegmentationType: (segmentationId: string) => 'labelmap' | 'contour' | 'both';
  /** True if a segment is locked; auto-interpolation skips locked segments. */
  getSegmentLocked: (segmentationId: string, segmentIndex: number) => boolean;
  /**
   * Returns the cached labelmap slice arrays for a segmentation. The
   * orchestrator owns this helper because it has cross-cutting use; auto-save
   * just needs to read the slices.
   */
  getCachedLabelmapSliceArrays: (segmentationId: string) => Promise<{
    sliceArrays: ArrayLike<number>[];
    width: number;
    height: number;
  } | null>;
}

let deps: AutoSaveDeps = {
  getSegmentationType: () => 'labelmap',
  getSegmentLocked: () => false,
  getCachedLabelmapSliceArrays: async () => null,
};

export function wireAutoSave(injected: AutoSaveDeps): void {
  deps = injected;
}

// ─── Suppression API ─────────────────────────────────────────────

/**
 * True if dirty tracking is currently suppressed.
 *
 * - Without `segmentationId`: returns true only when the blanket counter is
 *   active (`runWithDirtyTrackingSuppressed`). Used by paths that don't
 *   know which segmentation an event belongs to (e.g. `performAutoSave`,
 *   `performLabelmapInterpolation`).
 * - With `segmentationId`: also returns true when that specific
 *   segmentation has an active per-seg deadline. Used by event handlers
 *   that can attribute the event to a specific segmentation.
 *
 * The per-seg map is lazily cleaned up: an expired entry is deleted on the
 * first read after expiry, so the map size tracks "currently-suppressed
 * segmentations" without a separate sweep timer.
 */
export function isDirtyTrackingSuppressed(segmentationId?: string): boolean {
  if (suppressDirtyTrackingCount > 0) return true;
  if (!segmentationId) return false;
  const until = suppressedSegmentationsUntilMs.get(segmentationId);
  if (until === undefined) return false;
  if (until <= Date.now()) {
    suppressedSegmentationsUntilMs.delete(segmentationId);
    return false;
  }
  return true;
}

/**
 * Suppress dirty tracking for a specific segmentation for `ms` milliseconds.
 *
 * Use this around operations that trigger asynchronous
 * `SEGMENTATION_DATA_MODIFIED` events for `segmentationId` *after* the
 * mutating call returns (representation attach/detach, color/visibility
 * restore). Only events whose `evt.detail.segmentationId` matches the
 * suppressed id will be dropped — concurrent user edits on other
 * segmentations are unaffected.
 *
 * Calls extend the existing deadline (Math.max), never shrink it.
 */
export function setDirtyTrackingSuppressedFor(segmentationId: string, ms: number): void {
  if (!segmentationId || ms <= 0) return;
  const prev = suppressedSegmentationsUntilMs.get(segmentationId) ?? 0;
  suppressedSegmentationsUntilMs.set(segmentationId, Math.max(prev, Date.now() + ms));
}

/** Clear all per-segmentation suppression deadlines. Test/teardown helper. */
export function clearAllSuppressionDeadlines(): void {
  suppressedSegmentationsUntilMs.clear();
}

export function incrementSuppression(): void {
  suppressDirtyTrackingCount++;
}

export function decrementSuppression(): void {
  suppressDirtyTrackingCount--;
}

export function runWithDirtyTrackingSuppressed<T>(fn: () => T): T {
  incrementSuppression();
  try {
    return fn();
  } finally {
    decrementSuppression();
  }
}

// ─── Load / manual-save guards ───────────────────────────────────

export function beginSegLoad(): void {
  loadInProgressCount++;
}

export function endSegLoad(): void {
  loadInProgressCount = Math.max(0, loadInProgressCount - 1);
}

/**
 * Phase 4.5: read-only accessor consumed by `containerStoreSync.buildMember`
 * to choose `provenance: 'imported'` (vs. `'manual'`) for members
 * synthesized while a SEG / RTSTRUCT load is in flight. Per design §D7.2
 * the `'imported'` provenance is the default for content that came from
 * the transport layer.
 */
export function isSegLoadInProgress(): boolean {
  return loadInProgressCount > 0;
}

export function beginManualSave(): void {
  manualSaveInProgress = true;
  cancelAutoSave();
}

export function endManualSave(): void {
  manualSaveInProgress = false;
}

// ─── Auto-save scheduling ────────────────────────────────────────

export function cancelAutoSave(): void {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
}

export function scheduleAutoSave(): void {
  // Don't schedule auto-save while a manual save is in progress
  if (manualSaveInProgress) return;
  if (autoSaveTimer) clearTimeout(autoSaveTimer);

  // Read backup interval from preferences (fallback to AUTO_SAVE_DELAY)
  const backupPrefs = usePreferencesStore.getState().preferences.backup;
  const delayMs = backupPrefs.enabled
    ? backupPrefs.intervalSeconds * 1000
    : AUTO_SAVE_DELAY;

  autoSaveTimer = setTimeout(() => {
    void performAutoSave();
  }, delayMs);
}

/** Format current time as yyyymmddhhmmss for auto-save temp filenames. */
export function formatTimestamp(): string {
  const d = new Date();
  return d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0') +
    String(d.getHours()).padStart(2, '0') +
    String(d.getMinutes()).padStart(2, '0') +
    String(d.getSeconds()).padStart(2, '0');
}

export async function performAutoSave(force = false): Promise<boolean> {
  autoSaveTimer = null;
  const segStore = useSegmentationStore.getState();
  const backupPrefs = usePreferencesStore.getState().preferences.backup;

  // Check backup enabled (from preferences), or force flag (disconnect guard)
  if (!backupPrefs.enabled && !force) return false;

  // Skip if dirty tracking is suppressed (load/creation in progress)
  if (isDirtyTrackingSuppressed()) return false;

  // Skip if a SEG/RTSTRUCT load is in progress (prevents PixelData corruption)
  if (loadInProgressCount > 0) {
    console.log('[segmentationService] Auto-save skipped — SEG load in progress');
    return false;
  }

  // Skip if no actual unsaved changes
  if (!segStore.hasUnsavedChanges) return false;

  // Prevent re-entrancy (Cornerstone exports aren't thread-safe)
  if (backupInProgress) {
    console.log('[segmentationService] Auto-save skipped — backup already in progress');
    return false;
  }

  const xnatContext = useViewerStore.getState().xnatContext;
  if (!xnatContext) return false; // No session context

  segStore._setAutoSaveStatus('saving');
  backupInProgress = true;
  try {
    const serverUrl = useConnectionStore.getState().connection?.serverUrl ?? '';
    const backed = await backupService.backupAllDirtySegmentations(
      xnatContext.sessionId,
      serverUrl,
    );

    if (backed > 0) {
      segStore._setAutoSaveStatus('saved');
      console.log(`[segmentationService] Local backup: ${backed} segmentation(s) saved`);
      return true;
    } else {
      // No dirty segs with exportable content — return to idle
      segStore._setAutoSaveStatus('idle');
      return false;
    }
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes('No painted segment data') ||
      msg.includes('no segment-frame pairs') ||
      msg.includes('Error inserting pixels in PixelData')
    ) {
      console.log('[segmentationService] Auto-save skipped — no painted pixels yet');
      segStore._setAutoSaveStatus('idle');
      return false;
    }
    console.error('[segmentationService] Auto-save failed:', err);
    segStore._setAutoSaveStatus('error');
    return false;
  } finally {
    backupInProgress = false;
  }
}

// ─── Labelmap interpolation orchestration ────────────────────────

function scheduleLabelmapInterpolation(): void {
  if (labelmapInterpolationTimer) clearTimeout(labelmapInterpolationTimer);
  labelmapInterpolationTimer = setTimeout(() => {
    void performLabelmapInterpolation();
  }, LABELMAP_INTERPOLATION_DELAY);
}

async function performLabelmapInterpolation(): Promise<void> {
  labelmapInterpolationTimer = null;
  if (labelmapInterpolationInProgress) return;
  if (isDirtyTrackingSuppressed()) return;
  if (loadInProgressCount > 0) return;

  // Read interpolation settings from preferences store (canonical source)
  const prefState = usePreferencesStore.getState();
  const interpPrefs = prefState.preferences.interpolation;
  if (!interpPrefs.enabled) return;

  const segStore = useSegmentationStore.getState();
  const pending = pendingLabelmapInterpolation;
  pendingLabelmapInterpolation = null;
  let activeSegId = pending?.segmentationId ?? segStore.activeSegmentationId;
  if (!activeSegId) return;

  let segmentIndex = Number(pending?.segmentIndex ?? segStore.activeSegmentIndex);
  if (!Number.isInteger(segmentIndex) || segmentIndex <= 0) return;

  // Don't interpolate on a locked segment
  if (deps.getSegmentLocked(activeSegId, segmentIndex)) return;

  // For multi-layer groups, resolve to the sub-seg and use segment index 1
  let effectiveSegId = activeSegId;
  let effectiveSegIndex = segmentIndex;
  if (mlg.isMultiLayerGroup(activeSegId)) {
    const subSegId = mlg.resolveSubSegId(activeSegId, segmentIndex);
    if (!subSegId) return;
    effectiveSegId = subSegId;
    effectiveSegIndex = 1; // sub-segs are binary (0/1)
  }

  const segType = deps.getSegmentationType(effectiveSegId);
  if (segType === 'contour') return;

  const labelmapData = await deps.getCachedLabelmapSliceArrays(effectiveSegId);
  if (!labelmapData) return;
  const { sliceArrays, width, height } = labelmapData;
  if (sliceArrays.length < 3) return;

  const anchors: number[] = [];
  for (let i = 0; i < sliceArrays.length; i++) {
    if (hasSegmentPixelsOnSlice(sliceArrays[i], effectiveSegIndex)) {
      anchors.push(i);
    }
  }
  if (anchors.length < 2) return;

  labelmapInterpolationInProgress = true;
  const algorithm = interpPrefs.algorithm;
  const linearThreshold = interpPrefs.linearThreshold;

  try {
    const modifiedSlices = new Set<number>();
    const pixelsPerSlice = width * height;

    for (let i = 0; i < anchors.length - 1; i++) {
      const a = anchors[i];
      const b = anchors[i + 1];
      const gap = b - a - 1;
      if (gap <= 0) continue;

      for (let s = a + 1; s < b; s++) {
        const alpha = (s - a) / (b - a);
        const slice = sliceArrays[s] as any;

        // Dispatch to the selected algorithm
        let interpolated: Uint8Array;
        switch (algorithm) {
          case 'morphological':
            interpolated = interpolateMorphological(sliceArrays[a], sliceArrays[b], alpha, width, height, effectiveSegIndex);
            break;
          case 'nearestSlice':
            interpolated = interpolateNearestSlice(sliceArrays[a], sliceArrays[b], alpha, width, height, effectiveSegIndex);
            break;
          case 'linear':
            interpolated = interpolateLinearBlend(sliceArrays[a], sliceArrays[b], alpha, width, height, effectiveSegIndex, linearThreshold);
            break;
          case 'sdf':
          default:
            interpolated = interpolateSDF(sliceArrays[a], sliceArrays[b], alpha, width, height, effectiveSegIndex);
            break;
        }

        // Apply interpolated result to the gap slice
        let changed = false;
        for (let p = 0; p < pixelsPerSlice; p++) {
          const currentValue = Number(slice[p]);
          // Skip pixels that belong to a different segment
          if (currentValue !== 0 && currentValue !== effectiveSegIndex) continue;
          // Fill empty pixels where the algorithm says there should be data
          if (interpolated[p] === effectiveSegIndex && currentValue === 0) {
            slice[p] = effectiveSegIndex;
            changed = true;
          }
        }

        if (changed) {
          modifiedSlices.add(s);
        }
      }
    }

    if (modifiedSlices.size === 0) return;

    csSegmentation.triggerSegmentationEvents.triggerSegmentationDataModified(
      effectiveSegId,
      Array.from(modifiedSlices).sort((x, y) => x - y),
      effectiveSegIndex,
    );
    const viewportIds = csSegmentation.state.getViewportIdsWithSegmentation(effectiveSegId);
    for (const viewportId of viewportIds) {
      csToolUtilities.segmentation.triggerSegmentationRender(viewportId);
      const enabledElement = getEnabledElementByViewportId(viewportId) as any;
      enabledElement?.viewport?.render?.();
    }
  } catch (err) {
    console.error('[segmentationService] Labelmap interpolation failed:', err);
  } finally {
    labelmapInterpolationInProgress = false;
  }
}

// ─── Event handlers (wired by orchestrator) ──────────────────────

/** Called when segmentation pixel data changes — debounces auto-save and marks dirty. */
export function onSegmentationDataModified(evt?: Event): void {
  const detail = (evt as CustomEvent | undefined)?.detail as
    | { segmentationId?: string; segmentIndex?: number }
    | undefined;
  // Resolve sub-seg ID to group ID early; suppression is recorded against
  // the GROUP id (the user-facing segmentationId), not the synthetic
  // sub-seg id Cornerstone fires the event for.
  let resolvedSegId = detail?.segmentationId ?? null;
  if (resolvedSegId) {
    const groupInfo = mlg.getGroupInfoForSubSeg(resolvedSegId);
    if (groupInfo) {
      resolvedSegId = groupInfo.groupId;
    }
  }
  // Pass the resolved id so the per-seg suppression check can match.
  // Falls back to the global blanket counter when the event has no id.
  if (!isDirtyTrackingSuppressed(resolvedSegId ?? undefined)) {

    if (detail?.segmentationId) {
      // Reuse the resolution we already did above so we don't double-look-up
      // multi-layer-group → sub-seg metadata.
      const groupInfo = mlg.getGroupInfoForSubSeg(detail.segmentationId);
      pendingLabelmapInterpolation = {
        segmentationId: resolvedSegId ?? detail.segmentationId,
        segmentIndex: groupInfo
          ? groupInfo.segmentIndex
          : (Number.isInteger(detail.segmentIndex) ? Number(detail.segmentIndex) : null),
      };
    }
    useSegmentationStore.getState()._markDirty();
    const dirtySegId =
      resolvedSegId
      ?? useSegmentationStore.getState().activeSegmentationId
      ?? null;
    if (dirtySegId) {
      useSegmentationManagerStore.getState().markDirty(dirtySegId);
    }
    scheduleAutoSave();
    if (!labelmapInterpolationInProgress) {
      scheduleLabelmapInterpolation();
    }

    // Phase 2.8b: also notify the per-container queue-next-save
    // coordinator when multi-viewport is enabled. Both pipelines run in
    // parallel during the transitional period — legacy autoSave handles
    // the actual backup; transport.ts records per-container dirty state
    // for the Phase 3 list panel D7.4 indicators (and lights up §E2
    // queue-next-save semantics once a SaveAdapter is installed).
    if (dirtySegId && usePreferencesStore.getState().preferences.multiViewport.enabled) {
      const containerId = containerBridge.getContainerId(dirtySegId);
      if (containerId) {
        transport.notifyDirty(containerId);
      }
    }
  }
}

/** Called when an annotation is completed/modified — triggers auto-save for contour segmentations. */
export function onAnnotationAutoSave(): void {
  // Only schedule if there's an active segmentation that has contour data
  const segStore = useSegmentationStore.getState();
  const activeSegId = segStore.activeSegmentationId;
  if (!activeSegId) return;
  const segType = deps.getSegmentationType(activeSegId);
  if (segType === 'contour' || segType === 'both') {
    if (!isDirtyTrackingSuppressed(activeSegId)) {
      segStore._markDirty();
      useSegmentationManagerStore.getState().markDirty(activeSegId);
      scheduleAutoSave();

      // Phase 2.8b: same per-container notification under the flag as
      // onSegmentationDataModified above — see comment there.
      if (usePreferencesStore.getState().preferences.multiViewport.enabled) {
        const containerId = containerBridge.getContainerId(activeSegId);
        if (containerId) {
          transport.notifyDirty(containerId);
        }
      }
    }
  }
}
