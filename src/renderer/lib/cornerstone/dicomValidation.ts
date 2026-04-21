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
