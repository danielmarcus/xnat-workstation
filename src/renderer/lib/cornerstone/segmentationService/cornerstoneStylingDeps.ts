/**
 * Cornerstone-backed dependency factory for the Phase 2.4 styling service.
 *
 * Wires `styling.ts`'s DI surface to the real Cornerstone APIs:
 *   - `csSegmentation.segmentationStyle.setStyle(specifier, styles, false)`
 *   - `csSegmentation.config.visibility.setSegmentationRepresentationVisibility(...)`
 *   - the local `getSegmentationType` orchestrator helper
 *   - `classifySegmentationOnViewport` from `visibility.ts`
 *   - `usePreferencesStore.getState().preferences.multiViewport`
 *
 * Sister to `cornerstoneVisibilityAdapter.ts`. Same factory pattern: the
 * DI seam (`StylingDeps` from styling.ts) is constructed once at service
 * init; tests pass synthetic stubs and never reach Cornerstone.
 */
import {
  Enums as ToolEnums,
  segmentation as csSegmentation,
} from '@cornerstonejs/tools';
import { usePreferencesStore } from '../../../stores/preferencesStore';
import * as containerBridge from '../containerBridge';
import { classifySegmentationOnViewport } from './visibility';
import type {
  CrossSeriesRenderingPolicy,
  EligibilityClass,
} from './visibility';
import type { SegmentationRepresentationKind, StylingDeps } from './styling';

function repKindToCsType(kind: SegmentationRepresentationKind) {
  return kind === 'Labelmap'
    ? ToolEnums.SegmentationRepresentations.Labelmap
    : ToolEnums.SegmentationRepresentations.Contour;
}

/**
 * Build the StylingDeps used by the Phase 2.4 visibility-styling service.
 *
 * `getRepresentationKinds` is provided by the orchestrator (segmentationService)
 * because the type-detection logic already exists there as `getSegmentationType`,
 * which returns 'labelmap' | 'contour' | 'both'.
 */
export function createCornerstoneStylingDeps(orchestratorDeps: {
  /**
   * Detect representation type for a segmentation. Mirrors the existing
   * `getSegmentationType` in segmentationService.ts.
   */
  getSegmentationType: (segmentationId: string) => 'labelmap' | 'contour' | 'both';
}): StylingDeps {
  return {
    setStyle(viewportId, segmentationId, kind, styles) {
      try {
        csSegmentation.segmentationStyle.setStyle(
          { type: repKindToCsType(kind), viewportId, segmentationId },
          styles as never,
          false, // replace, don't merge
        );
      } catch (err) {
        console.warn('[styling] setStyle failed', { viewportId, segmentationId, kind, err });
      }
    },
    resetStyle(viewportId, segmentationId, kind) {
      // Cornerstone has no per-(viewport, segmentation) clear in the public
      // surface; setStyle({}, false) replaces the override with an empty
      // object and Cornerstone falls back to global defaults for any
      // unspecified fields.
      try {
        csSegmentation.segmentationStyle.setStyle(
          { type: repKindToCsType(kind), viewportId, segmentationId },
          {} as never,
          false,
        );
      } catch (err) {
        console.warn('[styling] resetStyle failed', { viewportId, segmentationId, kind, err });
      }
    },
    setVisibility(viewportId, segmentationId, kind, visible) {
      try {
        csSegmentation.config.visibility.setSegmentationRepresentationVisibility(
          viewportId,
          { segmentationId, type: repKindToCsType(kind) },
          visible,
        );
      } catch (err) {
        console.warn('[styling] setVisibility failed', { viewportId, segmentationId, kind, err });
      }
    },
    getRepresentationKinds(segmentationId) {
      const t = orchestratorDeps.getSegmentationType(segmentationId);
      if (t === 'labelmap') return ['Labelmap'];
      if (t === 'contour') return ['Contour'];
      return ['Labelmap', 'Contour'];
    },
    classify(segmentationId, viewportId): EligibilityClass | null {
      return classifySegmentationOnViewport(segmentationId, viewportId);
    },
    readPolicy(segmentationId: string): CrossSeriesRenderingPolicy {
      const mv = usePreferencesStore.getState().preferences.multiViewport;
      const containerId = segmentationId
        ? containerBridge.getContainerId(segmentationId)
        : null;
      const a2cOptedIn = containerId
        ? !!containerBridge.getContainer(containerId)?.a2cOptedIn
        : false;
      return {
        enabled: mv.crossSeriesRendering,
        a2cOptedIn,
      };
    },
  };
}
