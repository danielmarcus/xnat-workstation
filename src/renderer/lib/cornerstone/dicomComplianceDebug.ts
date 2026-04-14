import { naturalizeDicomArrayBuffer } from './dicomExportHelpers';

export interface DicomComplianceSummary {
  modality?: string;
  sopClassUID?: string;
  sopInstanceUID?: string;
  studyInstanceUID?: string;
  seriesInstanceUID?: string;
  frameOfReferenceUID?: string;
  operatorsName?: unknown;
  manufacturer?: string;
  structureSetLabel?: string;
  segmentCount: number;
  roiCount: number;
  referencedFrameOfReferenceCount: number;
  mediaStorageSOPClassUID?: string;
  mediaStorageSOPInstanceUID?: string;
}

export function summarizeDicomArrayBufferForCompliance(arrayBuffer: ArrayBuffer): DicomComplianceSummary {
  const { dataset, meta } = naturalizeDicomArrayBuffer(arrayBuffer);

  return {
    modality: dataset.Modality,
    sopClassUID: dataset.SOPClassUID,
    sopInstanceUID: dataset.SOPInstanceUID,
    studyInstanceUID: dataset.StudyInstanceUID,
    seriesInstanceUID: dataset.SeriesInstanceUID,
    frameOfReferenceUID: dataset.FrameOfReferenceUID,
    operatorsName: dataset.OperatorsName,
    manufacturer: dataset.Manufacturer,
    structureSetLabel: dataset.StructureSetLabel,
    segmentCount: Array.isArray(dataset.SegmentSequence) ? dataset.SegmentSequence.length : 0,
    roiCount: Array.isArray(dataset.StructureSetROISequence) ? dataset.StructureSetROISequence.length : 0,
    referencedFrameOfReferenceCount: Array.isArray(dataset.ReferencedFrameOfReferenceSequence)
      ? dataset.ReferencedFrameOfReferenceSequence.length
      : 0,
    mediaStorageSOPClassUID: meta.MediaStorageSOPClassUID,
    mediaStorageSOPInstanceUID: meta.MediaStorageSOPInstanceUID,
  };
}
