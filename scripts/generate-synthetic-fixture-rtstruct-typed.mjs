#!/usr/bin/env node
/**
 * Generates the synthetic `rtstruct-typed` E2E fixture.
 *
 * One DICOM RTSTRUCT instance with 6 ROIs covering the canonical
 * RTROIInterpretedType values: GTV, CTV, PTV, ORGAN, EXTERNAL,
 * AVOIDANCE. Each ROI has a single closed-planar contour of 6 points
 * on the same slice plane — enough for the load path to surface the
 * ROI in the structure-set list and round-trip the type back through
 * DICOM (signal §G #18).
 *
 * Run from the repo root:
 *
 *   node scripts/generate-synthetic-fixture-rtstruct-typed.mjs
 *
 * Output: 1 .dcm file under
 *   e2e/fixtures/dicom/rtstruct-typed/
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dcmjs = require('dcmjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'e2e', 'fixtures', 'dicom', 'rtstruct-typed');

// Cross-reference the ct-axial-300 fixture so the RTSTRUCT has a
// coherent referenced study/series.
const CT_UID_ROOT = '1.2.826.0.1.3680043.10.1338.998';
const REFERENCED_STUDY_UID = `${CT_UID_ROOT}.1`;
const REFERENCED_SERIES_UID = `${CT_UID_ROOT}.2`;
const REFERENCED_FOR_UID = `${CT_UID_ROOT}.3`;
const SLICE_THICKNESS = 2.5;

const RTSTRUCT_UID_ROOT = '1.2.826.0.1.3680043.10.1338.994';
const RTSTRUCT_SERIES_UID = `${RTSTRUCT_UID_ROOT}.1`;
const RTSTRUCT_INSTANCE_UID = `${RTSTRUCT_UID_ROOT}.2`;

const ROI_DEFS = [
  { number: 1, name: 'GTV_Phantom',        type: 'GTV',        color: [255, 0, 0],     centerX: 60,  centerY: 60 },
  { number: 2, name: 'CTV_Phantom',        type: 'CTV',        color: [255, 128, 0],   centerX: 120, centerY: 60 },
  { number: 3, name: 'PTV_Phantom',        type: 'PTV',        color: [255, 255, 0],   centerX: 180, centerY: 60 },
  { number: 4, name: 'BrainStem_Organ',    type: 'ORGAN',      color: [0, 255, 0],     centerX: 60,  centerY: 130 },
  { number: 5, name: 'External_Body',      type: 'EXTERNAL',   color: [0, 128, 255],   centerX: 120, centerY: 130 },
  { number: 6, name: 'Cochlea_Avoidance',  type: 'AVOIDANCE',  color: [200, 0, 200],   centerX: 180, centerY: 130 },
];

function buildHexagonContour(centerX, centerY, z, radius = 12) {
  // Six 3D points on the (x, y, z) plane, closed.
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const theta = (i * Math.PI) / 3;
    const x = centerX + radius * Math.cos(theta);
    const y = centerY + radius * Math.sin(theta);
    pts.push(x, y, z);
  }
  // Closed contour: first point repeated at the end.
  pts.push(pts[0], pts[1], pts[2]);
  return pts;
}

function buildStructureSetROI(roi) {
  return {
    ROINumber: roi.number,
    ReferencedFrameOfReferenceUID: REFERENCED_FOR_UID,
    ROIName: roi.name,
    ROIDescription: `Synthetic ${roi.type} for fixture testing`,
    ROIGenerationAlgorithm: 'MANUAL',
  };
}

function buildROIContour(roi, sliceIndex) {
  const z = (sliceIndex + 1) * SLICE_THICKNESS;
  const refSopUID = `${REFERENCED_SERIES_UID}.${sliceIndex + 1}`;
  return {
    ROIDisplayColor: roi.color,
    ReferencedROINumber: roi.number,
    ContourSequence: [
      {
        ContourGeometricType: 'CLOSED_PLANAR',
        NumberOfContourPoints: 7, // 6 hex vertices + closure
        ContourImageSequence: [
          {
            ReferencedSOPClassUID: '1.2.840.10008.5.1.4.1.1.2',
            ReferencedSOPInstanceUID: refSopUID,
          },
        ],
        ContourData: buildHexagonContour(roi.centerX, roi.centerY, z),
      },
    ],
  };
}

function buildRTROIObservation(roi) {
  return {
    ObservationNumber: roi.number,
    ReferencedROINumber: roi.number,
    ROIObservationLabel: roi.name,
    RTROIInterpretedType: roi.type,
    ROIInterpreter: '',
  };
}

function buildDataset() {
  const meta = {
    FileMetaInformationVersion: new Uint8Array([0x00, 0x01]).buffer,
    MediaStorageSOPClassUID: '1.2.840.10008.5.1.4.1.1.481.3', // RT Structure Set Storage
    MediaStorageSOPInstanceUID: RTSTRUCT_INSTANCE_UID,
    TransferSyntaxUID: '1.2.840.10008.1.2.1',
    ImplementationClassUID: `${RTSTRUCT_UID_ROOT}.0`,
    ImplementationVersionName: 'XNAT-WS-SYNTH-1',
  };

  // All ROIs land on the middle slice of the referenced ct-axial-300
  // series for visual coherence; doesn't actually matter for the load
  // path, but keeps the fixture self-consistent.
  const sliceIndex = 14;

  const dataset = {
    SOPClassUID: '1.2.840.10008.5.1.4.1.1.481.3',
    SOPInstanceUID: RTSTRUCT_INSTANCE_UID,
    StudyInstanceUID: REFERENCED_STUDY_UID,
    SeriesInstanceUID: RTSTRUCT_SERIES_UID,
    Modality: 'RTSTRUCT',
    Manufacturer: 'XNAT-WS-SYNTH',
    ManufacturerModelName: 'rtstruct-typed',
    PatientName: 'Synthetic^Phantom',
    PatientID: 'XNAT-WS-SYNTH-006',
    PatientBirthDate: '',
    PatientSex: '',
    StudyID: '1',
    StudyDate: '20260101',
    StudyTime: '000000',
    AccessionNumber: 'SYNTH',
    SeriesNumber: '400',
    InstanceNumber: '1',
    SeriesDescription: 'Synthetic RTSTRUCT (6 typed ROIs)',
    SoftwareVersions: 'XNAT-WS-SYNTH-1',
    ApprovalStatus: 'UNAPPROVED',
    StructureSetLabel: 'XNAT_WS_SYNTH_TYPED',
    StructureSetName: 'rtstruct-typed fixture',
    StructureSetDate: '20260101',
    StructureSetTime: '000000',

    ReferencedFrameOfReferenceSequence: [
      {
        FrameOfReferenceUID: REFERENCED_FOR_UID,
        RTReferencedStudySequence: [
          {
            ReferencedSOPClassUID: '1.2.840.10008.3.1.2.3.1', // Detached Study Mgmt
            ReferencedSOPInstanceUID: REFERENCED_STUDY_UID,
            RTReferencedSeriesSequence: [
              {
                SeriesInstanceUID: REFERENCED_SERIES_UID,
                ContourImageSequence: ROI_DEFS.map(() => ({
                  ReferencedSOPClassUID: '1.2.840.10008.5.1.4.1.1.2',
                  ReferencedSOPInstanceUID: `${REFERENCED_SERIES_UID}.${sliceIndex + 1}`,
                })),
              },
            ],
          },
        ],
      },
    ],

    StructureSetROISequence: ROI_DEFS.map(buildStructureSetROI),
    ROIContourSequence: ROI_DEFS.map((roi) => buildROIContour(roi, sliceIndex)),
    RTROIObservationsSequence: ROI_DEFS.map(buildRTROIObservation),
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
  await writeDataset(path.join(OUT_DIR, 'rtstruct-typed.dcm'), buildDataset());
  process.stdout.write(`Wrote 1 synthetic RTSTRUCT (${ROI_DEFS.length} ROIs) to ${OUT_DIR}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err.stack ?? err.message ?? err}\n`);
  process.exit(1);
});
