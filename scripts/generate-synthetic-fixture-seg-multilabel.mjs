#!/usr/bin/env node
/**
 * Generates the synthetic `seg-multilabel` E2E fixture.
 *
 * One DICOM SEG instance with 5 segments (BINARY encoding, 1 frame
 * per segment). Geometry references the ct-axial-300 fixture's
 * StudyInstanceUID and a synthesized referenced-series so the SEG
 * load path has something coherent to bind to.
 *
 * Run from the repo root:
 *
 *   node scripts/generate-synthetic-fixture-seg-multilabel.mjs
 *
 * Output: 1 .dcm file under
 *   e2e/fixtures/dicom/seg-multilabel/
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dcmjs = require('dcmjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'e2e', 'fixtures', 'dicom', 'seg-multilabel');

const ROWS = 128;
const COLUMNS = 128;
const SEGMENTS = 5;
const FRAMES = SEGMENTS; // one frame per segment in this fixture
const PIXEL_SPACING = 2.0;
const SLICE_THICKNESS = 2.5;

// Same UID root as ct-axial-300 so the cross-references are coherent.
const CT_UID_ROOT = '1.2.826.0.1.3680043.10.1338.998';
const REFERENCED_STUDY_UID = `${CT_UID_ROOT}.1`;
const REFERENCED_SERIES_UID = `${CT_UID_ROOT}.2`;
const REFERENCED_FOR_UID = `${CT_UID_ROOT}.3`;

const SEG_UID_ROOT = '1.2.826.0.1.3680043.10.1338.995';
const SEG_SERIES_UID = `${SEG_UID_ROOT}.1`;
const SEG_INSTANCE_UID = `${SEG_UID_ROOT}.2`;

const SEGMENTS_DEF = [
  { number: 1, label: 'GTV',          recommendedDisplayCIELabValue: [50000, 32896, 32896] },
  { number: 2, label: 'CTV',          recommendedDisplayCIELabValue: [40000, 38000, 28000] },
  { number: 3, label: 'PTV',          recommendedDisplayCIELabValue: [60000, 30000, 35000] },
  { number: 4, label: 'OAR_BRAIN',    recommendedDisplayCIELabValue: [55000, 28000, 38000] },
  { number: 5, label: 'OAR_BRAINSTEM', recommendedDisplayCIELabValue: [45000, 36000, 30000] },
];

function buildBinaryFrame(segmentNumber) {
  // Each segment occupies a thin diagonal stripe so frames are
  // distinguishable byte-by-byte. Output is 1-bit-per-pixel, LSB-first
  // packing (the DICOM SEG BINARY convention).
  const totalBits = ROWS * COLUMNS;
  const bytes = new Uint8Array(Math.ceil(totalBits / 8));
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLUMNS; x++) {
      const inMask = Math.abs(x - y - (segmentNumber - 1) * 8) < 4;
      if (inMask) {
        const bitIndex = y * COLUMNS + x;
        const byteIndex = bitIndex >> 3;
        const bitInByte = bitIndex & 7;
        bytes[byteIndex] |= 1 << bitInByte;
      }
    }
  }
  return bytes;
}

function buildSegmentSequenceItem(seg) {
  return {
    SegmentNumber: seg.number,
    SegmentLabel: seg.label,
    SegmentAlgorithmType: 'SEMIAUTOMATIC',
    SegmentAlgorithmName: 'XNAT-WS-SYNTH',
    RecommendedDisplayCIELabValue: seg.recommendedDisplayCIELabValue,
    SegmentedPropertyCategoryCodeSequence: [
      {
        CodeValue: 'T-D000A',
        CodingSchemeDesignator: 'SRT',
        CodeMeaning: 'Anatomical Structure',
      },
    ],
    SegmentedPropertyTypeCodeSequence: [
      {
        CodeValue: '78961009',
        CodingSchemeDesignator: 'SCT',
        CodeMeaning: 'Tissue',
      },
    ],
  };
}

function buildPerFrameFunctionalGroup(seg, frameIndex) {
  const z = (frameIndex + 1) * SLICE_THICKNESS;
  return {
    PlanePositionSequence: [
      { ImagePositionPatient: [0, 0, z] },
    ],
    FrameContentSequence: [
      { DimensionIndexValues: [seg.number, frameIndex + 1] },
    ],
    SegmentIdentificationSequence: [
      { ReferencedSegmentNumber: seg.number },
    ],
    DerivationImageSequence: [
      {
        SourceImageSequence: [
          {
            ReferencedSOPClassUID: '1.2.840.10008.5.1.4.1.1.2',
            ReferencedSOPInstanceUID: `${REFERENCED_SERIES_UID}.${frameIndex + 1}`,
          },
        ],
        DerivationCodeSequence: [
          {
            CodeValue: '113076',
            CodingSchemeDesignator: 'DCM',
            CodeMeaning: 'Segmentation',
          },
        ],
      },
    ],
  };
}

function buildDataset() {
  const meta = {
    FileMetaInformationVersion: new Uint8Array([0x00, 0x01]).buffer,
    MediaStorageSOPClassUID: '1.2.840.10008.5.1.4.1.1.66.4', // Segmentation Storage
    MediaStorageSOPInstanceUID: SEG_INSTANCE_UID,
    TransferSyntaxUID: '1.2.840.10008.1.2.1',
    ImplementationClassUID: `${SEG_UID_ROOT}.0`,
    ImplementationVersionName: 'XNAT-WS-SYNTH-1',
  };

  // PixelData is the concatenation of every frame's packed binary mask.
  const frameByteLength = Math.ceil((ROWS * COLUMNS) / 8);
  const pixelBuffer = new Uint8Array(frameByteLength * FRAMES);
  for (let i = 0; i < SEGMENTS_DEF.length; i++) {
    const frame = buildBinaryFrame(SEGMENTS_DEF[i].number);
    pixelBuffer.set(frame, i * frameByteLength);
  }

  const perFrameGroups = SEGMENTS_DEF.map((seg, idx) =>
    buildPerFrameFunctionalGroup(seg, idx),
  );

  const dataset = {
    SOPClassUID: '1.2.840.10008.5.1.4.1.1.66.4',
    SOPInstanceUID: SEG_INSTANCE_UID,
    StudyInstanceUID: REFERENCED_STUDY_UID,
    SeriesInstanceUID: SEG_SERIES_UID,
    FrameOfReferenceUID: REFERENCED_FOR_UID,
    Modality: 'SEG',
    Manufacturer: 'XNAT-WS-SYNTH',
    ManufacturerModelName: 'seg-multilabel',
    PatientName: 'Synthetic^Phantom',
    PatientID: 'XNAT-WS-SYNTH-005',
    PatientBirthDate: '',
    PatientSex: '',
    StudyID: '1',
    StudyDate: '20260101',
    StudyTime: '000000',
    AccessionNumber: 'SYNTH',
    SeriesNumber: '300',
    InstanceNumber: '1',
    SeriesDescription: 'Synthetic SEG (5 segments)',
    SoftwareVersions: 'XNAT-WS-SYNTH-1',
    ContentLabel: 'SYNTH_SEG',
    ContentDescription: 'XNAT Workstation synthetic SEG fixture',
    ContentCreatorName: 'Synthetic^Generator',
    ImageType: ['DERIVED', 'PRIMARY'],
    SegmentationType: 'BINARY',
    Rows: ROWS,
    Columns: COLUMNS,
    NumberOfFrames: FRAMES,
    BitsAllocated: 1,
    BitsStored: 1,
    HighBit: 0,
    PixelRepresentation: 0,
    SamplesPerPixel: 1,
    PhotometricInterpretation: 'MONOCHROME2',
    LossyImageCompression: '00',
    SegmentSequence: SEGMENTS_DEF.map(buildSegmentSequenceItem),
    SharedFunctionalGroupsSequence: [
      {
        PixelMeasuresSequence: [
          {
            PixelSpacing: [PIXEL_SPACING, PIXEL_SPACING],
            SliceThickness: SLICE_THICKNESS,
            SpacingBetweenSlices: SLICE_THICKNESS,
          },
        ],
        PlaneOrientationSequence: [
          { ImageOrientationPatient: [1, 0, 0, 0, 1, 0] },
        ],
      },
    ],
    PerFrameFunctionalGroupsSequence: perFrameGroups,
    ReferencedSeriesSequence: [
      {
        SeriesInstanceUID: REFERENCED_SERIES_UID,
        ReferencedInstanceSequence: SEGMENTS_DEF.map((_, idx) => ({
          ReferencedSOPClassUID: '1.2.840.10008.5.1.4.1.1.2',
          ReferencedSOPInstanceUID: `${REFERENCED_SERIES_UID}.${idx + 1}`,
        })),
      },
    ],
    DimensionOrganizationSequence: [
      { DimensionOrganizationUID: `${SEG_UID_ROOT}.dim` },
    ],
    DimensionIndexSequence: [
      {
        DimensionOrganizationUID: `${SEG_UID_ROOT}.dim`,
        DimensionIndexPointer: '00620002',
        FunctionalGroupPointer: '0062000A',
        DimensionDescriptionLabel: 'ReferencedSegmentNumber',
      },
      {
        DimensionOrganizationUID: `${SEG_UID_ROOT}.dim`,
        DimensionIndexPointer: '00209157',
        FunctionalGroupPointer: '00209111',
        DimensionDescriptionLabel: 'FrameContentSequence',
      },
    ],
    PixelData: pixelBuffer.buffer,
  };

  return { dataset, meta };
}

async function writeDataset(filePath, { dataset, meta }) {
  const denatMeta = dcmjs.data.DicomMetaDictionary.denaturalizeDataset(meta);
  const denatDict = dcmjs.data.DicomMetaDictionary.denaturalizeDataset(dataset);
  const dict = new dcmjs.data.DicomDict(denatMeta);
  dict.dict = denatDict;
  await fs.writeFile(filePath, Buffer.from(dict.write()));
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  for (const entry of await fs.readdir(OUT_DIR)) {
    if (entry.endsWith('.dcm')) {
      await fs.unlink(path.join(OUT_DIR, entry));
    }
  }
  await writeDataset(path.join(OUT_DIR, 'seg-multilabel.dcm'), buildDataset());
  process.stdout.write(`Wrote 1 synthetic DICOM SEG file (${SEGMENTS} segments) to ${OUT_DIR}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err.stack ?? err.message ?? err}\n`);
  process.exit(1);
});
