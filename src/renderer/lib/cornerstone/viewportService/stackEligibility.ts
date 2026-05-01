/**
 * Stack-eligibility predicate for the multi-viewport rewrite.
 *
 * Per design §1.1: every panel is created as `ViewportType.ORTHOGRAPHIC` by
 * default; stack mode is reserved for genuinely non-volumetric data. This
 * module owns the rule for "is this data volumetric or not."
 *
 * Phase 1: pure logic only. Consumed by `viewportService.createViewport()`
 * once the volume default lands behind the `multiviewport.enabled` flag.
 */
import { metaData } from '@cornerstonejs/core';

/** Modalities that are inherently non-volumetric. */
const STACK_MODALITIES = new Set<string>([
  'US',  // Ultrasound (often cine)
  'XA',  // X-ray Angiography
  'RF',  // Fluoroscopy
  'NM',  // Nuclear Medicine
  'DX',  // Digital Radiography
  'CR',  // Computed Radiography
  'MG',  // Mammography (single image)
]);

export type ViewportTypeKind = 'stack' | 'volume';

/**
 * Minimal metadata shape the predicate needs. Decoupled from the live
 * Cornerstone metadata provider so the function can be unit-tested with
 * synthetic input.
 */
export interface ImageMetadataForEligibility {
  /** DICOM `Modality` (0008,0060), e.g. "CT", "MR", "US". */
  modality: string | null;
  /** DICOM `NumberOfFrames` (0028,0008). 1 for single-frame; > 1 for multi-frame. */
  numberOfFrames: number | null;
  /**
   * True when the multi-frame DICOM has a `MultiFrameDimensionSequence` that
   * indicates a spatial dimension (i.e., a stack of slices, not a temporal
   * cine sequence). Used to keep multi-frame volumetric series in volume mode.
   */
  hasSpatialMultiFrameDimension: boolean;
}

/**
 * Decide which viewport type should display the given images.
 *
 * Rules (in order):
 *   1. Modality in {US, XA, RF, NM, DX, CR, MG} → stack.
 *   2. `NumberOfFrames > 1` AND no spatial multi-frame dimension → stack
 *      (multi-frame cine).
 *   3. Image count < 2 → stack (a single image isn't a volume).
 *   4. Otherwise → volume.
 *
 * @param meta - Metadata for the first image in the series (representative).
 * @param imageCount - Total number of imageIds being loaded.
 */
export function eligibleViewportType(
  meta: ImageMetadataForEligibility,
  imageCount: number,
): ViewportTypeKind {
  const modality = (meta.modality ?? '').toUpperCase().trim();

  if (modality && STACK_MODALITIES.has(modality)) {
    return 'stack';
  }

  if (
    typeof meta.numberOfFrames === 'number'
    && meta.numberOfFrames > 1
    && !meta.hasSpatialMultiFrameDimension
  ) {
    return 'stack';
  }

  if (imageCount < 2) {
    return 'stack';
  }

  return 'volume';
}

/**
 * Resolve the eligibility metadata for a representative imageId via the live
 * Cornerstone metadata provider. Reads `generalSeriesModule` (for modality)
 * and `multiframeModule` (for frame count + dimension info).
 *
 * Returns null when the image's metadata isn't yet cached. Callers should
 * defer the eligibility decision until metadata is available, or fall back
 * to stack mode (the historic default).
 */
export function readEligibilityMetadata(imageId: string): ImageMetadataForEligibility | null {
  const series = metaData.get('generalSeriesModule', imageId) as
    | { modality?: string }
    | undefined;
  if (!series) return null;

  const multiframe = metaData.get('multiframeModule', imageId) as
    | {
        NumberOfFrames?: number;
        DimensionOrganizationType?: string;
        DimensionIndexSequence?: ReadonlyArray<unknown>;
      }
    | undefined;

  const numberOfFrames = typeof multiframe?.NumberOfFrames === 'number'
    ? multiframe.NumberOfFrames
    : null;

  // A spatial multi-frame dimension is signaled by either:
  //   - DimensionOrganizationType = '3D' or '3D_TEMPORAL', or
  //   - presence of a DimensionIndexSequence whose pointer is to spatial tags
  // We keep this conservative: any DimensionIndexSequence present is treated
  // as evidence of structure beyond pure cine. False negatives (treating a
  // spatial multi-frame as cine) are safer than false positives — the worst
  // case is rendering as stack instead of volume, which we'd then have to
  // re-enable manually. False positives (treating cine as a volume) attempt
  // to build a 3D volume out of frames that don't form one.
  const dimensionType = (multiframe?.DimensionOrganizationType ?? '').toUpperCase();
  const hasSpatialMultiFrameDimension =
    dimensionType === '3D'
    || dimensionType === '3D_TEMPORAL'
    || (Array.isArray(multiframe?.DimensionIndexSequence)
        && multiframe.DimensionIndexSequence.length > 0);

  return {
    modality: series.modality ?? null,
    numberOfFrames,
    hasSpatialMultiFrameDimension,
  };
}
