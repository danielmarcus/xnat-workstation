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
import { segmentation as csSegmentation, annotation as csAnnotation, Enums as ToolEnums } from '@cornerstonejs/tools';

const CONTOUR_FILL_TOOL_NAME = 'LabelMapEditWithContour';

/**
 * Ensure the active segmentation on each viewport carries a Contour representation,
 * so the Contour Fill tool can draw (and then rasterize into the labelmap).
 * Idempotent: a segmentation that already has a Contour representation is skipped.
 * Also installs the undo bridge on first use.
 */
export function ensureContourEditPrereq(viewportIds: string[]): void {
  installContourFillUndo();
  installObliqueSafeContourFill();
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

// ─── Oblique-safe contour-fill rasterizer (signal 30, oblique fix) ───────────────
//
// Cornerstone's own LabelMapEditWithContour rasterizes the drawn contour into the
// labelmap in WORLD space (BrushTool.viewportContoursToLabelmap → isPointInsidePolyline3D
// → projectTo2D), which only works when the polyline lies in a plane perpendicular to a
// world axis (true axial/sagittal/coronal). On an OBLIQUE acquisition plane no world axis
// is constant, so projectTo2D throws "Cannot find a shared dimension index … oblique
// plane" and nothing fills. We rasterize in INDEX (IJK) space instead: an acquisition-
// plane contour is a constant-slice plane of the labelmap volume regardless of its world
// orientation, so a 2-D point-in-polygon fill on that slice is well-defined for axial AND
// oblique. Our listener runs BEFORE Cornerstone's (installed earlier in setActiveTool) and
// consumes the contour, so the world-space rasterizer never sees it and never throws.

function pointInPolygon2D(x: number, y: number, poly: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Rasterize a world-space contour polyline into the active labelmap in INDEX space.
 * Returns the number of voxels written (0 if it couldn't run). Oblique-safe.
 */
function rasterizeContourFill(segmentationId: string, polyline: number[][]): number {
  if (!Array.isArray(polyline) || polyline.length < 3) return 0;
  const seg = csSegmentation.state.getSegmentation(segmentationId) as
    | { representationData?: { Labelmap?: { volumeId?: string } } }
    | undefined;
  const volumeId = seg?.representationData?.Labelmap?.volumeId;
  if (!volumeId) return 0;
  const vol = cache.getVolume(volumeId) as
    | { imageData?: unknown; voxelManager?: { setAtIJK?: (i: number, j: number, k: number, v: number) => void }; dimensions?: number[] }
    | undefined;
  const imageData = vol?.imageData;
  const voxelManager = vol?.voxelManager;
  const dimensions = vol?.dimensions;
  if (!imageData || !voxelManager?.setAtIJK || !dimensions) return 0;

  let activeIndex = 1;
  try {
    activeIndex = csSegmentation.segmentIndex.getActiveSegmentIndex(segmentationId) || 1;
  } catch {
    /* default 1 */
  }

  // World polyline → fractional IJK in the labelmap volume.
  const toIndex = (csUtilities as unknown as { transformWorldToIndex: (d: unknown, w: number[]) => number[] }).transformWorldToIndex;
  const polyIJK = polyline.map((p) => {
    const idx = toIndex(imageData, p);
    return [idx[0], idx[1], idx[2]];
  });

  // The slice axis is the IJK dimension with the smallest spread (constant across the
  // planar contour); the other two span the in-plane polygon.
  const range = (d: number) => {
    let mn = Infinity;
    let mx = -Infinity;
    for (const p of polyIJK) {
      mn = Math.min(mn, p[d]);
      mx = Math.max(mx, p[d]);
    }
    return mx - mn;
  };
  let sliceDim = 0;
  if (range(1) < range(sliceDim)) sliceDim = 1;
  if (range(2) < range(sliceDim)) sliceDim = 2;
  const d1 = (sliceDim + 1) % 3;
  const d2 = (sliceDim + 2) % 3;
  const sliceIndex = Math.round(polyIJK.reduce((s, p) => s + p[sliceDim], 0) / polyIJK.length);
  if (sliceIndex < 0 || sliceIndex >= dimensions[sliceDim]) return 0;

  const poly2D = polyIJK.map((p) => [p[d1], p[d2]]);
  let aMin = Infinity;
  let aMax = -Infinity;
  let bMin = Infinity;
  let bMax = -Infinity;
  for (const p of poly2D) {
    aMin = Math.min(aMin, p[0]);
    aMax = Math.max(aMax, p[0]);
    bMin = Math.min(bMin, p[1]);
    bMax = Math.max(bMax, p[1]);
  }
  aMin = Math.max(0, Math.floor(aMin));
  aMax = Math.min(dimensions[d1] - 1, Math.ceil(aMax));
  bMin = Math.max(0, Math.floor(bMin));
  bMax = Math.min(dimensions[d2] - 1, Math.ceil(bMax));

  let written = 0;
  const ijk = [0, 0, 0];
  ijk[sliceDim] = sliceIndex;
  for (let a = aMin; a <= aMax; a++) {
    for (let b = bMin; b <= bMax; b++) {
      if (pointInPolygon2D(a, b, poly2D)) {
        ijk[d1] = a;
        ijk[d2] = b;
        voxelManager.setAtIJK(ijk[0], ijk[1], ijk[2], activeIndex);
        written++;
      }
    }
  }
  if (written > 0) {
    try {
      csSegmentation.triggerSegmentationEvents.triggerSegmentationDataModified(segmentationId);
    } catch {
      /* best-effort render refresh */
    }
  }
  return written;
}

function onContourFillCompleted(evt: Event): void {
  const annotation = (evt as CustomEvent<{ annotation?: unknown }>).detail?.annotation as
    | { annotationUID?: string; metadata?: { toolName?: string }; data?: { contour?: { polyline?: number[][] }; segmentation?: { segmentationId?: string } } }
    | undefined;
  if (annotation?.metadata?.toolName !== CONTOUR_FILL_TOOL_NAME) return;
  const segmentationId = annotation?.data?.segmentation?.segmentationId;
  const polyline = annotation?.data?.contour?.polyline;
  if (!segmentationId || !Array.isArray(polyline)) return;
  // Rasterize ourselves (index-space, oblique-safe)…
  rasterizeContourFill(segmentationId, polyline);
  // …then consume the contour so Cornerstone's own world-space rasterizer (registered
  // AFTER us) finds nothing to project — no oblique-plane throw, no double-fill.
  try {
    csAnnotation.state.removeAnnotation?.(annotation.annotationUID as string);
  } catch {
    /* ignore */
  }
}

let obliqueFillInstalled = false;

/**
 * Install the oblique-safe contour-fill rasterizer (idempotent). Registered from
 * ensureContourEditPrereq — which runs in setActiveTool BEFORE the tool's own
 * onSetToolActive registers Cornerstone's listener — so this listener fires first and
 * consumes the contour before the world-space rasterizer can throw on an oblique plane.
 */
export function installObliqueSafeContourFill(): void {
  if (obliqueFillInstalled) return;
  obliqueFillInstalled = true;
  eventTarget.addEventListener(ToolEnums.Events.ANNOTATION_COMPLETED, onContourFillCompleted);
}
