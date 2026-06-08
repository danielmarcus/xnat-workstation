#!/usr/bin/env node
/**
 * Synthetic DICOM fixture generator (annotation rebuild, Phase 0).
 *
 * Produces deterministic-shape, PHI-free DICOM datasets for offline E2E.
 * No network, no real patient data. UIDs are freshly generated per run via
 * dcmjs (DicomMetaDictionary.uid), so each regeneration is internally
 * consistent but not byte-identical across runs — fine for fixtures.
 *
 * Datasets:
 *   - ct-axial-300     : binary CT sphere phantom (uniform two-value intensity).
 *   - ct-axial-anatomy : intensity-varied CT (air / soft-tissue / bone / lesion)
 *                        with sharp boundaries between homogeneous regions, so
 *                        region-grow / paint-fill / threshold tolerance behavior
 *                        is deterministic.
 *
 * Usage:
 *   node e2e/fixtures/dicom/generate.cjs                  # all datasets
 *   node e2e/fixtures/dicom/generate.cjs ct-axial-anatomy # one dataset
 *
 * DICOM compliance (see CLAUDE.md): Explicit VR Little Endian, CT Image
 * Storage SOP class, well-formed UIDs, consistent Rows/Columns/PixelData,
 * signed 16-bit pixels with RescaleIntercept/Slope identity.
 */
const fs = require('fs');
const path = require('path');
const dcmjs = require('dcmjs');

const { DicomMetaDictionary, DicomDict } = dcmjs.data;

const TRANSFER_SYNTAX_EXPLICIT_VR_LE = '1.2.840.10008.1.2.1';
const CT_IMAGE_STORAGE = '1.2.840.10008.5.1.4.1.1.2';
const RTSTRUCT_STORAGE = '1.2.840.10008.5.1.4.1.1.481.3';
const SEG_STORAGE = '1.2.840.10008.5.1.4.1.1.66.4';
const MR_IMAGE_STORAGE = '1.2.840.10008.5.1.4.1.1.4';
const US_MULTIFRAME_STORAGE = '1.2.840.10008.5.1.4.1.1.3.1';
const DETACHED_STUDY_MGMT = '1.2.840.10008.3.1.2.3.1'; // RTReferencedStudy ReferencedSOPClassUID (legacy)

/**
 * Write a CT axial series. `voxel(x, y, z)` returns the HU value at the given
 * world coordinate in mm, measured relative to the volume center.
 */
function writeCtSeries(outDir, opts) {
  const {
    rows = 128,
    cols = 128,
    numSlices = 16,
    pixelSpacing = [1.0, 1.0], // mm [row, col]
    sliceThickness = 3.0, // mm
    seriesDescription,
    patientId,
    patientName,
    voxel,
    modality = 'CT',
    sopClassUID = CT_IMAGE_STORAGE,
    seriesNumber = 1,
    filePrefix = '',
  } = opts;

  const studyUID = opts.studyUID || DicomMetaDictionary.uid();
  const seriesUID = DicomMetaDictionary.uid();
  const frameOfReferenceUID = opts.frameOfReferenceUID || DicomMetaDictionary.uid();
  const implementationClassUID = DicomMetaDictionary.uid();

  fs.mkdirSync(outDir, { recursive: true });

  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  const cz = (numSlices - 1) / 2;
  const slices = [];

  for (let s = 0; s < numSlices; s++) {
    const sopInstanceUID = DicomMetaDictionary.uid();
    const pixels = new Int16Array(rows * cols);
    const z = (s - cz) * sliceThickness;
    let i = 0;
    for (let r = 0; r < rows; r++) {
      const y = (r - cy) * pixelSpacing[0];
      for (let c = 0; c < cols; c++) {
        const x = (c - cx) * pixelSpacing[1];
        pixels[i++] = voxel(x, y, z);
      }
    }

    const dataset = {
      SOPClassUID: sopClassUID,
      SOPInstanceUID: sopInstanceUID,
      StudyInstanceUID: studyUID,
      SeriesInstanceUID: seriesUID,
      FrameOfReferenceUID: frameOfReferenceUID,
      Modality: modality,
      PatientName: patientName,
      PatientID: patientId,
      PatientBirthDate: '',
      PatientSex: 'O',
      StudyID: '1',
      StudyDate: '20260101',
      StudyTime: '000000',
      AccessionNumber: '',
      SeriesNumber: seriesNumber,
      InstanceNumber: s + 1,
      SeriesDescription: seriesDescription,
      ImageType: ['DERIVED', 'SECONDARY', 'AXIAL'],
      Rows: rows,
      Columns: cols,
      SamplesPerPixel: 1,
      PhotometricInterpretation: 'MONOCHROME2',
      BitsAllocated: 16,
      BitsStored: 16,
      HighBit: 15,
      PixelRepresentation: 1, // signed (HU)
      RescaleIntercept: 0,
      RescaleSlope: 1,
      RescaleType: 'HU',
      PixelSpacing: pixelSpacing,
      SliceThickness: sliceThickness,
      SpacingBetweenSlices: sliceThickness,
      ImageOrientationPatient: [1, 0, 0, 0, 1, 0],
      ImagePositionPatient: [-cx * pixelSpacing[1], -cy * pixelSpacing[0], z],
      SliceLocation: z,
      WindowCenter: 0,
      WindowWidth: 2000,
      PixelData: pixels.buffer,
    };

    const meta = {
      FileMetaInformationVersion: new Uint8Array([0, 1]).buffer,
      MediaStorageSOPClassUID: sopClassUID,
      MediaStorageSOPInstanceUID: sopInstanceUID,
      TransferSyntaxUID: TRANSFER_SYNTAX_EXPLICIT_VR_LE,
      ImplementationClassUID: implementationClassUID,
      ImplementationVersionName: 'XNATWS_E2E_1',
    };

    const dicomDict = new DicomDict(DicomMetaDictionary.denaturalizeDataset(meta));
    dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(dataset);
    const buffer = dicomDict.write();

    const filename = `${filePrefix}slice-${String(s + 1).padStart(3, '0')}.dcm`;
    fs.writeFileSync(path.join(outDir, filename), Buffer.from(buffer));
    slices.push({ sopInstanceUID, z, ipp: [-cx * pixelSpacing[1], -cy * pixelSpacing[0], z] });
  }

  return { count: numSlices, rows, cols, studyUID, seriesUID, frameOfReferenceUID, pixelSpacing, slices };
}

function generateCtAxial300(outDir) {
  // Binary phantom: a single sphere of one intensity in air.
  const radiusMm = 24;
  return writeCtSeries(outDir, {
    seriesDescription: 'CT AXIAL 300 (sphere phantom)',
    patientId: 'CT-AXIAL-300',
    patientName: 'PHANTOM^SPHERE',
    voxel: (x, y, z) => (Math.sqrt(x * x + y * y + z * z) <= radiusMm ? 300 : -1000),
  });
}

function generateCtAxialAnatomy(outDir) {
  // Intensity-varied phantom: distinct uniform regions with sharp boundaries.
  //   air        = -1000 HU
  //   soft tissue=   +40 HU  (large homogeneous "body" sphere, r <= 50mm)
  //   lesion     =   +70 HU  (offset blob, distinct soft-tissue value)
  //   bone core  = +1000 HU  (centered sphere, r <= 14mm)
  return writeCtSeries(outDir, {
    seriesDescription: 'CT AXIAL ANATOMY (intensity-varied)',
    patientId: 'CT-AXIAL-ANATOMY',
    patientName: 'PHANTOM^ANATOMY',
    voxel: (x, y, z) => {
      const r = Math.sqrt(x * x + y * y + z * z);
      if (r <= 14) return 1000; // bone core
      const lr = Math.sqrt((x - 25) * (x - 25) + y * y + z * z);
      if (lr <= 8) return 70; // lesion
      if (r <= 50) return 40; // soft-tissue body
      return -1000; // air
    },
  });
}

function generateRtstructTyped(outDir) {
  // Emit a source CT (sphere phantom) + an RTSTRUCT that references it by the
  // SAME UIDs, with several ROIs covering distinct RTROIInterpretedType values.
  fs.mkdirSync(outDir, { recursive: true });
  const src = writeCtSeries(outDir, {
    seriesDescription: 'CT for RTSTRUCT-TYPED',
    patientId: 'RTSTRUCT-TYPED',
    patientName: 'PHANTOM^RTSTRUCT',
    voxel: (x, y, z) => (Math.sqrt(x * x + y * y + z * z) <= 24 ? 300 : -1000),
  });

  const mid = src.slices[Math.floor(src.slices.length / 2)];
  const z = mid.z;

  // ROIs covering distinct interpreted types; each a CLOSED_PLANAR square on
  // the mid slice (centered at origin), sized differently.
  const rois = [
    { num: 1, name: 'BODY', type: 'EXTERNAL', color: [0, 255, 0], half: 45 },
    { num: 2, name: 'GTV', type: 'GTV', color: [255, 0, 0], half: 12 },
    { num: 3, name: 'ORGAN', type: 'ORGAN', color: [0, 128, 255], half: 24 },
    { num: 4, name: 'MARKER', type: 'MARKER', color: [255, 255, 0], half: 6 },
  ];
  const square = (h) => [-h, -h, z, h, -h, z, h, h, z, -h, h, z];

  const allSliceRefs = src.slices.map((sl) => ({
    ReferencedSOPClassUID: CT_IMAGE_STORAGE,
    ReferencedSOPInstanceUID: sl.sopInstanceUID,
  }));

  const sopInstanceUID = DicomMetaDictionary.uid();
  const dataset = {
    SOPClassUID: RTSTRUCT_STORAGE,
    SOPInstanceUID: sopInstanceUID,
    StudyInstanceUID: src.studyUID,
    SeriesInstanceUID: DicomMetaDictionary.uid(),
    FrameOfReferenceUID: src.frameOfReferenceUID,
    Modality: 'RTSTRUCT',
    PatientName: 'PHANTOM^RTSTRUCT',
    PatientID: 'RTSTRUCT-TYPED',
    PatientBirthDate: '',
    PatientSex: 'O',
    StudyID: '1',
    StudyDate: '20260101',
    StudyTime: '000000',
    SeriesNumber: 99,
    InstanceNumber: 1,
    StructureSetLabel: 'RTSTRUCT-TYPED',
    StructureSetName: 'RTSTRUCT-TYPED',
    StructureSetDate: '20260101',
    StructureSetTime: '000000',
    ReferencedFrameOfReferenceSequence: [
      {
        FrameOfReferenceUID: src.frameOfReferenceUID,
        RTReferencedStudySequence: [
          {
            ReferencedSOPClassUID: DETACHED_STUDY_MGMT,
            ReferencedSOPInstanceUID: src.studyUID,
            RTReferencedSeriesSequence: [
              { SeriesInstanceUID: src.seriesUID, ContourImageSequence: allSliceRefs },
            ],
          },
        ],
      },
    ],
    StructureSetROISequence: rois.map((r) => ({
      ROINumber: r.num,
      ReferencedFrameOfReferenceUID: src.frameOfReferenceUID,
      ROIName: r.name,
      ROIGenerationAlgorithm: 'MANUAL',
    })),
    ROIContourSequence: rois.map((r) => ({
      ReferencedROINumber: r.num,
      ROIDisplayColor: r.color,
      ContourSequence: [
        {
          ContourImageSequence: [
            { ReferencedSOPClassUID: CT_IMAGE_STORAGE, ReferencedSOPInstanceUID: mid.sopInstanceUID },
          ],
          ContourGeometricType: 'CLOSED_PLANAR',
          NumberOfContourPoints: 4,
          ContourData: square(r.half),
        },
      ],
    })),
    RTROIObservationsSequence: rois.map((r) => ({
      ObservationNumber: r.num,
      ReferencedROINumber: r.num,
      RTROIInterpretedType: r.type,
      ROIInterpreter: '',
    })),
  };

  const meta = {
    FileMetaInformationVersion: new Uint8Array([0, 1]).buffer,
    MediaStorageSOPClassUID: RTSTRUCT_STORAGE,
    MediaStorageSOPInstanceUID: sopInstanceUID,
    TransferSyntaxUID: TRANSFER_SYNTAX_EXPLICIT_VR_LE,
    ImplementationClassUID: DicomMetaDictionary.uid(),
    ImplementationVersionName: 'XNATWS_E2E_1',
  };

  const dicomDict = new DicomDict(DicomMetaDictionary.denaturalizeDataset(meta));
  dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(dataset);
  fs.writeFileSync(path.join(outDir, 'rtstruct.dcm'), Buffer.from(dicomDict.write()));

  return { count: src.count + 1, rows: src.rows, cols: src.cols };
}

function generateSegMultilabel(outDir) {
  // Emit a source CT (sphere) + a multi-segment BINARY DICOM SEG referencing it
  // by shared UIDs. 5 segments, each on a distinct slice (a centered square of
  // varying size). DICOM SEG BINARY packs ALL frames as one continuous LSB-first
  // bitstream (no per-frame byte padding) — see CLAUDE.md DICOM Compliance.
  fs.mkdirSync(outDir, { recursive: true });
  const src = writeCtSeries(outDir, {
    seriesDescription: 'CT for SEG-MULTILABEL',
    patientId: 'SEG-MULTILABEL',
    patientName: 'PHANTOM^SEG',
    voxel: (x, y, z) => (Math.sqrt(x * x + y * y + z * z) <= 24 ? 300 : -1000),
  });

  const rows = src.rows;
  const cols = src.cols;
  const NUM_SEG = 5;
  const sliceIdx = [3, 5, 7, 9, 11]; // distinct slice per segment
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;

  // Continuous bitstream: bit index = frame * rows * cols + (r * cols + c).
  const totalBits = NUM_SEG * rows * cols;
  const pixelData = new Uint8Array(Math.ceil(totalBits / 8));

  const perFrameGroups = [];
  const segmentSequence = [];
  for (let s = 0; s < NUM_SEG; s++) {
    const seg = s + 1;
    const slice = src.slices[sliceIdx[s]];
    const half = 10 + s * 4; // varying square size
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (Math.abs(c - cx) <= half && Math.abs(r - cy) <= half) {
          const bit = s * rows * cols + (r * cols + c);
          pixelData[bit >> 3] |= 1 << (bit & 7);
        }
      }
    }
    perFrameGroups.push({
      FrameContentSequence: [{ DimensionIndexValues: [seg, s + 1] }],
      PlanePositionSequence: [{ ImagePositionPatient: slice.ipp }],
      PlaneOrientationSequence: [{ ImageOrientationPatient: [1, 0, 0, 0, 1, 0] }],
      SegmentIdentificationSequence: [{ ReferencedSegmentNumber: seg }],
      DerivationImageSequence: [
        {
          SourceImageSequence: [
            { ReferencedSOPClassUID: CT_IMAGE_STORAGE, ReferencedSOPInstanceUID: slice.sopInstanceUID },
          ],
          DerivationCodeSequence: [
            { CodeValue: '113076', CodingSchemeDesignator: 'DCM', CodeMeaning: 'Segmentation' },
          ],
        },
      ],
    });
    segmentSequence.push({
      SegmentNumber: seg,
      SegmentLabel: `Segment ${seg}`,
      SegmentAlgorithmType: 'MANUAL',
      SegmentedPropertyCategoryCodeSequence: [
        { CodeValue: '123037004', CodingSchemeDesignator: 'SCT', CodeMeaning: 'Anatomical Structure' },
      ],
      SegmentedPropertyTypeCodeSequence: [
        { CodeValue: '85756007', CodingSchemeDesignator: 'SCT', CodeMeaning: 'Tissue' },
      ],
    });
  }

  const sopInstanceUID = DicomMetaDictionary.uid();
  const dataset = {
    SOPClassUID: SEG_STORAGE,
    SOPInstanceUID: sopInstanceUID,
    StudyInstanceUID: src.studyUID,
    SeriesInstanceUID: DicomMetaDictionary.uid(),
    FrameOfReferenceUID: src.frameOfReferenceUID,
    Modality: 'SEG',
    PatientName: 'PHANTOM^SEG',
    PatientID: 'SEG-MULTILABEL',
    PatientBirthDate: '',
    PatientSex: 'O',
    StudyID: '1',
    StudyDate: '20260101',
    StudyTime: '000000',
    SeriesNumber: 98,
    InstanceNumber: 1,
    SeriesDescription: 'SEG MULTILABEL',
    ContentLabel: 'SEGMULTILABEL',
    ContentDescription: 'multilabel phantom',
    ContentCreatorName: 'XNATWS',
    SegmentationType: 'BINARY',
    Rows: rows,
    Columns: cols,
    SamplesPerPixel: 1,
    PhotometricInterpretation: 'MONOCHROME2',
    BitsAllocated: 1,
    BitsStored: 1,
    HighBit: 0,
    PixelRepresentation: 0,
    LossyImageCompression: '00',
    NumberOfFrames: NUM_SEG,
    SegmentSequence: segmentSequence,
    SharedFunctionalGroupsSequence: [
      {
        PlaneOrientationSequence: [{ ImageOrientationPatient: [1, 0, 0, 0, 1, 0] }],
        PixelMeasuresSequence: [
          { PixelSpacing: src.pixelSpacing, SliceThickness: 3.0, SpacingBetweenSlices: 3.0 },
        ],
      },
    ],
    PerFrameFunctionalGroupsSequence: perFrameGroups,
    DimensionOrganizationSequence: [{ DimensionOrganizationUID: DicomMetaDictionary.uid() }],
    ReferencedSeriesSequence: [
      {
        SeriesInstanceUID: src.seriesUID,
        ReferencedInstanceSequence: src.slices.map((sl) => ({
          ReferencedSOPClassUID: CT_IMAGE_STORAGE,
          ReferencedSOPInstanceUID: sl.sopInstanceUID,
        })),
      },
    ],
    PixelData: pixelData.buffer,
  };

  const meta = {
    FileMetaInformationVersion: new Uint8Array([0, 1]).buffer,
    MediaStorageSOPClassUID: SEG_STORAGE,
    MediaStorageSOPInstanceUID: sopInstanceUID,
    TransferSyntaxUID: TRANSFER_SYNTAX_EXPLICIT_VR_LE,
    ImplementationClassUID: DicomMetaDictionary.uid(),
    ImplementationVersionName: 'XNATWS_E2E_1',
  };

  const dicomDict = new DicomDict(DicomMetaDictionary.denaturalizeDataset(meta));
  dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(dataset);
  fs.writeFileSync(path.join(outDir, 'seg.dcm'), Buffer.from(dicomDict.write()));

  return { count: src.count + 1, rows, cols };
}

function generateMrT1T2SameExam(outDir) {
  // T1 + T2 MR of one exam — SAME study + SAME Frame of Reference.
  fs.mkdirSync(outDir, { recursive: true });
  const studyUID = DicomMetaDictionary.uid();
  const frameOfReferenceUID = DicomMetaDictionary.uid();
  const common = {
    modality: 'MR',
    sopClassUID: MR_IMAGE_STORAGE,
    studyUID,
    frameOfReferenceUID,
    patientId: 'MR-T1T2',
    patientName: 'PHANTOM^MRT1T2',
  };
  const t1 = writeCtSeries(outDir, {
    ...common, seriesNumber: 1, filePrefix: 't1-', seriesDescription: 'MR T1',
    voxel: (x, y, z) => (Math.sqrt(x * x + y * y + z * z) <= 30 ? 400 : 0),
  });
  const t2 = writeCtSeries(outDir, {
    ...common, seriesNumber: 2, filePrefix: 't2-', seriesDescription: 'MR T2',
    voxel: (x, y, z) => (Math.sqrt(x * x + y * y + z * z) <= 30 ? 900 : 0),
  });
  return { count: t1.count + t2.count, rows: t1.rows, cols: t1.cols };
}

function generateBreathHoldPair(outDir) {
  // Two CT breath-holds — SAME Frame of Reference, anatomy displaced (sphere
  // shifted) so structures from one land at a visibly wrong position on the other.
  fs.mkdirSync(outDir, { recursive: true });
  const studyUID = DicomMetaDictionary.uid();
  const frameOfReferenceUID = DicomMetaDictionary.uid();
  const common = { studyUID, frameOfReferenceUID, patientId: 'BREATH-HOLD', patientName: 'PHANTOM^BREATHHOLD' };
  const bh1 = writeCtSeries(outDir, {
    ...common, seriesNumber: 1, filePrefix: 'bh1-', seriesDescription: 'CT breath-hold 1',
    voxel: (x, y, z) => (Math.sqrt(x * x + y * y + z * z) <= 24 ? 300 : -1000),
  });
  const bh2 = writeCtSeries(outDir, {
    ...common, seriesNumber: 2, filePrefix: 'bh2-', seriesDescription: 'CT breath-hold 2',
    voxel: (x, y, z) => (Math.sqrt((x - 20) * (x - 20) + y * y + z * z) <= 24 ? 300 : -1000),
  });
  return { count: bh1.count + bh2.count, rows: bh1.rows, cols: bh1.cols };
}

function generateCrossForCtMr(outDir) {
  // Unregistered CT + MR — same study, DIFFERENT Frame of Reference (no SRO).
  fs.mkdirSync(outDir, { recursive: true });
  const studyUID = DicomMetaDictionary.uid();
  const ct = writeCtSeries(outDir, {
    studyUID, frameOfReferenceUID: DicomMetaDictionary.uid(),
    seriesNumber: 1, filePrefix: 'ct-', seriesDescription: 'CT (FoR A)',
    patientId: 'CROSS-FOR', patientName: 'PHANTOM^CROSSFOR',
    voxel: (x, y, z) => (Math.sqrt(x * x + y * y + z * z) <= 24 ? 300 : -1000),
  });
  const mr = writeCtSeries(outDir, {
    modality: 'MR', sopClassUID: MR_IMAGE_STORAGE,
    studyUID, frameOfReferenceUID: DicomMetaDictionary.uid(),
    seriesNumber: 2, filePrefix: 'mr-', seriesDescription: 'MR (FoR B)',
    patientId: 'CROSS-FOR', patientName: 'PHANTOM^CROSSFOR',
    voxel: (x, y, z) => (Math.sqrt(x * x + y * y + z * z) <= 30 ? 600 : 0),
  });
  return { count: ct.count + mr.count, rows: ct.rows, cols: ct.cols };
}

function generate4dctPhases(outDir) {
  // 4D-CT: several temporal phases sharing study + Frame of Reference, with the
  // sphere translated in z per phase (simulated motion). Supports Phase-5 cine /
  // dynamic scrolling. No §G acceptance signal yet (fixture exit-gate only).
  fs.mkdirSync(outDir, { recursive: true });
  const studyUID = DicomMetaDictionary.uid();
  const frameOfReferenceUID = DicomMetaDictionary.uid();
  const PHASES = 4;
  let total = 0;
  let dims = { rows: 128, cols: 128 };
  for (let p = 0; p < PHASES; p++) {
    const dz = (p - (PHASES - 1) / 2) * 6; // sphere moves in z across phases
    const r = writeCtSeries(outDir, {
      studyUID,
      frameOfReferenceUID,
      seriesNumber: p + 1,
      filePrefix: `p${p}-`,
      seriesDescription: `4DCT phase ${p}`,
      patientId: '4DCT',
      patientName: 'PHANTOM^4DCT',
      voxel: (x, y, z) => (Math.sqrt(x * x + y * y + (z - dz) * (z - dz)) <= 20 ? 300 : -1000),
    });
    total += r.count;
    dims = { rows: r.rows, cols: r.cols };
  }
  return { count: total, rows: dims.rows, cols: dims.cols };
}

function generateCineUs(outDir) {
  // Multi-frame ultrasound: ONE instance, NumberOfFrames > 1, 8-bit, with a
  // moving bright bar so frames differ + cine-rate tags. Supports Phase-5 cine.
  fs.mkdirSync(outDir, { recursive: true });
  const rows = 128;
  const cols = 128;
  const numFrames = 16;
  const pixels = new Uint8Array(rows * cols * numFrames);
  for (let f = 0; f < numFrames; f++) {
    const barX = Math.floor((f / (numFrames - 1)) * (cols - 1));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        pixels[f * rows * cols + r * cols + c] = Math.abs(c - barX) < 6 ? 220 : 40;
      }
    }
  }

  const sopInstanceUID = DicomMetaDictionary.uid();
  const dataset = {
    SOPClassUID: US_MULTIFRAME_STORAGE,
    SOPInstanceUID: sopInstanceUID,
    StudyInstanceUID: DicomMetaDictionary.uid(),
    SeriesInstanceUID: DicomMetaDictionary.uid(),
    Modality: 'US',
    PatientName: 'PHANTOM^US',
    PatientID: 'CINE-US',
    PatientBirthDate: '',
    PatientSex: 'O',
    StudyID: '1',
    StudyDate: '20260101',
    StudyTime: '000000',
    SeriesNumber: 1,
    InstanceNumber: 1,
    SeriesDescription: 'CINE US',
    NumberOfFrames: numFrames,
    Rows: rows,
    Columns: cols,
    SamplesPerPixel: 1,
    PhotometricInterpretation: 'MONOCHROME2',
    BitsAllocated: 8,
    BitsStored: 8,
    HighBit: 7,
    PixelRepresentation: 0,
    FrameTime: 33.33,
    CineRate: 30,
    RecommendedDisplayFrameRate: 30,
    PixelData: pixels.buffer,
  };

  const meta = {
    FileMetaInformationVersion: new Uint8Array([0, 1]).buffer,
    MediaStorageSOPClassUID: US_MULTIFRAME_STORAGE,
    MediaStorageSOPInstanceUID: sopInstanceUID,
    TransferSyntaxUID: TRANSFER_SYNTAX_EXPLICIT_VR_LE,
    ImplementationClassUID: DicomMetaDictionary.uid(),
    ImplementationVersionName: 'XNATWS_E2E_1',
  };

  const dicomDict = new DicomDict(DicomMetaDictionary.denaturalizeDataset(meta));
  dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(dataset);
  fs.writeFileSync(path.join(outDir, 'cine-us.dcm'), Buffer.from(dicomDict.write()));
  return { count: 1, rows, cols };
}

const GENERATORS = {
  'ct-axial-300': generateCtAxial300,
  'ct-axial-anatomy': generateCtAxialAnatomy,
  'rtstruct-typed': generateRtstructTyped,
  'seg-multilabel': generateSegMultilabel,
  'mr-t1-t2-sameexam': generateMrT1T2SameExam,
  'breath-hold-pair': generateBreathHoldPair,
  'cross-for-ct-mr': generateCrossForCtMr,
  '4dct-phases': generate4dctPhases,
  'cine-us': generateCineUs,
};

function main() {
  const requested = process.argv.slice(2);
  const names = requested.length > 0 ? requested : Object.keys(GENERATORS);
  const baseDir = __dirname;

  for (const name of names) {
    const gen = GENERATORS[name];
    if (!gen) {
      console.error(`[gen-fixtures] Unknown dataset: ${name}. Known: ${Object.keys(GENERATORS).join(', ')}`);
      process.exitCode = 1;
      continue;
    }
    const outDir = path.join(baseDir, name);
    const result = gen(outDir);
    console.log(`[gen-fixtures] ${name}: wrote ${result.count} file(s) to ${path.relative(process.cwd(), outDir)}`);
  }
}

main();
