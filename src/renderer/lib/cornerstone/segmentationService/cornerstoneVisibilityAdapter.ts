/**
 * Cornerstone-backed metadata adapter for `visibility.ts`.
 *
 * Resolves the source identity (seriesUID + FoR + AcquisitionNumber) for the
 * three target shapes the classify* helpers need: viewports, segmentations,
 * and contour annotations. All lookups read from Cornerstone's metadata
 * provider and existing `sourceImageTracking` state.
 *
 * The adapter is built as a factory taking three lookup functions so tests
 * can pass synthetic stubs without module-level mocks. The default export
 * `cornerstoneVisibilityAdapter` wires the Cornerstone-backed lookups.
 *
 * Wired in `segmentationService.initialize()` via
 * `wireVisibility(cornerstoneVisibilityAdapter)`. Phase 2.4 + 2.5 consume
 * the classify* helpers; Phase 2.3 keeps the adapter passive (no callers).
 */
import { metaData, getEnabledElementByViewportId } from '@cornerstonejs/core';
import { annotation as csAnnotation } from '@cornerstonejs/tools';
import * as sourceImageTracking from '../sourceImageTracking';
import type {
  SourceIdentityForEligibility,
  VisibilityMetadataAdapter,
} from './visibility';

// ─── Lookup function shapes (DI seams for tests) ────────────────────────

/** Cornerstone's metaData.get(type, imageId). */
type MetaDataGet = (type: string, imageId: string) => unknown;

/**
 * Resolve a viewport's currently-displayed source-image imageId. Stack and
 * volume viewports both expose `viewport.getCurrentImageId()`.
 */
type ViewportImageIdLookup = (viewportId: string) => string | null;

/**
 * Resolve the first source-image imageId tracked for a Cornerstone
 * segmentation. Reads from `sourceImageTracking`.
 */
type SegmentationSourceImageIdLookup = (segmentationId: string) => string | null;

/** Lookup the metadata.referencedImageId on a Cornerstone annotation. */
type AnnotationReferencedImageIdLookup = (annotationUID: string) => string | null;

// ─── Pure conversion ────────────────────────────────────────────────────

/**
 * Resolve a source-image imageId to a `SourceIdentityForEligibility` triple.
 * Returns null when seriesUID or FoR is missing — both are required for any
 * meaningful classification. AcquisitionNumber is best-effort (null on
 * absence or non-numeric value).
 */
export function identityFromImageId(
  imageId: string,
  getMetaData: MetaDataGet,
): SourceIdentityForEligibility | null {
  if (!imageId) return null;

  const series = getMetaData('generalSeriesModule', imageId) as
    | { seriesInstanceUID?: string }
    | undefined;
  const plane = getMetaData('imagePlaneModule', imageId) as
    | { frameOfReferenceUID?: string }
    | undefined;
  const instance = getMetaData('instance', imageId) as
    | { AcquisitionNumber?: number | string | null }
    | undefined;

  const seriesUID = series?.seriesInstanceUID;
  const frameOfReferenceUID = plane?.frameOfReferenceUID;
  if (!seriesUID || !frameOfReferenceUID) return null;

  const rawAcq = instance?.AcquisitionNumber;
  let acquisitionNumber: number | null = null;
  if (rawAcq !== undefined && rawAcq !== null && rawAcq !== '') {
    const n = Number(rawAcq);
    acquisitionNumber = Number.isFinite(n) ? n : null;
  }

  return {
    seriesUID,
    frameOfReferenceUID,
    acquisitionNumber,
  };
}

// ─── Factory ────────────────────────────────────────────────────────────

export interface AdapterDeps {
  getMetaData: MetaDataGet;
  getViewportImageId: ViewportImageIdLookup;
  getSegmentationSourceImageId: SegmentationSourceImageIdLookup;
  getAnnotationReferencedImageId: AnnotationReferencedImageIdLookup;
}

export function createVisibilityAdapter(deps: AdapterDeps): VisibilityMetadataAdapter {
  return {
    getViewportSourceIdentity(viewportId: string) {
      const imageId = deps.getViewportImageId(viewportId);
      if (!imageId) return null;
      return identityFromImageId(imageId, deps.getMetaData);
    },
    getSegmentationSourceIdentity(segmentationId: string) {
      const imageId = deps.getSegmentationSourceImageId(segmentationId);
      if (!imageId) return null;
      return identityFromImageId(imageId, deps.getMetaData);
    },
    getAnnotationSourceIdentity(annotationUID: string) {
      const imageId = deps.getAnnotationReferencedImageId(annotationUID);
      if (!imageId) return null;
      return identityFromImageId(imageId, deps.getMetaData);
    },
  };
}

// ─── Default Cornerstone-wired lookups ──────────────────────────────────

function defaultViewportImageId(viewportId: string): string | null {
  try {
    const enabled = getEnabledElementByViewportId(viewportId) as
      | { viewport?: { getCurrentImageId?: () => string | null | undefined } }
      | null
      | undefined;
    const imageId = enabled?.viewport?.getCurrentImageId?.();
    return typeof imageId === 'string' && imageId.length > 0 ? imageId : null;
  } catch {
    return null;
  }
}

function defaultSegmentationSourceImageId(segmentationId: string): string | null {
  const ids = sourceImageTracking.getSourceImageIds(segmentationId);
  if (!ids || ids.length === 0) return null;
  return ids[0] ?? null;
}

function defaultAnnotationReferencedImageId(annotationUID: string): string | null {
  try {
    const getter = (csAnnotation.state as { getAnnotation?: (uid: string) => unknown }).getAnnotation;
    const ann = getter?.(annotationUID) as
      | { metadata?: { referencedImageId?: string } }
      | undefined;
    const refImageId = ann?.metadata?.referencedImageId;
    return typeof refImageId === 'string' && refImageId.length > 0 ? refImageId : null;
  } catch {
    return null;
  }
}

/** The default Cornerstone-backed adapter. Wired in segmentationService.initialize(). */
export const cornerstoneVisibilityAdapter: VisibilityMetadataAdapter =
  createVisibilityAdapter({
    getMetaData: (type, imageId) => metaData.get(type, imageId),
    getViewportImageId: defaultViewportImageId,
    getSegmentationSourceImageId: defaultSegmentationSourceImageId,
    getAnnotationReferencedImageId: defaultAnnotationReferencedImageId,
  });
