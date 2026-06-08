/**
 * Stack-eligibility predicate (Phase 1, design §1.1).
 *
 * Volume (`ORTHOGRAPHIC`) is the default; a STACK viewport is created ONLY for
 * genuinely non-volumetric data. The decision is driven by the data, not by a
 * user UI choice. This is a pure function — no Cornerstone, no side effects.
 */
export type ViewportType = 'volume' | 'stack';

export interface ViewportTypeInput {
  /** DICOM Modality (0008,0060). */
  modality?: string;
  /** Number of spatially-distinct images in the series. */
  imageCount?: number;
  /** NumberOfFrames (0028,0008) for a multi-frame instance. */
  numberOfFrames?: number;
  /**
   * Whether a multi-frame instance is spatially organized (3D) — i.e. its
   * MultiFrameDimensionSequence carries a spatial dimension. Leave undefined
   * for non-multi-frame data.
   */
  multiFrameIsSpatial?: boolean;
}

/** Inherently non-volumetric / projection-or-cine modalities → always stack. */
const NON_VOLUMETRIC_MODALITIES = new Set(['US', 'XA', 'RF']);
/** Single-frame projection radiography → stack. */
const PROJECTION_MODALITIES = new Set(['DX', 'CR', 'MG']);

/**
 * Choose the viewport type for a series. Volume by default; stack only when the
 * data is non-volumetric per design §1.1:
 *  - modality US/XA/RF (cine/projection), or planar NM;
 *  - a multi-frame instance with no spatial dimension (cine);
 *  - single-frame DX/CR/MG;
 *  - or simply too few spatial positions to form a volume.
 */
export function chooseViewportType(input: ViewportTypeInput): ViewportType {
  const modality = (input.modality ?? '').toUpperCase();
  const frames = input.numberOfFrames ?? 1;
  const images = input.imageCount ?? 1;

  // 1. Inherently non-volumetric / cine modalities.
  if (NON_VOLUMETRIC_MODALITIES.has(modality)) return 'stack';

  // 2. Single-frame projection radiography.
  if (PROJECTION_MODALITIES.has(modality) && frames <= 1 && images <= 1) return 'stack';

  // 3. Multi-frame instance explicitly NOT spatially organized (cine loop).
  if (frames > 1 && input.multiFrameIsSpatial === false) return 'stack';

  // 4. Planar NM (single projection). Volumetric NM/SPECT (multi-position) → volume.
  if (modality === 'NM' && images <= 1 && frames <= 1) return 'stack';

  // 5. Not enough spatial positions to build a volume (single image and not a
  //    spatial multi-frame instance).
  if (images <= 1 && !(frames > 1 && input.multiFrameIsSpatial === true)) return 'stack';

  // 6. Default: volumetric (CT, MR, PT, volumetric NM/SPECT, any multi-slice).
  return 'volume';
}
