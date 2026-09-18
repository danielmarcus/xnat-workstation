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
import { volumeLoader, getRenderingEngine, metaData, cache } from '@cornerstonejs/core';
import {
  segmentation as csSegmentation,
  Enums as ToolEnums,
  utilities as csToolUtilities,
} from '@cornerstonejs/tools';
import { canComputeRequestedRepresentation, computeLabelmapData } from '@cornerstonejs/polymorphic-segmentation';
import { viewportService } from './viewportService';
import type { ContainerSpatialId, ViewportSpatialId } from './spatialIdentity';
import * as mlg from './multiLayerGroup';
import {
  copyVoxelRegion,
  pasteVoxelRegion,
  type VoxelGridGeometry,
  type VoxelRegionClip,
  type Vec3,
} from './segmentationService/voxelClipboard';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { useViewerStore } from '../../stores/viewerStore';
import { useApprovalStore } from '../../stores/approvalStore';
import * as sourceImageTracking from './sourceImageTracking';

let counter = 0;
/** Segmentations created on the unified path, so they can be re-attached to
 *  viewports that (re)mount after a layout change. */
const created = new Set<string>();
/** Spatial identity (FoR + native series) per unified container — recorded at
 *  creation from its native viewport. Drives FoR-eligibility on (re)attach
 *  (A2a–d): a container must not render on a different-FoR viewport, and renders
 *  with the non-native style on a same-FoR sibling series. */
const containerSpatial = new Map<string, ContainerSpatialId>();

// ─── A2c displacement-hide (signal 10) ───────────────────────────────────────


/** Voxel clipboard (D6 / signal 23): the copied region, and the focal point it was
 *  copied at, so a paste can be translated to the current slice. */
let voxelClip: VoxelRegionClip | null = null;
let voxelClipSourceFocal: Vec3 | null = null;

/** Read a unified container's labelmap volume (`${segmentationId}_lm`) as geometry +
 *  live voxelManager + a scalar-data view. Derived volume labelmaps expose data via
 *  getCompleteScalarDataArray() (getScalarData() can be empty); WRITES must go through
 *  voxelManager.setAtIndex (the brush's path) — the read array is a copy. */
function readLabelmapVoxels(
  segmentationId: string,
): { geometry: VoxelGridGeometry; voxelManager: any; data: ArrayLike<number> } | null {
  try {
    const vol = cache.getVolume(`${segmentationId}_lm`) as any;
    if (!vol) return null;
    const img = vol.imageData;
    const dimensions = (vol.dimensions ?? img?.getDimensions?.()) as Vec3 | undefined;
    const spacing = (vol.spacing ?? img?.getSpacing?.()) as Vec3 | undefined;
    const origin = (vol.origin ?? img?.getOrigin?.()) as Vec3 | undefined;
    const direction = Array.from((vol.direction ?? img?.getDirection?.()) ?? []) as number[];
    const voxelManager = vol.voxelManager;
    const data = (voxelManager?.getCompleteScalarDataArray?.() ?? voxelManager?.getScalarData?.() ?? vol.scalarData) as ArrayLike<number> | undefined;
    if (!dimensions || !spacing || !origin || direction.length < 9 || !data?.length) return null;
    return { geometry: { dimensions, spacing, origin, direction }, voxelManager, data };
  } catch {
    return null;
  }
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
 * `recordContainerSpatial` only ever runs on the two CREATE paths, so a container
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
 * A container's spatial identity: the recorded one if a create path set it, otherwise
 * derived from its source images. The derived result is memoized into the same map, so
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

/** Record a container's native spatial identity from the viewport it was created on. */
function recordContainerSpatial(segmentationId: string, nativeViewportId: string | undefined): void {
  if (!nativeViewportId) return;
  const v = resolveViewportSpatial(nativeViewportId);
  if (!v) return;
  containerSpatial.set(segmentationId, {
    frameOfReferenceUID: v.frameOfReferenceUID,
    nativeSeriesInstanceUID: v.seriesInstanceUID,
    referencedSeriesInstanceUIDs: v.seriesInstanceUID ? [v.seriesInstanceUID] : [],
  });
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


export interface UnifiedLabelmapResult {
  segmentationId: string;
  segmentIndex: number;
  labelmapVolumeId: string;
}

export const unifiedSegService = {
  /**
   * Create a volume labelmap segmentation (one default segment) derived from
   * `referencedVolumeId`, register it, and add its representation to each of
   * `viewportIds`, setting it active there. Returns the ids for follow-up edits.
   */
  async createVolumeLabelmap(
    referencedVolumeId: string,
    viewportIds: string[],
    label = 'Segmentation',
  ): Promise<UnifiedLabelmapResult> {
    counter++;
    const segmentationId = `unified_seg_${counter}`;
    const labelmapVolumeId = `${segmentationId}_lm`;

    // Derived labelmap volume: same geometry as the shared source volume.
    const lm = volumeLoader.createAndCacheDerivedLabelmapVolume(referencedVolumeId, {
      volumeId: labelmapVolumeId,
    });

    csSegmentation.addSegmentations([
      {
        segmentationId,
        representation: {
          type: ToolEnums.SegmentationRepresentations.Labelmap,
          data: { volumeId: lm.volumeId, referencedVolumeId },
        },
        config: {
          label,
          segments: {
            1: { label: 'Segment 1', segmentIndex: 1, locked: false, active: true } as never,
          },
        },
      },
    ]);

    created.add(segmentationId);
    // viewportIds[0] is the create origin → its series is the container's native
    // series. Record that BEFORE attaching so the eligibility gate can classify the
    // other viewports against it.
    recordContainerSpatial(segmentationId, viewportIds[0]);
    for (const viewportId of viewportIds) {
      // FoR-eligibility gate (A2a–d): the native viewport(s) attach solid + active;
      // a same-FoR sibling series attaches non-native (dimmed) + read-only; a
      // different FoR is skipped. MPR-safe: every MPR panel shows the same series,
      // so each classifies `native` and attaches exactly as before.
      attachLabelmapToOwnSeries(segmentationId, viewportId);
    }
    csSegmentation.segmentIndex.setActiveSegmentIndex(segmentationId, 1);

    return { segmentationId, segmentIndex: 1, labelmapVolumeId: lm.volumeId };
  },

  /**
   * Re-attach every unified segmentation to a viewport that has just (re)mounted
   * — e.g. an MPR panel recreated after a layout change — so structures are not
   * lost on layout swaps. Idempotent: only attaches segmentations that still
   * exist in Cornerstone state.
   */
  attachExistingToViewport(viewportId: string): void {
    for (const segmentationId of created) {
      if (!csSegmentation.state.getSegmentation(segmentationId)) {
        created.delete(segmentationId);
        containerSpatial.delete(segmentationId);
        continue;
      }
      try {
        // FoR-eligibility gate (A2a–d): native attaches solid + editable; a same-FoR
        // sibling series attaches non-native + read-only; a different FoR does not
        // attach here. Fails open to native when ids are unresolved.
        attachLabelmapToOwnSeries(segmentationId, viewportId);
      } catch {
        /* viewport not ready yet */
      }
    }
  },

  /**
   * Create a CONTOUR segmentation (one default segment) and attach its contour
   * representation to each viewport, so the freehand contour tool can draw into
   * it. The contour renders on its own plane; cross-plane MPR display is handled
   * by syncContourToLabelmap (PolySeg).
   */
  createContourSegmentation(viewportIds: string[], label = 'Structure'): { segmentationId: string; segmentIndex: number } {
    counter++;
    const segmentationId = `unified_contour_${counter}`;
    csSegmentation.addSegmentations([
      {
        segmentationId,
        representation: {
          type: ToolEnums.SegmentationRepresentations.Contour,
          data: { annotationUIDsMap: new Map([[1, new Set<string>()]]) } as never,
        },
        config: {
          label,
          segments: {
            1: { label: 'Structure 1', segmentIndex: 1, locked: false, active: true } as never,
          },
        },
      },
    ]);
    created.add(segmentationId);
    recordContainerSpatial(segmentationId, viewportIds[0]);
    for (const viewportId of viewportIds) {
      csSegmentation.addContourRepresentationToViewport(viewportId, [{ segmentationId }]);
      try {
        csSegmentation.activeSegmentation.setActiveSegmentation(viewportId, segmentationId);
      } catch {
        /* viewport not ready */
      }
    }
    csSegmentation.segmentIndex.setActiveSegmentIndex(segmentationId, 1);
    return { segmentationId, segmentIndex: 1 };
  },

  /**
   * Rasterize a contour segmentation into a labelmap (PolySeg) targeted at the
   * shared volume, and add/refresh the labelmap representation on every viewport
   * — so a contour drawn on the axial plane appears (resampled) on the sagittal
   * + coronal MPR panels. Re-run after each contour edit for live updates.
   * Returns false if conversion isn't possible/available.
   */
  async syncContourToLabelmap(segmentationId: string, viewportIds: string[]): Promise<boolean> {
    const engine = getRenderingEngine(viewportService.ENGINE_ID);
    if (!engine) return false;
    // Target geometry: a volume viewport's volume.
    let volumeViewport: unknown;
    for (const vpId of viewportIds) {
      const vp = engine.getViewport(vpId) as { getAllVolumeIds?: () => string[] } | undefined;
      if (vp && typeof vp.getAllVolumeIds === 'function' && vp.getAllVolumeIds()[0]) {
        volumeViewport = vp;
        break;
      }
    }
    if (!volumeViewport) return false;
    if (!canComputeRequestedRepresentation(segmentationId, ToolEnums.SegmentationRepresentations.Labelmap)) {
      return false;
    }
    const labelmapData = await computeLabelmapData(segmentationId, {
      viewport: volumeViewport as never,
      segmentIndices: [1],
    });
    if (!labelmapData) return false;
    const seg = csSegmentation.state.getSegmentation(segmentationId) as
      | { representationData?: Record<string, unknown> }
      | undefined;
    if (seg?.representationData) {
      seg.representationData[ToolEnums.SegmentationRepresentations.Labelmap] = labelmapData as never;
    }
    for (const vpId of viewportIds) {
      csSegmentation.addLabelmapRepresentationToViewport(vpId, [{ segmentationId }]);
    }
    for (const vpId of viewportIds) {
      try {
        csToolUtilities.segmentation.triggerSegmentationRender(vpId);
      } catch {
        /* ignore */
      }
    }
    return true;
  },

  /** Copy the active container's active segment voxel region to the clipboard (D6 / signal 23). */
  copyActiveSegmentVoxels(): boolean {
    const s = useSegmentationStore.getState();
    const segmentationId = s.activeSegmentationId;
    const segmentIndex = s.activeSegmentIndex;
    if (!segmentationId || !Number.isInteger(segmentIndex) || segmentIndex <= 0) return false;
    const lm = readLabelmapVoxels(segmentationId);
    if (!lm) return false;
    const clip = copyVoxelRegion({ geometry: lm.geometry, data: lm.data }, segmentIndex);
    if (!clip) return false;
    voxelClip = clip;
    voxelClipSourceFocal = activeViewportFocalPoint();
    return true;
  },

  /** Whether a voxel region is on the clipboard (hotkey routing). */
  hasVoxelClipboard(): boolean {
    return voxelClip !== null;
  },

  /**
   * Paste the clipboard voxel region into the active container's active segment,
   * NN-resampled and translated by the focal-point delta so it lands at the current
   * slice (D6 / signal 23). Writes go through the live voxelManager.setAtIndex (the
   * brush's write path — a derived volume labelmap's scalar read is a copy). Fires
   * SEGMENTATION_DATA_MODIFIED → re-render + dirty (same as a brush edit).
   */
  pasteActiveSegmentVoxels(): boolean {
    if (!voxelClip) return false;
    const s = useSegmentationStore.getState();
    const segmentationId = s.activeSegmentationId;
    const segmentIndex = s.activeSegmentIndex;
    if (!segmentationId || !Number.isInteger(segmentIndex) || segmentIndex <= 0) return false;
    const lm = readLabelmapVoxels(segmentationId);
    if (!lm || typeof lm.voxelManager?.setAtIndex !== 'function') return false;

    let translationWorld: Vec3 | undefined;
    const nowFocal = activeViewportFocalPoint();
    if (voxelClipSourceFocal && nowFocal) {
      translationWorld = [
        nowFocal[0] - voxelClipSourceFocal[0],
        nowFocal[1] - voxelClipSourceFocal[1],
        nowFocal[2] - voxelClipSourceFocal[2],
      ];
    }

    const [nx, ny] = lm.geometry.dimensions;
    const result = pasteVoxelRegion(
      voxelClip,
      { geometry: lm.geometry, data: lm.data as unknown as Uint8Array },
      {
        targetSegmentIndex: segmentIndex,
        overlap: 'overwrite',
        translationWorld,
        // Live write through the labelmap voxelManager (the brush's write path) — a
        // derived volume labelmap's scalar read is a copy, so in-place edits don't
        // reach the rendered volume. Prefer the IJK setter; fall back to flat-index.
        writeTarget: (flatIndex, value) => {
          if (typeof lm.voxelManager.setAtIJK === 'function') {
            lm.voxelManager.setAtIJK(flatIndex % nx, Math.floor(flatIndex / nx) % ny, Math.floor(flatIndex / (nx * ny)), value);
          } else {
            lm.voxelManager.setAtIndex(flatIndex, value);
          }
        },
      },
    );
    if (result.written <= 0) return false;

    try {
      csSegmentation.triggerSegmentationEvents.triggerSegmentationDataModified(segmentationId);
    } catch { /* best-effort */ }
    for (const vpId of csSegmentation.state.getViewportIdsWithSegmentation(segmentationId)) {
      try { csToolUtilities.segmentation.triggerSegmentationRender(vpId); } catch { /* ignore */ }
    }
    return true;
  },

  /**
   * Is the active segment (the one an edit would write into) locked? (signal 21/29.)
   * Cornerstone's voxel strategies only prevent OVERWRITING locked voxels — they do
   * NOT prevent ADDING to a locked active segment on empty space — so the "locking a
   * segment blocks editing at gesture-start" policy is enforced app-side (the
   * drawGestureGuard consults this). Reads the active segmentation + its active segment
   * index and the Cornerstone lock state.
   */
  isActiveSegmentLocked(): boolean {
    const segmentationId = useSegmentationStore.getState().activeSegmentationId;
    if (!segmentationId) return false;
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
    created.clear();
    containerSpatial.clear();
    voxelClip = null;
    voxelClipSourceFocal = null;
  },

  /** Test seam: record a container's native spatial identity directly. */
  _setContainerSpatialForTest(segmentationId: string, spatial: ContainerSpatialId): void {
    created.add(segmentationId);
    containerSpatial.set(segmentationId, spatial);
  },
};
