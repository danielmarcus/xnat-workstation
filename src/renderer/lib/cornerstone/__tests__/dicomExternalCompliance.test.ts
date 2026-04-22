import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { data as dcmjsData } from 'dcmjs';
import * as adaptersPkg from '@cornerstonejs/adapters';
import { serializeDerivedDicomDataset } from '../dicomExportHelpers';
import { summarizeDicomArrayBufferForCompliance } from '../dicomComplianceDebug';

vi.mock('@cornerstonejs/dicom-image-loader', () => ({
  wadouri: {
    dataSetCacheManager: {
      isLoaded: () => false,
      get: () => null,
    },
  },
}));

const { adaptersSEG } = adaptersPkg as any;

const fixtureRoot = mkdtempSync(join(tmpdir(), 'xnatws-dicom-compliance-'));
const dciodvfyBin =
  process.env.DCIODVFY_BIN || process.env.DCIODVFY_FALLBACK_BIN || 'dciodvfy';
let segArrayBuffer: ArrayBuffer;
let rtStructArrayBuffer: ArrayBuffer;
let segSummary: ReturnType<typeof summarizeDicomArrayBufferForCompliance>;
let rtStructSummary: ReturnType<typeof summarizeDicomArrayBufferForCompliance>;

function commandAvailable(command: string): boolean {
  const result = spawnSync(command, ['-help'], { encoding: 'utf8' });
  if (result.error && 'code' in result.error && result.error.code === 'ENOENT') {
    return false;
  }
  return true;
}

function writeFixture(name: string, arrayBuffer: ArrayBuffer): string {
  mkdirSync(fixtureRoot, { recursive: true });
  const filePath = join(fixtureRoot, name);
  writeFileSync(filePath, Buffer.from(new Uint8Array(arrayBuffer)));
  return filePath;
}

function buildSegFixture(): ArrayBuffer {
  const ctSopClassUID = '1.2.840.10008.5.1.4.1.1.2';
  const studyInstanceUID = dcmjsData.DicomMetaDictionary.uid();
  const sourceSeriesInstanceUID = dcmjsData.DicomMetaDictionary.uid();
  const frameOfReferenceUID = dcmjsData.DicomMetaDictionary.uid();
  const sourceSopInstanceUIDs = [
    dcmjsData.DicomMetaDictionary.uid(),
    dcmjsData.DicomMetaDictionary.uid(),
  ];

  const sourceImages = [
    {
      imageId: 'fixture-ct-1',
      voxelManager: { getScalarData: () => new Uint16Array([0, 0, 0, 0]) },
    },
    {
      imageId: 'fixture-ct-2',
      voxelManager: { getScalarData: () => new Uint16Array([0, 0, 0, 0]) },
    },
  ];

  const labelmap3D = {
    labelmaps2D: [
      { pixelData: new Uint8Array([1, 0, 0, 0]), segmentsOnLabelmap: [1] },
      { pixelData: new Uint8Array([0, 0, 0, 0]), segmentsOnLabelmap: [] },
    ],
    metadata: [
      null,
      {
        SegmentLabel: 'Fixture Segment',
        SegmentDescription: 'Fixture Segment',
        SegmentNumber: 1,
        SegmentAlgorithmType: 'MANUAL',
        SegmentAlgorithmName: 'XNAT Workstation',
        SegmentedPropertyCategoryCodeSequence: {
          CodeValue: '91723000',
          CodingSchemeDesignator: 'SCT',
          CodeMeaning: 'Anatomical structure',
        },
        SegmentedPropertyTypeCodeSequence: {
          CodeValue: '85756007',
          CodingSchemeDesignator: 'SCT',
          CodeMeaning: 'Tissue',
        },
        RecommendedDisplayCIELabValue:
          dcmjsData.Colors.rgb2DICOMLAB?.([1, 0, 0]) ?? [65535, 32768, 32768],
      },
    ],
  };

  const metadataProvider = {
    get: (type: string, imageId: string) => {
      if (type === 'StudyData') {
        return {
          StudyInstanceUID: studyInstanceUID,
          PatientName: 'Fixture^Patient',
          PatientID: 'FIXTURE-1',
          PatientBirthDate: '19700101',
          PatientSex: 'O',
          StudyDate: '20260409',
          StudyTime: '120000',
          StudyID: '1001',
          AccessionNumber: '2002',
          StudyDescription: 'Compliance Fixture Study',
          ReferringPhysicianName: 'Validator^Victor',
        };
      }
      if (type === 'SeriesData') {
        return {
          SeriesInstanceUID: sourceSeriesInstanceUID,
          SeriesNumber: '7',
          Modality: 'CT',
        };
      }
      if (type === 'ImageData') {
        const index = imageId === 'fixture-ct-1' ? 0 : 1;
        return {
          SOPClassUID: ctSopClassUID,
          SOPInstanceUID: sourceSopInstanceUIDs[index],
          Rows: 2,
          Columns: 2,
          ImageType: ['ORIGINAL', 'PRIMARY', 'AXIAL'],
          ImageOrientationPatient: [1, 0, 0, 0, 1, 0],
          ImagePositionPatient: [0, 0, index],
          PixelSpacing: [1, 1],
          SliceThickness: '1',
          SpacingBetweenSlices: '1',
          FrameOfReferenceUID: frameOfReferenceUID,
          InstanceNumber: String(index + 1),
          PositionReferenceIndicator: '',
          SamplesPerPixel: 1,
          PhotometricInterpretation: 'MONOCHROME2',
          BitsAllocated: 16,
          BitsStored: 16,
          HighBit: 15,
          PixelRepresentation: 0,
        };
      }
      return undefined;
    },
  };

  const segDerivation = adaptersSEG.Cornerstone3D.Segmentation.generateSegmentation(
    sourceImages,
    labelmap3D,
    metadataProvider,
  );
  const dataset = segDerivation.dataset;
  dataset.PatientName = 'Fixture^Patient';
  dataset.PatientID = 'FIXTURE-1';
  dataset.PatientBirthDate = '19700101';
  dataset.PatientSex = 'O';
  dataset.StudyInstanceUID = studyInstanceUID;
  dataset.StudyDate = '20260409';
  dataset.StudyTime = '120000';
  dataset.StudyID = '1001';
  dataset.AccessionNumber = '2002';
  dataset.StudyDescription = 'Compliance Fixture Study';
  dataset.ReferringPhysicianName = 'Validator^Victor';
  dataset.FrameOfReferenceUID = frameOfReferenceUID;
  dataset.SeriesDescription = 'Compliance SEG Fixture';
  dataset.SeriesNumber = dataset.SeriesNumber || '301';
  dataset.InstanceNumber = dataset.InstanceNumber || '1';
  dataset.Modality = 'SEG';
  dataset.ContentLabel = 'FIXSEG';
  dataset.ContentDescription = 'Compliance SEG Fixture';
  dataset.ContentCreatorName = 'Validator^Victor';
  dataset.LossyImageCompression = '00';
  dataset.SharedFunctionalGroupsSequence ||= {};
  dataset.SharedFunctionalGroupsSequence.PixelMeasuresSequence = {
    PixelSpacing: [1, 1],
    SliceThickness: 1,
    SpacingBetweenSlices: 1,
  };
  dataset.SharedFunctionalGroupsSequence.PlaneOrientationSequence = {
    ImageOrientationPatient: [1, 0, 0, 0, 1, 0],
  };

  return serializeDerivedDicomDataset(dataset, {
    kind: 'SEG',
    callerTag: 'dicomExternalCompliance',
    defaultSOPClassUID: '1.2.840.10008.5.1.4.1.1.66.4',
    requiredDatasetFields: [
      'SOPClassUID',
      'SOPInstanceUID',
      'StudyInstanceUID',
      'SeriesInstanceUID',
      'Modality',
      'Rows',
      'Columns',
      'NumberOfFrames',
      'PixelData',
      'SegmentSequence',
      'PerFrameFunctionalGroupsSequence',
      'SharedFunctionalGroupsSequence',
    ],
    expectedDatasetValues: {
      Modality: 'SEG',
      StudyInstanceUID: studyInstanceUID,
    },
    includeContentDateTime: true,
  }).arrayBuffer;
}

function buildRtStructFixture(): ArrayBuffer {
  const ctSopClassUID = '1.2.840.10008.5.1.4.1.1.2';
  const studyInstanceUID = dcmjsData.DicomMetaDictionary.uid();
  const sourceSeriesInstanceUID = dcmjsData.DicomMetaDictionary.uid();
  const sourceSopInstanceUID = dcmjsData.DicomMetaDictionary.uid();
  const frameOfReferenceUID = dcmjsData.DicomMetaDictionary.uid();

  const dataset = {
    SOPClassUID: '1.2.840.10008.5.1.4.1.1.481.3',
    SOPInstanceUID: dcmjsData.DicomMetaDictionary.uid(),
    Modality: 'RTSTRUCT',
    PatientName: 'Fixture^Patient',
    PatientID: 'FIXTURE-1',
    PatientBirthDate: '19700101',
    PatientSex: 'O',
    StudyInstanceUID: studyInstanceUID,
    StudyDate: '20260409',
    StudyTime: '120000',
    StudyID: '1001',
    AccessionNumber: '2002',
    StudyDescription: 'Compliance Fixture Study',
    ReferringPhysicianName: 'Validator^Victor',
    SeriesInstanceUID: dcmjsData.DicomMetaDictionary.uid(),
    SeriesNumber: '401',
    InstanceNumber: '1',
    FrameOfReferenceUID: frameOfReferenceUID,
    PositionReferenceIndicator: '',
    SeriesDescription: 'Compliance RTSTRUCT Fixture',
    StructureSetLabel: 'FIXRT',
    StructureSetName: 'Compliance RTSTRUCT Fixture',
    StructureSetDescription: 'Compliance RTSTRUCT Fixture',
    OperatorsName: 'Validator^Victor',
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
                ContourImageSequence: [
                  {
                    ReferencedSOPClassUID: ctSopClassUID,
                    ReferencedSOPInstanceUID: sourceSopInstanceUID,
                  },
                ],
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
        ROIName: 'Fixture ROI',
        ROIGenerationAlgorithm: 'MANUAL',
      },
    ],
    ROIContourSequence: [
      {
        ReferencedROINumber: 1,
        ROIDisplayColor: [255, 0, 0],
        ContourSequence: [
          {
            ContourGeometricType: 'CLOSED_PLANAR',
            NumberOfContourPoints: 4,
            ContourNumber: 1,
            ContourImageSequence: [
              {
                ReferencedSOPClassUID: ctSopClassUID,
                ReferencedSOPInstanceUID: sourceSopInstanceUID,
              },
            ],
            ContourData: [
              '0', '0', '0',
              '1', '0', '0',
              '1', '1', '0',
              '0', '1', '0',
            ],
          },
        ],
      },
    ],
    RTROIObservationsSequence: [
      {
        ObservationNumber: 1,
        ReferencedROINumber: 1,
        ROIObservationLabel: 'Fixture ROI',
        RTROIInterpretedType: 'ORGAN',
        ROIInterpreter: '',
      },
    ],
  };

  return serializeDerivedDicomDataset(dataset, {
    kind: 'RTSTRUCT',
    callerTag: 'dicomExternalCompliance',
    defaultSOPClassUID: '1.2.840.10008.5.1.4.1.1.481.3',
    requiredDatasetFields: [
      'SOPClassUID',
      'SOPInstanceUID',
      'StudyInstanceUID',
      'SeriesInstanceUID',
      'FrameOfReferenceUID',
      'Modality',
      'StructureSetLabel',
      'StructureSetDate',
      'StructureSetTime',
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
  }).arrayBuffer;
}

beforeAll(() => {
  segArrayBuffer = buildSegFixture();
  rtStructArrayBuffer = buildRtStructFixture();

  segSummary = summarizeDicomArrayBufferForCompliance(segArrayBuffer);
  rtStructSummary = summarizeDicomArrayBufferForCompliance(rtStructArrayBuffer);

  expect(segSummary).toMatchObject({
    modality: 'SEG',
    segmentCount: 1,
  });
  expect(rtStructSummary).toMatchObject({
    modality: 'RTSTRUCT',
    roiCount: 1,
    referencedFrameOfReferenceCount: 1,
  });

  writeFixture('fixture-seg.dcm', segArrayBuffer);
  writeFixture('fixture-rtstruct.dcm', rtStructArrayBuffer);
});

describe('external DICOM compliance', () => {
  it('preserves key RTSTRUCT study identity and file meta fields in generated bytes', () => {
    const file = dcmjsData.DicomMessage.readFile(rtStructArrayBuffer);
    const dataset = dcmjsData.DicomMetaDictionary.naturalizeDataset(file.dict);
    const meta = dcmjsData.DicomMetaDictionary.naturalizeDataset(file.meta);
    const referencedStudySequence = dataset.ReferencedFrameOfReferenceSequence?.[0]?.RTReferencedStudySequence ?? [];
    const referencedStudyUID = referencedStudySequence[0]?.ReferencedSOPInstanceUID;

    expect(dataset.Modality).toBe('RTSTRUCT');
    expect(dataset.StudyInstanceUID).toBeTruthy();
    expect(referencedStudyUID).toBe(dataset.StudyInstanceUID);
    expect(dataset.SOPClassUID).toBe('1.2.840.10008.5.1.4.1.1.481.3');
    expect(meta.MediaStorageSOPClassUID).toBe(dataset.SOPClassUID);
    expect(meta.MediaStorageSOPInstanceUID).toBe(dataset.SOPInstanceUID);
  });

  it('keeps the RTSTRUCT contour reference tree populated and aligned', () => {
    const file = dcmjsData.DicomMessage.readFile(rtStructArrayBuffer);
    const dataset = dcmjsData.DicomMetaDictionary.naturalizeDataset(file.dict);
    const referencedFrameOfReference = dataset.ReferencedFrameOfReferenceSequence?.[0];
    const referencedStudy = referencedFrameOfReference?.RTReferencedStudySequence?.[0];
    const referencedSeries = referencedStudy?.RTReferencedSeriesSequence?.[0];
    const contourImage = referencedSeries?.ContourImageSequence?.[0];
    const roi = dataset.StructureSetROISequence?.[0];
    const roiContour = dataset.ROIContourSequence?.[0];
    const observation = dataset.RTROIObservationsSequence?.[0];

    expect(referencedFrameOfReference?.FrameOfReferenceUID).toBe(dataset.FrameOfReferenceUID);
    expect(referencedSeries?.SeriesInstanceUID).toBeTruthy();
    expect(contourImage?.ReferencedSOPInstanceUID).toBeTruthy();
    expect(roi?.ROINumber).toBe(1);
    expect(roiContour?.ReferencedROINumber).toBe(roi?.ROINumber);
    expect(observation?.ReferencedROINumber).toBe(roi?.ROINumber);
    expect(rtStructSummary.referencedFrameOfReferenceCount).toBe(1);
    expect(rtStructSummary.roiCount).toBe(1);
  });

  it('preserves key SEG study identity and file meta fields in generated bytes', () => {
    const file = dcmjsData.DicomMessage.readFile(segArrayBuffer);
    const dataset = dcmjsData.DicomMetaDictionary.naturalizeDataset(file.dict);
    const meta = dcmjsData.DicomMetaDictionary.naturalizeDataset(file.meta);

    expect(dataset.Modality).toBe('SEG');
    expect(dataset.StudyInstanceUID).toBeTruthy();
    expect(dataset.ReferencedSeriesSequence?.[0]?.SeriesInstanceUID).toBeTruthy();
    expect(meta.MediaStorageSOPClassUID).toBe(dataset.SOPClassUID);
    expect(meta.MediaStorageSOPInstanceUID).toBe(dataset.SOPInstanceUID);
    expect(segSummary.segmentCount).toBe(1);
  });

  // Skip the external-validator test on dev machines without the binary, but
  // still fail loudly in CI (where `CI=true` is always set and dicom3tools is
  // installed by .github/workflows/ci.yml). This prevents dev-machine false
  // positives without weakening CI coverage — a CI-side regression still
  // surfaces via the hard `expect(commandAvailable(...)).toBe(true)` below.
  const dciodvfyAvailable = commandAvailable(dciodvfyBin);
  const inCi = Boolean(process.env.CI);
  const skipExternalValidator = !dciodvfyAvailable && !inCi;

  it.skipIf(skipExternalValidator)('validates generated SEG and RTSTRUCT fixtures with dciodvfy', () => {
    expect(commandAvailable(dciodvfyBin)).toBe(true);

    for (const fixtureName of ['fixture-seg.dcm', 'fixture-rtstruct.dcm']) {
      const fixtureFile = join(fixtureRoot, fixtureName);
      const result = spawnSync(dciodvfyBin, ['-new', fixtureFile], { encoding: 'utf8' });
      const combinedOutput = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
      expect(result.status, combinedOutput || `dciodvfy failed for ${fixtureFile}`).toBe(0);
    }
  });
});
