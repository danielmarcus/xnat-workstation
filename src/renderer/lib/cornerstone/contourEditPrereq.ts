/**
 * Contour-fill enablement (signal 30) — two dependency-light helpers that make the
 * `LabelmapEditWithContour` ("Contour Fill") tool both DRAW and UNDO correctly.
 *
 * Why this is its own module: it must be importable from `unifiedToolService` (tool
 * activation), and `unifiedToolService` is in turn imported by widely-used modules.
 * Folding this into `unifiedSegService` would drag that service's
 * `@cornerstonejs/polymorphic-segmentation` dependency — whose top-level worker init
 * throws under the unit-test (vitest) environment — into every consumer of
 * `unifiedToolService`. This module imports ONLY `@cornerstonejs/core` +
 * `@cornerstonejs/tools`, so the tool service stays polyseg-free.
 *
 * (1) ensureContourEditPrereq — `ContourSegmentationBaseTool.createAnnotation` THROWS
 *     ("A contour segmentation must be active") unless the active labelmap already
 *     carries a Contour representation on the drawing viewport, so the gesture is a
 *     swallowed no-op. The tool adds it reactively (TOOLGROUP_VIEWPORT_ADDED /
 *     SEGMENTATION_MODIFIED), but neither fires when the tool is selected with the
 *     viewport + labelmap already present. We add it here, at activation time.
 *
 * (2) installContourFillUndo — Cornerstone's fill helper (`viewportContoursToLabelmap`)
 *     writes the voxels then only fires SEGMENTATION_DATA_MODIFIED; it never finalizes
 *     a history memo, so the fill is absent from the undo ring (signal 30's "undo
 *     reverts the fill as ONE entry" fails). We bridge that gap at the app boundary:
 *     snapshot the active labelmap before the gesture (on ANNOTATION_ADDED, pre-fill)
 *     and after it (on ANNOTATION_COMPLETED, deferred past the tool's synchronous fill
 *     listener), then push ONE custom memo whose restoreMemo swaps the two snapshots.
 *     A full-array snapshot (vs. Cornerstone's RLE-delta memo) is used for simplicity
 *     and correctness — the fill writes through a preview voxel manager we don't own,
 *     so the delta path isn't available to us.
 */
import { eventTarget, cache, utilities as csUtilities } from '@cornerstonejs/core';
import { segmentation as csSegmentation, Enums as ToolEnums } from '@cornerstonejs/tools';

const CONTOUR_FILL_TOOL_NAME = 'LabelMapEditWithContour';

/**
 * Ensure the active segmentation on each viewport carries a Contour representation,
 * so the Contour Fill tool can draw (and then rasterize into the labelmap).
 * Idempotent: a segmentation that already has a Contour representation is skipped.
 * Also installs the undo bridge on first use.
 */
export function ensureContourEditPrereq(viewportIds: string[]): void {
  installContourFillUndo();
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

interface VolumeVoxelAccess {
  getCompleteScalarDataArray?: () => ArrayLike<number> & { slice: () => ArrayLike<number> };
  setCompleteScalarDataArray?: (data: ArrayLike<number>) => void;
}

/** The active labelmap's volume voxel manager for a segmentation (null if not a volume labelmap). */
function labelmapVoxelManager(segmentationId: string): VolumeVoxelAccess | null {
  const seg = csSegmentation.state.getSegmentation(segmentationId) as
    | { representationData?: { Labelmap?: { volumeId?: string } } }
    | undefined;
  const volumeId = seg?.representationData?.Labelmap?.volumeId;
  if (!volumeId) return null;
  const vol = cache.getVolume(volumeId) as { voxelManager?: VolumeVoxelAccess } | undefined;
  return vol?.voxelManager ?? null;
}

/** Snapshot of the labelmap captured at the start of a contour-fill gesture. */
let pendingSnapshot: { segmentationId: string; before: ArrayLike<number> } | null = null;
let undoInstalled = false;

function onContourAnnotationAdded(evt: Event): void {
  const annotation = (evt as CustomEvent).detail?.annotation;
  if (annotation?.metadata?.toolName !== CONTOUR_FILL_TOOL_NAME) return;
  const segmentationId = annotation?.data?.segmentation?.segmentationId;
  if (!segmentationId) return;
  // Pre-fill: the fill only happens on ANNOTATION_COMPLETED, so the labelmap here is
  // still the "before" state.
  const before = labelmapVoxelManager(segmentationId)?.getCompleteScalarDataArray?.();
  pendingSnapshot = before ? { segmentationId, before: before.slice() } : null;
}

function onContourAnnotationCompleted(evt: Event): void {
  const annotation = (evt as CustomEvent).detail?.annotation;
  if (annotation?.metadata?.toolName !== CONTOUR_FILL_TOOL_NAME) return;
  const captured = pendingSnapshot;
  pendingSnapshot = null;
  if (!captured) return;
  // Defer past the tool's synchronous fill listener (registered on tool-active, so it
  // runs before this deferred callback), then capture the "after" state + push a memo.
  setTimeout(() => {
    const voxels = labelmapVoxelManager(captured.segmentationId);
    const after = voxels?.getCompleteScalarDataArray?.();
    if (!after) return;
    let changed = after.length !== captured.before.length;
    for (let i = 0; !changed && i < after.length; i++) {
      if (after[i] !== captured.before[i]) changed = true;
    }
    if (!changed) return; // nothing rasterized — no undo entry
    const beforeCopy = captured.before;
    const afterCopy = after.slice();
    const { segmentationId } = captured;
    const ring = (csUtilities as unknown as {
      HistoryMemo?: { DefaultHistoryMemo?: { push?: (memo: unknown) => void } };
    }).HistoryMemo?.DefaultHistoryMemo;
    ring?.push?.({
      id: csUtilities.uuidv4(),
      operationType: 'labelmap',
      segmentationId,
      // HistoryMemo calls restoreMemo(true) on undo, restoreMemo(false) on redo.
      restoreMemo: (isUndo: boolean) => {
        const vm = labelmapVoxelManager(segmentationId);
        if (!vm?.setCompleteScalarDataArray) return;
        vm.setCompleteScalarDataArray(isUndo === false ? afterCopy : beforeCopy);
        csSegmentation.triggerSegmentationEvents.triggerSegmentationDataModified(segmentationId);
      },
    });
  }, 0);
}

/**
 * Install the contour-fill undo bridge (idempotent). Registers ANNOTATION_ADDED /
 * ANNOTATION_COMPLETED listeners that capture before/after labelmap snapshots and push
 * a single history memo per fill. Long-lived (the tool group + history are long-lived).
 */
export function installContourFillUndo(): void {
  if (undoInstalled) return;
  undoInstalled = true;
  eventTarget.addEventListener(ToolEnums.Events.ANNOTATION_ADDED, onContourAnnotationAdded);
  eventTarget.addEventListener(ToolEnums.Events.ANNOTATION_COMPLETED, onContourAnnotationCompleted);
}
