/**
 * DICOM metadata types extracted for viewport overlay display.
 */

/** Metadata displayed in the four-corner viewport overlay */
export interface OverlayMetadata {
  // Top-left corner
  patientName: string;
  patientId: string;
  studyDate: string;

  // Top-right corner
  institutionName: string;
  seriesDescription: string;
  seriesNumber: string;

  // Bottom-left corner (dynamic per-slice)
  sliceLocation: string;
  sliceThickness: string;

  // Bottom-right corner
  rows: number;
  columns: number;
}

/** Empty overlay metadata for initial state */
export const EMPTY_OVERLAY: OverlayMetadata = {
  patientName: '',
  patientId: '',
  studyDate: '',
  institutionName: '',
  seriesDescription: '',
  seriesNumber: '',
  sliceLocation: '',
  sliceThickness: '',
  rows: 0,
  columns: 0,
};
