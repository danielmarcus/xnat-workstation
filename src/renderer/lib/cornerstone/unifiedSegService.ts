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
import { volumeLoader, getRenderingEngine } from '@cornerstonejs/core';
import {
  segmentation as csSegmentation,
  Enums as ToolEnums,
  utilities as csToolUtilities,
} from '@cornerstonejs/tools';
import { canComputeRequestedRepresentation, computeLabelmapData } from '@cornerstonejs/polymorphic-segmentation';
import { viewportService } from './viewportService';

let counter = 0;
/** Segmentations created on the unified path, so they can be re-attached to
 *  viewports that (re)mount after a layout change. */
const created = new Set<string>();

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
    for (const viewportId of viewportIds) {
      csSegmentation.addLabelmapRepresentationToViewport(viewportId, [{ segmentationId }]);
      try {
        csSegmentation.activeSegmentation.setActiveSegmentation(viewportId, segmentationId);
      } catch {
        /* viewport may not be ready; representation add already queued */
      }
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
        continue;
      }
      try {
        csSegmentation.addLabelmapRepresentationToViewport(viewportId, [{ segmentationId }]);
        csSegmentation.activeSegmentation.setActiveSegmentation(viewportId, segmentationId);
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

  /** Forget all tracked unified segmentations (test isolation). */
  reset(): void {
    created.clear();
  },
};
