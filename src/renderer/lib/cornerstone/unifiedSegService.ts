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
import { volumeLoader } from '@cornerstonejs/core';
import { segmentation as csSegmentation, Enums as ToolEnums } from '@cornerstonejs/tools';

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

  /** Forget all tracked unified segmentations (test isolation). */
  reset(): void {
    created.clear();
  },
};
