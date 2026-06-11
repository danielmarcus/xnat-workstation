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
import { classifyEligibility, type ContainerSpatialId, type ViewportSpatialId } from './forEligibility';
import { actionForEligibility, nonNativeStyleFor } from './eligibilityStyle';
import {
  copyVoxelRegion,
  pasteVoxelRegion,
  type VoxelGridGeometry,
  type VoxelRegionClip,
  type Vec3,
} from './segmentationService/voxelClipboard';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { useViewerStore } from '../../stores/viewerStore';
import { bulkDisplacementMm, type VolumeGeometry as SourceVolumeGeometry } from './bulkDisplacement';

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
/** Source ImageVolume id each container was derived from (its NATIVE volume). */
const containerNativeVolume = new Map<string, string>();
/** Memoized bulk displacement (mm) per `nativeVolumeId|viewportVolumeId` pair. */
const displacementCache = new Map<string, number | null>();

/** Read a SOURCE volume's geometry + scalar data for the displacement estimate
 *  (distinct from readLabelmapVoxels, which reads the labelmap). Streaming volumes
 *  expose data via getCompleteScalarDataArray(). null ⇒ unknown ⇒ caller defaults to show. */
function readSourceVolumeGeometry(volumeId: string | null | undefined): SourceVolumeGeometry | null {
  if (!volumeId) return null;
  try {
    const vol = cache.getVolume(volumeId) as any;
    if (!vol) return null;
    const img = vol.imageData;
    const dimensions = vol.dimensions ?? img?.getDimensions?.();
    const spacing = vol.spacing ?? img?.getSpacing?.();
    const origin = vol.origin ?? img?.getOrigin?.();
    const scalarData =
      vol.voxelManager?.getCompleteScalarDataArray?.() ?? vol.voxelManager?.getScalarData?.() ?? vol.scalarData;
    if (!dimensions || !spacing || !origin || !scalarData?.length) return null;
    return { scalarData, dimensions, spacing, origin };
  } catch {
    return null;
  }
}

/** The source ImageVolume id a viewport is currently displaying (first volume). */
function getViewportSourceVolumeId(viewportId: string): string | null {
  try {
    const vp = viewportService.getViewport(viewportId) as { getAllVolumeIds?: () => string[] } | undefined;
    return vp?.getAllVolumeIds?.()?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Bulk-anatomy displacement (mm) between a container's native volume and a viewport's
 *  volume (memoized). null = unknown ⇒ classifier defaults to show. */
function bulkDisplacementForPair(segmentationId: string, viewportId: string): number | null {
  const nativeVolumeId = containerNativeVolume.get(segmentationId);
  const vpVolumeId = getViewportSourceVolumeId(viewportId);
  if (!nativeVolumeId || !vpVolumeId || nativeVolumeId === vpVolumeId) return null;
  const key = `${nativeVolumeId}|${vpVolumeId}`;
  const cached = displacementCache.get(key);
  if (cached !== undefined) return cached;
  const a = readSourceVolumeGeometry(nativeVolumeId);
  const b = readSourceVolumeGeometry(vpVolumeId);
  const mm = a && b ? bulkDisplacementMm(a, b) : null;
  displacementCache.set(key, mm);
  return mm;
}

// ─── Voxel copy/paste (D6 / signal 23) ───────────────────────────────────────
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
 * Eligibility-gated attach of one labelmap container to one viewport, for the
 * re-attach path. Fails OPEN to native (attach, default style) whenever a spatial
 * id is unresolved, so the working single-series render is never regressed. Only a
 * confidently-different Frame of Reference (A2d) suppresses the attach; a same-FoR
 * sibling series (A2b) attaches with the non-native style + read-only.
 * Exported for service-integration testing.
 */
export function attachLabelmapWithEligibility(segmentationId: string, viewportId: string): void {
  // Default native (fail-open) — only override when both ids are confidently known.
  // The whole decision is wrapped so a metadata/viewport read failure can never
  // throw out of here (which would abort the create-time attach loop); on any error
  // we attach as native, exactly as the pre-eligibility code did.
  let action = actionForEligibility('native');
  try {
    const cspatial = containerSpatial.get(segmentationId);
    const vspatial = resolveViewportSpatial(viewportId);
    if (cspatial?.frameOfReferenceUID && vspatial?.frameOfReferenceUID) {
      // Classify once cheaply; only a same-FoR sibling series (cross-series-*) needs
      // the expensive two-volume displacement read (A2c) — native / different-FoR don't.
      const prelim = classifyEligibility({ container: cspatial, viewport: vspatial });
      const bulkDisplacementMm =
        prelim === 'cross-series-show' || prelim === 'cross-series-hide'
          ? bulkDisplacementForPair(segmentationId, viewportId)
          : undefined;
      action = actionForEligibility(
        classifyEligibility({ container: cspatial, viewport: vspatial, bulkDisplacementMm }),
      );
    }
  } catch {
    action = actionForEligibility('native');
  }
  // A2d different-FoR OR A2c displaced sibling (cross-series-hide): do not render here.
  // For a shared derived volume labelmap, NOT attaching is the only reliable per-viewport
  // hide — CS3D actor visibility is viewport-wide (visibility-off can't suppress it). The
  // container stays LISTED (the panel reads the segmentation store, not viewport attach).
  if (!action.attach) return;
  csSegmentation.addLabelmapRepresentationToViewport(viewportId, [{ segmentationId }]);
  if (action.nonNative) {
    try {
      csSegmentation.segmentationStyle.setStyle(
        { type: ToolEnums.SegmentationRepresentations.Labelmap, viewportId, segmentationId },
        nonNativeStyleFor('Labelmap') as never,
      );
    } catch {
      /* style is best-effort, never blocks attach */
    }
  }
  if (!action.readOnly) {
    try {
      csSegmentation.activeSegmentation.setActiveSegmentation(viewportId, segmentationId);
    } catch {
      /* viewport not ready */
    }
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
export function canDrawOnViewport(activeContainerId: string | null, viewportId: string): DrawDecision {
  if (!activeContainerId) {
    return { allowed: false, reason: 'No active container — create or select one to draw into.' };
  }
  const cspatial = containerSpatial.get(activeContainerId);
  const vspatial = resolveViewportSpatial(viewportId);
  if (!cspatial?.frameOfReferenceUID || !vspatial?.frameOfReferenceUID) {
    return { allowed: true }; // fail open — don't block a valid single-series draw
  }
  const eligibility = classifyEligibility({ container: cspatial, viewport: vspatial });
  if (eligibility === 'native') return { allowed: true };
  if (eligibility === 'different-for') {
    return {
      allowed: false,
      reason:
        'The active container belongs to a different frame of reference. Focus a viewport showing its series, or create a new container for this series.',
    };
  }
  // cross-series-show / cross-series-hide — same FoR, sibling series ⇒ read-only here.
  return {
    allowed: false,
    reason:
      'The active container is from a sibling series and is read-only here. Focus a viewport native to it, switch the active container, or create a new container tagged to this series.',
  };
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
    containerNativeVolume.set(segmentationId, referencedVolumeId); // native volume for A2c displacement (signal 10)
    for (const viewportId of viewportIds) {
      // FoR-eligibility gate (A2a–d): the native viewport(s) attach solid + active;
      // a same-FoR sibling series attaches non-native (dimmed) + read-only; a
      // different FoR is skipped. MPR-safe: every MPR panel shows the same series,
      // so each classifies `native` and attaches exactly as before.
      attachLabelmapWithEligibility(segmentationId, viewportId);
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
        containerNativeVolume.delete(segmentationId);
        continue;
      }
      try {
        // FoR-eligibility gate (A2a–d): native attaches solid + editable; a same-FoR
        // sibling series attaches non-native + read-only; a different FoR does not
        // attach here. Fails open to native when ids are unresolved.
        attachLabelmapWithEligibility(segmentationId, viewportId);
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
   * Apply the D9 non-native (dimmed) labelmap style to a segmentation on one viewport
   * and re-render (signal 9b). Same style attachLabelmapWithEligibility uses for a
   * cross-series sibling — exposed so the visible dimming can be exercised directly.
   */
  applyNonNativeLabelmapStyle(segmentationId: string, viewportId: string): void {
    try {
      csSegmentation.segmentationStyle.setStyle(
        { type: ToolEnums.SegmentationRepresentations.Labelmap, viewportId, segmentationId },
        nonNativeStyleFor('Labelmap') as never,
      );
      csToolUtilities.segmentation.triggerSegmentationRender(viewportId);
    } catch { /* best-effort */ }
  },

  /** Forget all tracked unified segmentations (test isolation). */
  reset(): void {
    created.clear();
    containerSpatial.clear();
    containerNativeVolume.clear();
    displacementCache.clear();
    voxelClip = null;
    voxelClipSourceFocal = null;
  },

  /** Test seam: record a container's native spatial identity directly. */
  _setContainerSpatialForTest(segmentationId: string, spatial: ContainerSpatialId): void {
    created.add(segmentationId);
    containerSpatial.set(segmentationId, spatial);
  },
};
