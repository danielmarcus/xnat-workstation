/**
 * RTSTRUCT parser roundtrip tests.
 *
 * These tests exercise the REAL dcmjs serialization path and the REAL
 * `rtStructService.parseRtStruct` parser end-to-end, without mocking
 * either side. Goal: catch regressions where the parser and dcmjs-written
 * fixtures disagree on tag structure, sequence nesting, or VR.
 *
 * Complement to the heavily-mocked `rtStructService.test.ts`, which tests
 * the service's orchestration logic against stubbed Cornerstone state.
 * This file is intentionally un-mocked — it loads real modules and only
 * skips the Cornerstone-state layer (by not calling `loadRtStructAsContours`).
 *
 * Also acts as a regression guard for the static adapter import introduced
 * in the "contour tuneup" work: a failure here means either the package's
 * export shape changed or the parser drifted from the DICOM spec.
 */
import { describe, expect, it, vi } from 'vitest';
import { data as dcmjsData } from 'dcmjs';
import { adaptersRT } from '@cornerstonejs/adapters';
import { rtStructService } from '../rtStructService';
import { serializeDerivedDicomDataset } from '../dicomExportHelpers';

// `dicomExportHelpers` pulls `writeDicomDict`, which is fine to run for real.
// `@cornerstonejs/dicom-image-loader` is only needed by the bigger compliance
// test because it touches wadouri caches; we shadow it to a no-op for safety
// in case any transitive code path references it.
vi.mock('@cornerstonejs/dicom-image-loader', () => ({
  wadouri: {
    dataSetCacheManager: {
      isLoaded: () => false,
      get: () => null,
    },
  },
}));

const CT_SOP_CLASS_UID = '1.2.840.10008.5.1.4.1.1.2';
const RTSTRUCT_SOP_CLASS_UID = '1.2.840.10008.5.1.4.1.1.481.3';

/**
 * Build a realistic RTSTRUCT ArrayBuffer with two ROIs of differing
 * contour geometry, so assertions can distinguish per-ROI ordering.
 */
function buildRoundtripFixture(): {
  arrayBuffer: ArrayBuffer;
  studyInstanceUID: string;
  sourceSeriesInstanceUID: string;
  sourceSopInstanceUIDs: string[];
  frameOfReferenceUID: string;
} {
  const studyInstanceUID = dcmjsData.DicomMetaDictionary.uid();
  const sourceSeriesInstanceUID = dcmjsData.DicomMetaDictionary.uid();
  const frameOfReferenceUID = dcmjsData.DicomMetaDictionary.uid();
  const sourceSopInstanceUIDs = [
    dcmjsData.DicomMetaDictionary.uid(),
    dcmjsData.DicomMetaDictionary.uid(),
  ];

  const dataset: Record<string, unknown> = {
    SOPClassUID: RTSTRUCT_SOP_CLASS_UID,
    SOPInstanceUID: dcmjsData.DicomMetaDictionary.uid(),
    Modality: 'RTSTRUCT',
    PatientName: 'Roundtrip^Patient',
    PatientID: 'RT-1',
    PatientBirthDate: '19700101',
    PatientSex: 'O',
    StudyInstanceUID: studyInstanceUID,
    StudyDate: '20260421',
    StudyTime: '120000',
    StudyID: '1',
    AccessionNumber: '1',
    StudyDescription: 'Roundtrip Study',
    ReferringPhysicianName: 'Tester^Terry',
    SeriesInstanceUID: dcmjsData.DicomMetaDictionary.uid(),
    SeriesNumber: '501',
    InstanceNumber: '1',
    FrameOfReferenceUID: frameOfReferenceUID,
    PositionReferenceIndicator: '',
    SeriesDescription: 'Roundtrip RTSTRUCT',
    StructureSetLabel: 'RT-TRIP',
    StructureSetName: 'Roundtrip Structure Set',
    StructureSetDescription: 'RT Structure Set for parser roundtrip test',
    OperatorsName: 'Tester^Terry',
    ReferencedFrameOfReferenceSequence: [
      {
        FrameOfReferenceUID: frameOfReferenceUID,
        RTReferencedStudySequence: [
          {
            ReferencedSOPClassUID: '1.2.840.10008.3.1.2.3.1',
            ReferencedSOPInstanceUID: studyInstanceUID,
            RTReferencedSeriesSequence: [
              {
                SeriesInstanceUID: sourceSeriesInstanceUID,
                ContourImageSequence: sourceSopInstanceUIDs.map((uid) => ({
                  ReferencedSOPClassUID: CT_SOP_CLASS_UID,
                  ReferencedSOPInstanceUID: uid,
                })),
              },
            ],
          },
        ],
      },
    ],
    StructureSetROISequence: [
      {
        ROINumber: 1,
        ReferencedFrameOfReferenceUID: frameOfReferenceUID,
        ROIName: 'Liver',
        ROIGenerationAlgorithm: 'MANUAL',
      },
      {
        ROINumber: 2,
        ReferencedFrameOfReferenceUID: frameOfReferenceUID,
        ROIName: 'Tumor',
        ROIGenerationAlgorithm: 'MANUAL',
      },
    ],
    ROIContourSequence: [
      {
        ReferencedROINumber: 1,
        ROIDisplayColor: [255, 100, 50],
        ContourSequence: [
          {
            ContourGeometricType: 'CLOSED_PLANAR',
            NumberOfContourPoints: 4,
            ContourNumber: 1,
            ContourImageSequence: [
              {
                ReferencedSOPClassUID: CT_SOP_CLASS_UID,
                ReferencedSOPInstanceUID: sourceSopInstanceUIDs[0],
              },
            ],
            ContourData: [
              '0', '0', '0',
              '1', '0', '0',
              '1', '1', '0',
              '0', '1', '0',
            ],
          },
          {
            ContourGeometricType: 'CLOSED_PLANAR',
            NumberOfContourPoints: 6,
            ContourNumber: 2,
            ContourImageSequence: [
              {
                ReferencedSOPClassUID: CT_SOP_CLASS_UID,
                ReferencedSOPInstanceUID: sourceSopInstanceUIDs[1],
              },
            ],
            ContourData: [
              '0', '0', '1',
              '2', '0', '1',
              '3', '1', '1',
              '2', '2', '1',
              '0', '2', '1',
              '-1', '1', '1',
            ],
          },
        ],
      },
      {
        ReferencedROINumber: 2,
        ROIDisplayColor: [50, 255, 100],
        ContourSequence: [
          {
            ContourGeometricType: 'CLOSED_PLANAR',
            NumberOfContourPoints: 3,
            ContourNumber: 1,
            ContourImageSequence: [
              {
                ReferencedSOPClassUID: CT_SOP_CLASS_UID,
                ReferencedSOPInstanceUID: sourceSopInstanceUIDs[0],
              },
            ],
            ContourData: [
              '0.5', '0.5', '0',
              '0.9', '0.5', '0',
              '0.7', '0.9', '0',
            ],
          },
        ],
      },
    ],
    RTROIObservationsSequence: [
      {
        ObservationNumber: 1,
        ReferencedROINumber: 1,
        ROIObservationLabel: 'Liver',
        RTROIInterpretedType: 'ORGAN',
        ROIInterpreter: '',
      },
      {
        ObservationNumber: 2,
        ReferencedROINumber: 2,
        ROIObservationLabel: 'Tumor',
        RTROIInterpretedType: 'PTV',
        ROIInterpreter: '',
      },
    ],
  };

  const { arrayBuffer } = serializeDerivedDicomDataset(dataset, {
    kind: 'RTSTRUCT',
    callerTag: 'rtStructService.roundtrip',
    defaultSOPClassUID: RTSTRUCT_SOP_CLASS_UID,
    requiredDatasetFields: [
      'SOPClassUID',
      'SOPInstanceUID',
      'StudyInstanceUID',
      'SeriesInstanceUID',
      'FrameOfReferenceUID',
      'Modality',
      'StructureSetLabel',
      'StructureSetROISequence',
      'ROIContourSequence',
      'RTROIObservationsSequence',
      'ReferencedFrameOfReferenceSequence',
    ],
    expectedDatasetValues: {
      Modality: 'RTSTRUCT',
      StudyInstanceUID: studyInstanceUID,
    },
    includeStructureSetDateTime: true,
  });

  return {
    arrayBuffer,
    studyInstanceUID,
    sourceSeriesInstanceUID,
    sourceSopInstanceUIDs,
    frameOfReferenceUID,
  };
}

describe('rtStructService parser roundtrip (real dcmjs + real parser)', () => {
  it('exposes generateRTSSFromContour on the statically-imported adapter', () => {
    // Regression guard for the silent-fail dynamic-import fallback that
    // rtStructService.ts used to carry. If the adapter package reshapes
    // its exports map, this test fails at assertion time rather than
    // silently at user-clicks-export time.
    const generate = (adaptersRT as any)?.Cornerstone3D?.RTSS?.generateRTSSFromContour;
    expect(typeof generate).toBe('function');
  });

  it('recovers structure-set identity from a dcmjs-written RTSTRUCT', () => {
    const { arrayBuffer } = buildRoundtripFixture();
    const parsed = rtStructService.parseRtStruct(arrayBuffer);

    expect(parsed.structureSetLabel).toBe('RT-TRIP');
    expect(parsed.structureSetName).toBe('Roundtrip Structure Set');
  });

  it('recovers the referenced series UID', () => {
    const { arrayBuffer, sourceSeriesInstanceUID } = buildRoundtripFixture();
    const parsed = rtStructService.parseRtStruct(arrayBuffer);

    expect(parsed.referencedSeriesUID).toBe(sourceSeriesInstanceUID);
  });

  it('recovers ROI count, names, colors, and interpreted types in input order', () => {
    const { arrayBuffer } = buildRoundtripFixture();
    const parsed = rtStructService.parseRtStruct(arrayBuffer);

    expect(parsed.rois).toHaveLength(2);

    const [liver, tumor] = parsed.rois;

    expect(liver.roiNumber).toBe(1);
    expect(liver.name).toBe('Liver');
    expect(liver.color).toEqual([255, 100, 50]);
    expect(liver.interpretedType).toBe('ORGAN');

    expect(tumor.roiNumber).toBe(2);
    expect(tumor.name).toBe('Tumor');
    expect(tumor.color).toEqual([50, 255, 100]);
    expect(tumor.interpretedType).toBe('PTV');
  });

  it('recovers per-ROI contour counts and point counts without reordering', () => {
    const { arrayBuffer } = buildRoundtripFixture();
    const parsed = rtStructService.parseRtStruct(arrayBuffer);

    const [liver, tumor] = parsed.rois;

    // Liver: 2 contours with 4 and 6 points (12 and 18 floats respectively)
    expect(liver.contours).toHaveLength(2);
    expect(liver.contours[0].points).toHaveLength(4 * 3);
    expect(liver.contours[1].points).toHaveLength(6 * 3);
    expect(liver.contours.every((c) => c.geometricType === 'CLOSED_PLANAR')).toBe(true);

    // Tumor: 1 contour with 3 points
    expect(tumor.contours).toHaveLength(1);
    expect(tumor.contours[0].points).toHaveLength(3 * 3);
    expect(tumor.contours[0].geometricType).toBe('CLOSED_PLANAR');
  });

  it('recovers contour coordinates (world-space, LPS) without loss', () => {
    const { arrayBuffer } = buildRoundtripFixture();
    const parsed = rtStructService.parseRtStruct(arrayBuffer);

    const liverFirstContour = parsed.rois[0].contours[0];
    expect(liverFirstContour.points).toEqual([
      0, 0, 0,
      1, 0, 0,
      1, 1, 0,
      0, 1, 0,
    ]);

    const tumorContour = parsed.rois[1].contours[0];
    expect(tumorContour.points).toEqual([0.5, 0.5, 0, 0.9, 0.5, 0, 0.7, 0.9, 0]);
  });

  it('recovers per-contour ReferencedSOPInstanceUID from ContourImageSequence', () => {
    const { arrayBuffer, sourceSopInstanceUIDs } = buildRoundtripFixture();
    const parsed = rtStructService.parseRtStruct(arrayBuffer);

    const [liver, tumor] = parsed.rois;

    // Liver contour 1 references source 0, contour 2 references source 1.
    expect(liver.contours[0].referencedSOPInstanceUID).toBe(sourceSopInstanceUIDs[0]);
    expect(liver.contours[1].referencedSOPInstanceUID).toBe(sourceSopInstanceUIDs[1]);

    // Tumor references source 0.
    expect(tumor.contours[0].referencedSOPInstanceUID).toBe(sourceSopInstanceUIDs[0]);
  });

  it('is stable across repeated parses of the same buffer', () => {
    const { arrayBuffer } = buildRoundtripFixture();
    const first = rtStructService.parseRtStruct(arrayBuffer);
    const second = rtStructService.parseRtStruct(arrayBuffer);

    expect(second.rois).toEqual(first.rois);
    expect(second.referencedSeriesUID).toBe(first.referencedSeriesUID);
    expect(second.structureSetLabel).toBe(first.structureSetLabel);
  });
});
