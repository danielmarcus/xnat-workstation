/**
 * DICOM Validation — structural invariants for DICOM datasets produced or
 * consumed by this app. Throws `Error` with a descriptive message when the
 * dataset fails to meet a required invariant; callers can catch and surface
 * the message to the user or log pipeline.
 *
 * Scope:
 *   - `validateRtStructDataset`: alignment + sequence nesting for RTSTRUCT.
 *   - `collectContourImageReferencesFromRtStruct`: deduplicated list of
 *     ContourImage references used by export code, and enforces that every
 *     contour has a populated `ContourImageSequence` with a non-empty
 *     `ReferencedSOPInstanceUID`.
 *   - `normalizeContourImageSequenceItems`: helper to coerce a potentially
 *     single-item or missing ContourImageSequence into an array.
 *
 * Not in scope here: field-presence validators (kept in `dicomExportHelpers`
 * where they're tied to the serialization pipeline).
 */

/**
 * Coerce a DICOM numeric string or number to a positive integer, or null
 * if the value isn't parseable as one.
 *
 * Exported because both validation and metadata bridging in
 * `rtStructService` need the same parse rule.
 */
export function parsePositiveInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.trunc(value);
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

/**
 * Normalize a DICOM ContourImageSequence value (which can be a single
 * object, an array of objects, or missing) to an array of non-null object
 * items. Non-object entries are filtered out.
 */
export function normalizeContourImageSequenceItems(sequence: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(sequence)) {
    return sequence.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
  }
  if (sequence && typeof sequence === 'object') {
    return [sequence as Record<string, unknown>];
  }
  return [];
}

/**
 * Build a stable deduplication key for a ContourImage reference, based on
 * `ReferencedSOPInstanceUID` + optional `ReferencedFrameNumber`. Callers
 * use this to dedupe references when building the RTSTRUCT referenced
 * sequence tree during export.
 */
export function contourImageReferenceKey(item: { ReferencedSOPInstanceUID?: unknown; ReferencedFrameNumber?: unknown }): string {
  const sopInstanceUID = typeof item.ReferencedSOPInstanceUID === 'string'
    ? item.ReferencedSOPInstanceUID
    : '';
  const referencedFrameNumber = parsePositiveInt(item.ReferencedFrameNumber);
  return `${sopInstanceUID}|${referencedFrameNumber ?? ''}`;
}

/**
 * Walk an RTSTRUCT dataset's `ROIContourSequence` → `ContourSequence` →
 * `ContourImageSequence` and produce a deduplicated list of contour-image
 * references (by SOP Instance UID + optional frame number).
 *
 * Throws if any contour is missing `ContourImageSequence` or if any
 * reference lacks `ReferencedSOPInstanceUID`. Used both during export
 * (to build `ReferencedFrameOfReferenceSequence`) and as a liveness check
 * inside `validateRtStructDataset`.
 */
export function collectContourImageReferencesFromRtStruct(dataset: any): Array<Record<string, unknown>> {
  const references: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  const roiContourSequence = Array.isArray(dataset?.ROIContourSequence) ? dataset.ROIContourSequence : [];

  for (const roiContour of roiContourSequence) {
    const contourSequence = Array.isArray(roiContour?.ContourSequence) ? roiContour.ContourSequence : [];
    for (const contour of contourSequence) {
      const contourImageItems = normalizeContourImageSequenceItems(contour?.ContourImageSequence);
      if (contourImageItems.length === 0) {
        throw new Error('RTSTRUCT contour is missing ContourImageSequence.');
      }
      for (const contourImageItem of contourImageItems) {
        if (typeof contourImageItem.ReferencedSOPInstanceUID !== 'string' || !contourImageItem.ReferencedSOPInstanceUID) {
          throw new Error('RTSTRUCT contour image reference is missing ReferencedSOPInstanceUID.');
        }
        const normalizedRef: Record<string, unknown> = {
          ReferencedSOPClassUID:
            typeof contourImageItem.ReferencedSOPClassUID === 'string'
              ? contourImageItem.ReferencedSOPClassUID
              : undefined,
          ReferencedSOPInstanceUID: contourImageItem.ReferencedSOPInstanceUID,
        };
        const referencedFrameNumber = parsePositiveInt(contourImageItem.ReferencedFrameNumber);
        if (referencedFrameNumber) {
          normalizedRef.ReferencedFrameNumber = referencedFrameNumber;
        }

        const key = contourImageReferenceKey(normalizedRef);
        if (!seen.has(key)) {
          seen.add(key);
          references.push(normalizedRef);
        }
      }
    }
  }

  return references;
}

/**
 * Validate that an RTSTRUCT dataset has the required sequences, aligned ROI
 * numbers across Structure Set / ROI Contour / Observations sequences, and
 * a well-formed Referenced Frame of Reference tree.
 *
 * Throws `Error` on the first detected violation. Does not mutate.
 */
export function validateRtStructDataset(dataset: any): void {
  const structureSetROISequence = Array.isArray(dataset?.StructureSetROISequence)
    ? dataset.StructureSetROISequence
    : [];
  const roiContourSequence = Array.isArray(dataset?.ROIContourSequence)
    ? dataset.ROIContourSequence
    : [];
  const rtRoiObservationsSequence = Array.isArray(dataset?.RTROIObservationsSequence)
    ? dataset.RTROIObservationsSequence
    : [];

  if (structureSetROISequence.length === 0) {
    throw new Error('RTSTRUCT is missing StructureSetROISequence.');
  }
  if (roiContourSequence.length === 0) {
    throw new Error('RTSTRUCT is missing ROIContourSequence.');
  }
  if (rtRoiObservationsSequence.length === 0) {
    throw new Error('RTSTRUCT is missing RTROIObservationsSequence.');
  }

  const structureSetRoiNumbers = new Set(
    structureSetROISequence
      .map((item: any) => Number(item?.ROINumber))
      .filter((value: number) => Number.isFinite(value) && value > 0),
  );
  const roiContourNumbers = new Set(
    roiContourSequence
      .map((item: any) => Number(item?.ReferencedROINumber))
      .filter((value: number) => Number.isFinite(value) && value > 0),
  );
  const observationNumbers = new Set(
    rtRoiObservationsSequence
      .map((item: any) => Number(item?.ReferencedROINumber))
      .filter((value: number) => Number.isFinite(value) && value > 0),
  );

  if (
    structureSetRoiNumbers.size === 0
    || structureSetRoiNumbers.size !== roiContourNumbers.size
    || structureSetRoiNumbers.size !== observationNumbers.size
  ) {
    throw new Error('RTSTRUCT ROI sequences are not aligned by ROI number.');
  }

  for (const roiNumber of structureSetRoiNumbers) {
    if (!roiContourNumbers.has(roiNumber) || !observationNumbers.has(roiNumber)) {
      throw new Error(`RTSTRUCT ROI ${roiNumber} is missing a matching contour or observation entry.`);
    }
  }

  const referencedFrameOfReferenceSequence = Array.isArray(dataset?.ReferencedFrameOfReferenceSequence)
    ? dataset.ReferencedFrameOfReferenceSequence
    : [];
  if (referencedFrameOfReferenceSequence.length === 0) {
    throw new Error('RTSTRUCT is missing ReferencedFrameOfReferenceSequence.');
  }

  for (const frameRef of referencedFrameOfReferenceSequence) {
    const referencedStudySequence = Array.isArray(frameRef?.RTReferencedStudySequence)
      ? frameRef.RTReferencedStudySequence
      : [];
    if (referencedStudySequence.length === 0) {
      throw new Error('RTSTRUCT FrameOfReference item is missing RTReferencedStudySequence.');
    }
    for (const referencedStudy of referencedStudySequence) {
      const referencedSeriesSequence = Array.isArray(referencedStudy?.RTReferencedSeriesSequence)
        ? referencedStudy.RTReferencedSeriesSequence
        : [];
      if (referencedSeriesSequence.length === 0) {
        throw new Error('RTSTRUCT study reference is missing RTReferencedSeriesSequence.');
      }
      for (const referencedSeries of referencedSeriesSequence) {
        const contourImageSequence = normalizeContourImageSequenceItems(referencedSeries?.ContourImageSequence);
        if (contourImageSequence.length === 0) {
          throw new Error('RTSTRUCT referenced series is missing ContourImageSequence.');
        }
      }
    }
  }

  // Liveness check: walk every contour's ContourImageSequence. Throws on
  // any missing or malformed reference.
  collectContourImageReferencesFromRtStruct(dataset);
}

// ── Pre-upload IOD validation (MV-Phase 7.1, spec §13.3) ────────────────
// Mandated by CLAUDE.md §"DICOM Compliance": validate required tags before
// upload; flag non-conformant data rather than silently passing it through.

/** DICOM SEG Storage SOP Class UID. */
export const SEG_SOP_CLASS_UID = '1.2.840.10008.5.1.4.1.1.66.4';
/** DICOM RT Structure Set Storage SOP Class UID. */
export const RTSTRUCT_SOP_CLASS_UID = '1.2.840.10008.5.1.4.1.1.481.3';
/** DICOM Comprehensive SR Storage SOP Class UID. */
export const SR_COMPREHENSIVE_SOP_CLASS_UID = '1.2.840.10008.5.1.4.1.1.88.33';

/**
 * Required top-level tags per IOD, keyed by SOP Class UID. A tag is
 * "present" when the naturalized dataset has a non-nullish, non-empty
 * value for it (empty arrays and empty strings count as missing).
 */
const REQUIRED_TAGS_BY_SOP_CLASS: Record<string, string[]> = {
  [SEG_SOP_CLASS_UID]: [
    'Rows',
    'Columns',
    'NumberOfFrames',
    'SegmentSequence',
    'PixelData',
    'BitsAllocated',
    'BitsStored',
    'HighBit',
  ],
  [RTSTRUCT_SOP_CLASS_UID]: [
    'StructureSetROISequence',
    'ROIContourSequence',
    'RTROIObservationsSequence',
  ],
  [SR_COMPREHENSIVE_SOP_CLASS_UID]: [
    'ConceptNameCodeSequence',
    'ContentSequence',
  ],
};

const SOP_CLASS_DISPLAY_NAMES: Record<string, string> = {
  [SEG_SOP_CLASS_UID]: 'DICOM SEG',
  [RTSTRUCT_SOP_CLASS_UID]: 'DICOM RTSTRUCT',
  [SR_COMPREHENSIVE_SOP_CLASS_UID]: 'DICOM SR',
};

/**
 * Validation failure carrying the structured tag list so callers can
 * render a precise dialog ("missing: Rows, Columns") rather than a
 * generic error string.
 */
export class DicomValidationError extends Error {
  readonly missingTags: string[];
  readonly sopClassUid: string;

  constructor(sopClassUid: string, missingTags: string[]) {
    const name = SOP_CLASS_DISPLAY_NAMES[sopClassUid] ?? `SOP class ${sopClassUid}`;
    super(`${name} is missing required tag${missingTags.length === 1 ? '' : 's'}: ${missingTags.join(', ')}`);
    this.name = 'DicomValidationError';
    this.missingTags = missingTags;
    this.sopClassUid = sopClassUid;
  }
}

function isTagValuePresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * Validate a naturalized DICOM dataset against the required-tag list for
 * its SOP class (pure, synchronous). Throws `DicomValidationError` listing
 * every missing tag. Unknown SOP classes pass through without error — the
 * gate only enforces IODs it knows about.
 */
export function validateDatasetForUpload(dataset: Record<string, unknown>): void {
  const sopClassUid = typeof dataset?.SOPClassUID === 'string' ? dataset.SOPClassUID : '';
  const requiredTags = REQUIRED_TAGS_BY_SOP_CLASS[sopClassUid];
  if (!requiredTags) return;

  const missing = requiredTags.filter((tag) => !isTagValuePresent(dataset[tag]));
  if (missing.length > 0) {
    throw new DicomValidationError(sopClassUid, missing);
  }
}

/**
 * Decode a base64-encoded DICOM Part 10 buffer, naturalize it with dcmjs,
 * and run `validateDatasetForUpload`. Used by `xnatUploadService` as the
 * pre-upload gate (spec §13.3).
 *
 * dcmjs is imported dynamically: the upload path is already async, and the
 * dynamic import keeps this module's static graph dependency-free for
 * lightweight unit-test environments.
 */
export async function validateBase64ForUpload(base64: string): Promise<void> {
  const dcmjs = (await import('dcmjs')).default;
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);

  const message = dcmjs.data.DicomMessage.readFile(buffer);
  const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(message.dict) as Record<string, unknown>;
  validateDatasetForUpload(dataset);
}
