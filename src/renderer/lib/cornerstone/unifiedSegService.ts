/**
 * Unified Segmentation Service (Phase 1) — creates a labelmap segmentation as a
 * VOLUME labelmap derived directly from the shared source ImageVolume, and
 * attaches it to the unified (orthographic) viewports.
 *
 * Why a derived volume labelmap (not the stack-based `segmentationService`
 * path): the unified path is volume-default, and its MPR panels all render ONE
 * shared `ImageVolume`. A labelmap volume derived from that volume is, by
 * construction, geometrically aligned with it — so a brush stroke painted on any
 * one plane writes 3D voxels that render natively on every other plane (no
 * stack→volume conversion, which is unreliable for synthetic/offline labelmap
 * images). This is the minimal editing substrate for the Phase-1 signals; the
 * full multi-layer SEG model (`segmentationService`) is reconciled later.
 *
 * §2: lib/cornerstone may import Cornerstone directly.
 */
import { metaData, cache, utilities as csCoreUtilities } from '@cornerstonejs/core';
import {
  segmentation as csSegmentation,
  utilities as csToolUtilities,
} from '@cornerstonejs/tools';
import {
  SegmentBidirectionalTool,
  RectangleROIThresholdTool,
  annotation as csAnnotation,
} from '@cornerstonejs/tools';
import { viewportService } from './viewportService';
import type { ContainerSpatialId, ViewportSpatialId } from './spatialIdentity';
import * as mlg from './multiLayerGroup';
import { readSegmentVoxelGrid } from './segmentVoxelGrid';
import {
  copyVoxelRegion,
  pasteVoxelRegion,
  worldToIndex,
  type VoxelRegionClip,
  type Vec3,
} from './segmentationService/voxelClipboard';
import { sliceAxisFor } from './maskIslands';
import { clearMaskSelection, getMaskSelection, selectIslandsContaining } from './maskSelection';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { useViewerStore } from '../../stores/viewerStore';
import { useApprovalStore } from '../../stores/approvalStore';
import * as sourceImageTracking from './sourceImageTracking';

/** Spatial identity (FoR + native series) per container — derived from its source
 *  images and memoized (resolveContainerSpatial). Drives FoR-eligibility on attach:
 *  a container must not render on a viewport showing a different scan. */
const containerSpatial = new Map<string, ContainerSpatialId>();

// ─── A2c displacement-hide (signal 10) ───────────────────────────────────────


/** Voxel clipboard (D6 / signal 23): the copied region, and the focal point it was
 *  copied at, so a paste can be translated to the current slice. */
let voxelClip: VoxelRegionClip | null = null;
let voxelClipSourceFocal: Vec3 | null = null;
/** The member the voxel clipboard was copied from — where Ctrl+V pastes. */
let voxelClipMember: { containerId: string; segmentIndex: number } | null = null;

/** Every voxel of the segment on the active viewport's current slice. */
function voxelsOnActiveSlice(grid: NonNullable<ReturnType<typeof readSegmentVoxelGrid>>): number[] {
  const vpId = useViewerStore.getState().activeViewportId;
  const camera = (viewportService.getViewport(vpId) as { getCamera?: () => { focalPoint?: number[]; viewPlaneNormal?: number[] } } | undefined)
    ?.getCamera?.();
  if (!camera?.focalPoint || !camera.viewPlaneNormal) return [];
  const axis = sliceAxisFor(grid.geometry.direction, camera.viewPlaneNormal);
  const slice = worldToIndex(grid.geometry, camera.focalPoint as Vec3)[axis];
  const [nx, ny, nz] = grid.geometry.dimensions;
  const out: number[] = [];
  const at = (i: number, j: number, k: number) => i + j * nx + k * nx * ny;
  const [ai, bi] = axis === 0 ? [ny, nz] : axis === 1 ? [nx, nz] : [nx, ny];
  for (let a = 0; a < ai; a++) {
    for (let b = 0; b < bi; b++) {
      const flat = axis === 0 ? at(slice, a, b) : axis === 1 ? at(a, slice, b) : at(a, b, slice);
      if (grid.data[flat] === grid.value) out.push(flat);
    }
  }
  return out;
}

/** Whether a (container, segment) is locked — a multi-layer segment's lock lives on its
 *  sub-seg (stored as segment 1). */
function isSegmentLockedHere(containerId: string, segmentIndex: number): boolean {
  try {
    const sub = mlg.isMultiLayerGroup(containerId) ? mlg.resolveSubSegId(containerId, segmentIndex) : containerId;
    const value = mlg.isMultiLayerGroup(containerId) ? 1 : segmentIndex;
    return !!sub && csSegmentation.segmentLocking.isSegmentIndexLocked(sub, value);
  } catch {
    return false;
  }
}

/** Re-render after a programmatic labelmap write (same events as a brush edit). */
function notifyLabelmapChanged(csSegmentationId: string): void {
  try {
    csSegmentation.triggerSegmentationEvents.triggerSegmentationDataModified(csSegmentationId);
  } catch { /* best-effort */ }
  for (const vpId of csSegmentation.state.getViewportIdsWithSegmentation(csSegmentationId)) {
    try { csToolUtilities.segmentation.triggerSegmentationRender(vpId); } catch { /* ignore */ }
  }
}

/**
 * Make a programmatic voxel write undoable: ONE history entry whose undo puts back every
 * changed voxel's old value and whose redo re-applies the new one. Filed per container by
 * its segmentationId (the Cornerstone seg written — a multi-layer sub-seg maps to its
 * group), like a brush stroke.
 */
function pushVoxelHistoryMemo(containerId: string, segmentIndex: number, csSegmentationId: string, changes: number[]): void {
  const ring = (csCoreUtilities as unknown as { HistoryMemo?: { DefaultHistoryMemo?: { push?: (m: unknown) => void } } })
    .HistoryMemo?.DefaultHistoryMemo;
  ring?.push?.({
    id: `voxels-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    operationType: 'labelmap',
    segmentationId: csSegmentationId,
    segmentIndex,
    restoreMemo: (isUndo = true) => {
      const g = readSegmentVoxelGrid(containerId, segmentIndex);
      if (!g) return;
      for (let c = 0; c < changes.length; c += 3) g.write(changes[c], isUndo ? changes[c + 1] : changes[c + 2]);
      clearMaskSelection();
      notifyLabelmapChanged(g.csSegmentationId);
    },
  });
}

/** Current world focal point of the active viewport (paste-at-slice translation). */
function activeViewportFocalPoint(): Vec3 | null {
  try {
    const vpId = useViewerStore.getState().activeViewportId;
    const vp = viewportService.getViewport(vpId) as { getCamera?: () => { focalPoint?: number[] } } | undefined;
    const fp = vp?.getCamera?.()?.focalPoint;
    return Array.isArray(fp) && fp.length === 3 ? ([fp[0], fp[1], fp[2]] as Vec3) : null;
  } catch {
    return null;
  }
}

/** Resolve a viewport's Frame-of-Reference + series. Null/unknown fields ⇒ the
 *  caller fails OPEN (treats the pair as native) so a single-series render is
 *  never regressed by an unresolved id. */
function resolveViewportSpatial(viewportId: string): ViewportSpatialId | null {
  const vp = viewportService.getViewport(viewportId) as any;
  if (!vp) return null;
  let frameOfReferenceUID: string | null = null;
  try {
    frameOfReferenceUID = vp.getFrameOfReferenceUID?.() ?? null;
  } catch {
    frameOfReferenceUID = null;
  }
  let imageId: string | null = null;
  try {
    imageId = vp.getImageIds?.()?.[0] ?? vp.getCurrentImageId?.() ?? null;
  } catch {
    imageId = null;
  }
  let seriesInstanceUID: string | null = null;
  if (imageId) {
    const m = metaData.get('generalSeriesModule', imageId) as { seriesInstanceUID?: string } | undefined;
    seriesInstanceUID = m?.seriesInstanceUID ?? null;
  }
  return { viewportId, frameOfReferenceUID, seriesInstanceUID, acquisitionNumber: null };
}

/**
 * Derive a container's spatial identity from the images it was built over.
 *
 * Identity was once recorded only on the service's own CREATE paths, so a container
 * IMPORTED from XNAT had no entry in `containerSpatial` — and since every spatial
 * decision here fails open on a missing entry, a loaded container was treated as native
 * to every viewport: the draw gate never blocked it, its rows never dimmed, and it
 * attached to viewports it had no business rendering on. A SEG you drew was gated
 * correctly while the same SEG reloaded from XNAT was not, which no spec caught because
 * every spec creates its containers.
 *
 * The fix is to derive identity rather than to remember it at each of the (three, and
 * growing) import call sites: the source images already carry both halves — the Frame of
 * Reference on `imagePlaneModule` and the series on `generalSeriesModule` — and are
 * tracked for export attribution regardless of how the container arrived.
 */
function spatialFromSourceImages(containerId: string): ContainerSpatialId | null {
  let imageId = sourceImageTracking.getSourceImageIds(containerId)?.[0] ?? null;
  // A multi-layer group is a virtual id Cornerstone knows nothing about; its source
  // images are tracked on the per-segment sub-segs.
  if (!imageId && mlg.isMultiLayerGroup(containerId)) {
    for (const subSegId of mlg.getActiveSubSegIds(containerId)) {
      imageId = sourceImageTracking.getSourceImageIds(subSegId)?.[0] ?? null;
      if (imageId) break;
    }
  }
  if (!imageId) return null;
  const plane = metaData.get('imagePlaneModule', imageId) as { frameOfReferenceUID?: string } | undefined;
  const frameOfReferenceUID = plane?.frameOfReferenceUID ?? null;
  // Without a Frame of Reference there is nothing to decide on; stay unresolved so the
  // callers keep failing open rather than inventing a half-identity.
  if (!frameOfReferenceUID) return null;
  const series = metaData.get('generalSeriesModule', imageId) as { seriesInstanceUID?: string } | undefined;
  const nativeSeriesInstanceUID = series?.seriesInstanceUID ?? null;
  return {
    frameOfReferenceUID,
    nativeSeriesInstanceUID,
    referencedSeriesInstanceUIDs: nativeSeriesInstanceUID ? [nativeSeriesInstanceUID] : [],
  };
}

/**
 * A container's spatial identity: the memoized one if already resolved (or set by the
 * test seam), otherwise derived from its source images. The derived result is memoized into the same map, so
 * later calls (the draw gate runs on every pointerdown) cost one lookup.
 *
 * Still returns null when neither is available — that remains "no opinion", and every
 * caller fails open on it.
 */
function resolveContainerSpatial(containerId: string): ContainerSpatialId | null {
  const recorded = containerSpatial.get(containerId);
  if (recorded?.frameOfReferenceUID) return recorded;
  let derived: ContainerSpatialId | null = null;
  try {
    derived = spatialFromSourceImages(containerId);
  } catch {
    derived = null; // a metadata read must never throw out of a gate or an attach loop
  }
  if (derived) containerSpatial.set(containerId, derived);
  return derived ?? recorded ?? null;
}

/** UIDs of the threshold-ROI annotations currently in Cornerstone state. */
function roiThresholdAnnotationUIDs(): string[] {
  const all = (csAnnotation.state.getAllAnnotations?.() ?? []) as Array<{
    annotationUID?: string;
    metadata?: { toolName?: string };
  }>;
  const names = new Set([RectangleROIThresholdTool.toolName]);
  return all
    .filter((a) => a.metadata?.toolName && names.has(a.metadata.toolName))
    .map((a) => a.annotationUID)
    .filter((u): u is string => !!u);
}

/** The source ImageVolume a viewport is displaying (the intensities to threshold on). */
function viewportSourceVolume(viewportId: string): unknown | null {
  const vp = viewportService.getViewport(viewportId) as { getAllVolumeIds?: () => string[] } | undefined;
  const volumeId = vp?.getAllVolumeIds?.()?.[0];
  return volumeId ? cache.getVolume(volumeId) ?? null : null;
}

/**
 * Attach a labelmap to a viewport, if that viewport is showing the scan it was drawn on.
 *
 * A mask belongs to its own scan. It renders on every viewport displaying that scan —
 * including each plane of an MPR, which are views of one volume — and on no others.
 *
 * This replaced a four-outcome model (requirements A2a–A2d) under which a mask from one
 * series ALSO rendered, dimmed and read-only, on a sibling series of the same exam, unless
 * a measured anatomical shift suggested the patient had moved between them. That was
 * written into the requirements but never reached users: the panel's create path builds a
 * per-slice mask that only ever attached to its own series, and only a test-only shortcut
 * produced the volume masks the cross-series path acted on. Removed as incorrect.
 *
 * Fails OPEN when spatial identity is unresolved — a container mid-load, or images without
 * usable metadata — so a working single-series render is never suppressed by an unknown.
 */
export function attachLabelmapToOwnSeries(segmentationId: string, viewportId: string): void {
  let attach = true;
  try {
    attach = isContainerNativeToViewport(segmentationId, viewportId) !== false;
  } catch {
    attach = true; // a metadata read must never abort the create-time attach loop
  }
  if (!attach) return;
  csSegmentation.addLabelmapRepresentationToViewport(viewportId, [{ segmentationId }]);
  try {
    csSegmentation.activeSegmentation.setActiveSegmentation(viewportId, segmentationId);
  } catch {
    /* viewport not ready */
  }
}

export interface DrawDecision {
  allowed: boolean;
  /** User-facing hint when blocked (B3 / D10). */
  reason?: string;
}

/**
 * Gesture-start blocking (B3 / D10 / signal 12): may the active container be drawn
 * into on this viewport? Drawing always targets the ACTIVE container; it is allowed
 * only on a viewport NATIVE to it. A same-FoR sibling series is read-only (A2b/c); a
 * different FoR can't host it at all (A2d). Fails OPEN (allows) when spatial ids are
 * unresolved, so a valid single-series draw is never blocked. The Phase-3 gesture
 * path enforces this at mouse-down; Phase 2 verifies the decision at the service layer.
 */
/**
 * Viewport ids a container currently renders on. Multi-layer-group aware: our SEG ids are
 * virtual groups Cornerstone does not know, so the group's sub-segs are resolved first.
 *
 * Feeds the panel's cross-panel pill, which had no data source until now —
 * `ContainerRow.crossPanelCount` was declared and rendered but never passed by anything,
 * so the pill has never appeared.
 */
export function viewportIdsForContainer(containerId: string): string[] {
  const direct = (id: string) => csSegmentation.state.getViewportIdsWithSegmentation(id) ?? [];
  if (mlg.isMultiLayerGroup(containerId)) {
    return mlg.findViewportsWithGroup(containerId, direct);
  }
  return direct(containerId);
}

/**
 * Is this viewport showing the scan the container was drawn on?
 *
 * `true` when the viewport's series is the container's own (or one it references — the
 * planes of an MPR all show the same series). `false` when it is confidently a different
 * scan. `null` when either side's spatial identity cannot be resolved, which callers treat
 * as "no opinion" rather than as a restriction, so an unknown never suppresses a working
 * single-series render.
 */
export function isContainerNativeToViewport(containerId: string, viewportId: string): boolean | null {
  const cspatial = resolveContainerSpatial(containerId);
  const vspatial = resolveViewportSpatial(viewportId);
  if (!cspatial?.frameOfReferenceUID || !vspatial?.frameOfReferenceUID) return null;
  if (!cspatial.nativeSeriesInstanceUID || !vspatial.seriesInstanceUID) return null;
  if (cspatial.frameOfReferenceUID !== vspatial.frameOfReferenceUID) return false;
  return (
    vspatial.seriesInstanceUID === cspatial.nativeSeriesInstanceUID ||
    cspatial.referencedSeriesInstanceUIDs.includes(vspatial.seriesInstanceUID)
  );
}

/**
 * Does this viewport actually display anything?
 *
 * Not the same question as "does the panel have image ids". An MPR plane shows a
 * reformatted view of a volume shared with its sibling planes and carries no image-id list
 * of its own, so `panelImageIds` is empty for it while it is plainly showing an image.
 * Using that as the emptiness test hid annotations from every MPR orientation but the
 * first.
 *
 * `getImageData()` is the signal Cornerstone itself gates contour rendering on
 * (`renderMethods.js`: `if (!enabledElement?.viewport?.getImageData()) return`), so it
 * answers for stack and volume viewports alike. The image-id and volume-id checks are
 * fallbacks for viewport types that do not implement it.
 */
export function viewportHasContent(viewportId: string): boolean {
  const vp = viewportService.getViewport(viewportId) as
    | { getImageData?: () => unknown; getImageIds?: () => string[]; getAllVolumeIds?: () => string[] }
    | undefined;
  if (!vp) return false;
  try {
    if (vp.getImageData?.()) return true;
  } catch {
    /* fall through to the id checks */
  }
  try {
    if ((vp.getImageIds?.()?.length ?? 0) > 0) return true;
  } catch {
    /* fall through */
  }
  try {
    if ((vp.getAllVolumeIds?.()?.length ?? 0) > 0) return true;
  } catch {
    /* nothing more to try */
  }
  return false;
}

/**
 * Viewports showing the SAME series as `viewportId` (itself included).
 *
 * "Same scan in two viewports" was being decided by `viewerStore.panelScanMap` — an XNAT
 * scan id — which is empty for a local import and not reliably populated for every panel
 * of an MPR layout. When it could not answer, a container created on one viewport simply
 * never attached to the other, so the same scan showed different annotations depending on
 * which viewport you looked through, and the panel invited you to create a duplicate.
 *
 * Frame of Reference + series is the identity Cornerstone always has, and unlike a
 * container's own spatial identity it is resolvable at CREATE time, before any labelmap
 * exists. Two viewports that agree on both are showing the same thing, so a container
 * native to one is native to the other.
 *
 * Returns just `[viewportId]` when its own identity cannot be resolved — never a guess.
 */
export function viewportsShowingSameSeries(viewportId: string, candidateViewportIds: string[]): string[] {
  const self = resolveViewportSpatial(viewportId);
  if (!self?.frameOfReferenceUID || !self.seriesInstanceUID) return [viewportId];
  const out = new Set<string>([viewportId]);
  for (const candidate of candidateViewportIds) {
    if (candidate === viewportId) continue;
    const other = resolveViewportSpatial(candidate);
    if (!other?.frameOfReferenceUID || !other.seriesInstanceUID) continue;
    if (
      other.frameOfReferenceUID === self.frameOfReferenceUID &&
      other.seriesInstanceUID === self.seriesInstanceUID
    ) {
      out.add(candidate);
    }
  }
  return Array.from(out);
}

export function canDrawOnViewport(activeContainerId: string | null, viewportId: string): DrawDecision {
  if (!activeContainerId) {
    return { allowed: false, reason: 'No active container — create or select one to draw into.' };
  }
  // Approval (D7.11) is a hard edit lock, checked before any spatial reasoning: an
  // approved container cannot be drawn into on ANY viewport until it is revoked.
  if (useApprovalStore.getState().isApproved(activeContainerId)) {
    return {
      allowed: false,
      reason: 'This container is approved and edit-locked. Revoke its approval in the Annotations panel to edit.',
    };
  }
  // An annotation is edited on the scan it belongs to. Unresolved identity fails open, so
  // a valid single-series draw is never blocked by an unknown.
  if (isContainerNativeToViewport(activeContainerId, viewportId) === false) {
    return {
      allowed: false,
      reason:
        'The active annotation belongs to a different scan. Focus a viewport showing that scan, or create a new annotation for this one.',
    };
  }
  return { allowed: true };
}


export const unifiedSegService = {
  /**
   * Measure the active segment's largest bidirectional (long axis + perpendicular).
   *
   * This is an ACTION on a segment, not a drawing tool, and that is why it used to crash.
   * SegmentBidirectionalTool's free-draw path builds an annotation whose metadata carries
   * no segmentationId or segmentIndex at all; its render then calls
   * getSegmentIndexColor(viewportId, undefined, undefined), gets null back, and dies on
   * `colorArray.slice(0, 3)`. The tool is only ever meant to be entered through its
   * static `hydrate`, with the segment named — which is what this does.
   *
   * (It was recorded as "crashes on multi-layer-group segmentations". Group ids are the
   * usual cause of a null colour lookup, but not here: the free-draw path passes
   * undefined, so it would crash on a plain segmentation too.)
   *
   * Cornerstone computes the axes off-thread; the caller gets a promise so the UI can
   * report failure rather than silently do nothing.
   */
  async measureActiveSegmentBidirectional(viewportId: string): Promise<boolean> {
    const s = useSegmentationStore.getState();
    const groupId = s.activeSegmentationId;
    const segmentIndex = s.activeSegmentIndex;
    if (!groupId || !Number.isInteger(segmentIndex) || segmentIndex <= 0) return false;

    // Cornerstone must be given an id IT knows. For a multi-layer group the group id is
    // virtual, and the real labelmap is the per-segment sub-seg.
    const segmentationId = mlg.isMultiLayerGroup(groupId)
      ? mlg.resolveSubSegId(groupId, segmentIndex) ?? groupId
      : groupId;
    // A resolved sub-seg holds its own single segment at index 1.
    const csSegmentIndex = segmentationId === groupId ? segmentIndex : 1;

    try {
      const result = await csToolUtilities.segmentation.getSegmentLargestBidirectional({
        segmentationId,
        segmentIndices: [csSegmentIndex],
      } as never);
      const first = (result as Array<Record<string, unknown>> | undefined)?.[0];
      if (!first) return false;
      const majorAxis = first.majorAxis as [number[], number[]] | undefined;
      const minorAxis = first.minorAxis as [number[], number[]] | undefined;
      if (!majorAxis || !minorAxis) return false;

      (SegmentBidirectionalTool as unknown as {
        hydrate: (vp: string, axis: unknown, opts: Record<string, unknown>) => void;
      }).hydrate(viewportId, [majorAxis, minorAxis], { segmentationId, segmentIndex: csSegmentIndex });
      return true;
    } catch (err) {
      console.warn('[unifiedSegService] bidirectional measurement failed:', err);
      return false;
    }
  },

  /**
   * Fill the active segment inside a threshold ROI, then clear the ROI.
   *
   * Rectangle/Circle threshold tools only DRAW a region — Cornerstone applies nothing on
   * its own, and nothing in the library calls the fill utility. The application decides
   * when, which is why both tools shipped greyed out: registered, drawable, and with no
   * effect whatsoever.
   *
   * The fill runs against a segmentation VOLUME. For the per-slice masks the panel
   * creates, `getOrCreateSegmentationVolume` builds one over the very same images
   * (createAndCacheVolumeFromImagesSync), so writes reach the slices without a copy back
   * — the same mechanism the sphere brush relies on.
   *
   * The ROI is removed afterwards: it is an instruction, not an annotation the user keeps,
   * and leaving it behind would put a measurement-looking box in the panel.
   */
  applyRoiThresholdFill(viewportId: string): boolean {
    const s = useSegmentationStore.getState();
    const groupId = s.activeSegmentationId;
    const segmentIndex = s.activeSegmentIndex;
    if (!groupId || !Number.isInteger(segmentIndex) || segmentIndex <= 0) return false;

    const segmentationId = mlg.isMultiLayerGroup(groupId)
      ? mlg.resolveSubSegId(groupId, segmentIndex) ?? groupId
      : groupId;
    const csSegmentIndex = segmentationId === groupId ? segmentIndex : 1;

    try {
      const uids = roiThresholdAnnotationUIDs();
      if (uids.length === 0) return false;

      const segVolume = csToolUtilities.segmentation.getOrCreateSegmentationVolume(segmentationId);
      const sourceVolume = viewportSourceVolume(viewportId);
      if (!segVolume || !sourceVolume) return false;

      const [lower, upper] = s.thresholdRange;
      csToolUtilities.segmentation.rectangleROIThresholdVolumeByRange(
        uids,
        segVolume as never,
        [{ volume: sourceVolume, lower: Math.min(lower, upper), upper: Math.max(lower, upper) }] as never,
        { overwrite: false, segmentationId, segmentIndex: csSegmentIndex } as never,
      );

      for (const uid of uids) {
        try {
          csAnnotation.state.removeAnnotation(uid);
        } catch {
          /* already gone */
        }
      }
      csToolUtilities.segmentation.triggerSegmentationRender(viewportId);
      return true;
    } catch (err) {
      console.warn('[unifiedSegService] ROI threshold fill failed:', err);
      return false;
    }
  },

  /**
   * Ctrl+C on a mask (unified selection S5 — docs/unified-selection.md): copy the selected
   * islands of this slice; with none selected, every island of the active segment on this
   * slice. A slice's region, not the whole 3D segment (which is what this copied before).
   */
  copySegmentVoxels(): boolean {
    const sel = getMaskSelection();
    const s = useSegmentationStore.getState();
    const containerId = sel?.containerId ?? s.activeSegmentationId;
    const segmentIndex = sel?.segmentIndex ?? s.activeSegmentIndex;
    if (!containerId || !Number.isInteger(segmentIndex) || segmentIndex <= 0) return false;
    const grid = readSegmentVoxelGrid(containerId, segmentIndex);
    if (!grid) return false;
    const voxels = sel ? sel.islands.flatMap((i) => i.voxels) : voxelsOnActiveSlice(grid);
    if (voxels.length === 0) return false;
    const mask = new Uint8Array(grid.data.length);
    for (const v of voxels) mask[v] = 1;
    const clip = copyVoxelRegion({ geometry: grid.geometry, data: mask }, 1);
    if (!clip) return false;
    voxelClip = clip;
    voxelClipSourceFocal = activeViewportFocalPoint();
    voxelClipMember = { containerId, segmentIndex };
    return true;
  },

  /**
   * Delete on a mask (unified selection S6): erase the selected islands, as ONE undo step.
   * Nothing selected → nothing erased (no fallback: delete is destructive). A locked
   * segment is left alone.
   */
  deleteSelectedIslands(): boolean {
    const sel = getMaskSelection();
    if (!sel) return false;
    if (isSegmentLockedHere(sel.containerId, sel.segmentIndex)) return false;
    const grid = readSegmentVoxelGrid(sel.containerId, sel.segmentIndex);
    if (!grid) return false;
    const changes: number[] = [];
    for (const island of sel.islands) {
      for (const flat of island.voxels) {
        const old = grid.data[flat];
        if (old !== grid.value) continue;
        changes.push(flat, old, 0);
        grid.write(flat, 0);
      }
    }
    if (changes.length === 0) return false;
    pushVoxelHistoryMemo(sel.containerId, sel.segmentIndex, grid.csSegmentationId, changes);
    clearMaskSelection();
    notifyLabelmapChanged(grid.csSegmentationId);
    return true;
  },

  /** Drop the voxel clipboard (a contour copy replaced it — the last copy wins). */
  clearVoxelClipboard(): void {
    voxelClip = null;
    voxelClipSourceFocal = null;
    voxelClipMember = null;
  },

  /** Whether a voxel region is on the clipboard (hotkey routing). */
  hasVoxelClipboard(): boolean {
    return voxelClip !== null;
  },

  /**
   * Paste the clipboard voxel region into the active container's active segment,
   * NN-resampled and translated by the focal-point delta so it lands at the current
   * slice (D6 / signal 23). Writes go through the live storage (readSegmentVoxelGrid —
   * the brush's write path). Fires SEGMENTATION_DATA_MODIFIED → re-render + dirty (same
   * as a brush edit).
   */
  pasteActiveSegmentVoxels(): boolean {
    if (!voxelClip) return false;
    // Into the segment it was copied from (the selection lives inside one member).
    const st = useSegmentationStore.getState();
    const containerId = voxelClipMember?.containerId ?? st.activeSegmentationId;
    const segmentIndex = voxelClipMember?.segmentIndex ?? st.activeSegmentIndex;
    if (!containerId || !Number.isInteger(segmentIndex) || segmentIndex <= 0) return false;
    if (isSegmentLockedHere(containerId, segmentIndex)) return false;
    const grid = readSegmentVoxelGrid(containerId, segmentIndex);
    if (!grid) return false;

    let translationWorld: Vec3 | undefined;
    const nowFocal = activeViewportFocalPoint();
    if (voxelClipSourceFocal && nowFocal) {
      translationWorld = [
        nowFocal[0] - voxelClipSourceFocal[0],
        nowFocal[1] - voxelClipSourceFocal[1],
        nowFocal[2] - voxelClipSourceFocal[2],
      ];
    }

    // Every voxel the paste changes, as [flat, old, new] — what one undo puts back.
    const changes: number[] = [];
    const result = pasteVoxelRegion(
      voxelClip,
      { geometry: grid.geometry, data: grid.data as unknown as Uint8Array },
      {
        targetSegmentIndex: grid.value,
        overlap: 'overwrite',
        translationWorld,
        writeTarget: (flat: number, value: number) => {
          const old = grid.data[flat];
          if (old === value) return;
          changes.push(flat, old, value);
          grid.write(flat, value);
        },
      },
    );
    if (result.written <= 0 || changes.length === 0) return false;

    pushVoxelHistoryMemo(containerId, segmentIndex, grid.csSegmentationId, changes);
    notifyLabelmapChanged(grid.csSegmentationId);
    const written: number[] = [];
    for (let c = 0; c < changes.length; c += 3) if (changes[c + 2] === grid.value) written.push(changes[c]);
    selectIslandsContaining(useViewerStore.getState().activeViewportId, containerId, segmentIndex, written);
    return true;
  },

  /**
   * Is the active segment (the one an edit would write into) locked? (signal 21/29.)
   * Cornerstone's voxel strategies only prevent OVERWRITING locked voxels — they do
   * NOT prevent ADDING to a locked active segment on empty space — so the "locking a
   * segment blocks editing at gesture-start" policy is enforced app-side (the
   * drawGestureGuard consults this). Reads the active segmentation + its active segment
   * index and the Cornerstone lock state.
   *
   * A multi-layer group (what "New Segmentation" creates) is NOT a Cornerstone
   * segmentation: each segment is its own sub-seg whose lock lives on ITS index 1, and
   * the group's active segment is the store's index. Asking Cornerstone about the
   * group id answered "unlocked" for every group, so a locked segment still painted.
   */
  isActiveSegmentLocked(): boolean {
    const { activeSegmentationId: segmentationId, activeSegmentIndex } = useSegmentationStore.getState();
    if (!segmentationId) return false;
    if (mlg.isMultiLayerGroup(segmentationId)) {
      const subSegId = activeSegmentIndex ? mlg.resolveSubSegId(segmentationId, activeSegmentIndex) : null;
      if (!subSegId) return false;
      try {
        return csSegmentation.segmentLocking.isSegmentIndexLocked(subSegId, 1);
      } catch {
        return false;
      }
    }
    let idx: number | undefined;
    try {
      idx = csSegmentation.segmentIndex.getActiveSegmentIndex(segmentationId);
    } catch {
      idx = undefined;
    }
    if (!idx) return false;
    try {
      return csSegmentation.segmentLocking.isSegmentIndexLocked(segmentationId, idx);
    } catch {
      return false;
    }
  },

  /** Forget all tracked unified segmentations (test isolation). */
  reset(): void {
    containerSpatial.clear();
    voxelClip = null;
    voxelClipSourceFocal = null;
  },

  /** Test seam: record a container's native spatial identity directly. */
  _setContainerSpatialForTest(segmentationId: string, spatial: ContainerSpatialId): void {
    containerSpatial.set(segmentationId, spatial);
  },
};
