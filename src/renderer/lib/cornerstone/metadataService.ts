/**
 * Metadata Service — extracts DICOM metadata from loaded images
 * using Cornerstone3D's metadata providers.
 *
 * The DICOM image loader automatically registers a metadata provider
 * that parses tags from loaded DICOM P10 files. This service provides
 * a clean interface for overlay data retrieval.
 */
import { metaData } from '@cornerstonejs/core';
import type { OverlayMetadata } from '@shared/types/dicom';
import { EMPTY_OVERLAY } from '@shared/types/dicom';
import type { MPRPlane } from '@shared/types/viewer';

/**
 * Format a DICOM date string (YYYYMMDD) to a readable format.
 */
function formatDicomDate(dateVal: unknown): string {
  if (dateVal === undefined || dateVal === null) return '';
  // DICOM values can arrive as objects — unwrap or skip
  if (typeof dateVal === 'object') {
    if ((dateVal as any).Alphabetic) dateVal = (dateVal as any).Alphabetic;
    else return '';
  }
  // DICOM dates can arrive as numbers (e.g. 20121231) — coerce to string
  const dateStr = String(dateVal);
  if (dateStr.length < 8) return dateStr;
  const year = dateStr.substring(0, 4);
  const month = dateStr.substring(4, 6);
  const day = dateStr.substring(6, 8);
  return `${year}-${month}-${day}`;
}

/**
 * Format a patient name from DICOM format (Last^First^Middle) to readable.
 */
function formatPatientName(name: unknown): string {
  if (!name) return '';
  // Handle object format { Alphabetic: "..." }
  if (typeof name === 'object') {
    if ((name as any).Alphabetic) {
      name = (name as any).Alphabetic;
    } else {
      return '';
    }
  }
  return String(name).replace(/\^/g, ', ');
}

/**
 * Safely convert a value to a display string.
 */
function toStr(val: unknown): string {
  if (val === undefined || val === null) return '';
  if (typeof val === 'number') {
    return Number.isInteger(val) ? String(val) : val.toFixed(2);
  }
  // Handle DICOM objects (e.g., PersonName { Alphabetic: "..." })
  if (typeof val === 'object') {
    if ((val as any).Alphabetic) return String((val as any).Alphabetic);
    return '';
  }
  return String(val);
}

export const metadataService = {
  /**
   * Infer native orientation from DICOM ImageOrientationPatient.
   * Uses the dominant component of the plane normal.
   */
  getNativeOrientation(imageId: string): MPRPlane | null {
    if (!imageId) return null;
    try {
      const imagePlane = metaData.get('imagePlaneModule', imageId) as any;
      const iop = imagePlane?.imageOrientationPatient;
      if (!Array.isArray(iop) || iop.length < 6) return null;
      const row = [Number(iop[0]), Number(iop[1]), Number(iop[2])];
      const col = [Number(iop[3]), Number(iop[4]), Number(iop[5])];
      if (![...row, ...col].every((v) => Number.isFinite(v))) return null;

      const normal: [number, number, number] = [
        row[1] * col[2] - row[2] * col[1],
        row[2] * col[0] - row[0] * col[2],
        row[0] * col[1] - row[1] * col[0],
      ];
      const abs = normal.map((v) => Math.abs(v));
      const max = Math.max(abs[0], abs[1], abs[2]);
      if (max === abs[0]) return 'SAGITTAL';
      if (max === abs[1]) return 'CORONAL';
      return 'AXIAL';
    } catch {
      return null;
    }
  },

  /**
   * Extract overlay metadata for a given imageId.
   * Returns empty strings/zeros for any missing fields.
   */
  getOverlayData(imageId: string): OverlayMetadata {
    if (!imageId) return { ...EMPTY_OVERLAY };

    try {
      const patient = metaData.get('patientModule', imageId) ?? {};
      const study = metaData.get('generalStudyModule', imageId) ?? {};
      const series = metaData.get('generalSeriesModule', imageId) ?? {};
      const imagePlane = metaData.get('imagePlaneModule', imageId) ?? {};
      const imagePixel = metaData.get('imagePixelModule', imageId) ?? {};

      return {
        patientName: formatPatientName(patient.patientName),
        patientId: toStr(patient.patientId),
        studyDate: formatDicomDate(study.studyDate),
        institutionName: toStr(study.institutionName),
        seriesDescription: toStr(series.seriesDescription),
        seriesNumber: toStr(series.seriesNumber),
        sliceLocation: toStr(imagePlane.sliceLocation),
        sliceThickness: toStr(imagePlane.sliceThickness),
        rows: imagePixel.rows ?? 0,
        columns: imagePixel.columns ?? 0,
      };
    } catch (err) {
      console.warn('[metadataService] Error reading metadata for', imageId, err);
      return { ...EMPTY_OVERLAY };
    }
  },
};
