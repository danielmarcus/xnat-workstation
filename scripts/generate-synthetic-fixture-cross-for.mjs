#!/usr/bin/env node
/**
 * Generates the synthetic `cross-for-ct-mr` E2E fixture.
 *
 * Two series with DIFFERENT FrameOfReferenceUID — a CT and an MR.
 * Exercises the A2d "different FoR" branch of the cross-series
 * heuristic in segmentationService/visibility.ts: the structure-set
 * from one viewport must not display on the other, and the list panel
 * shows a "different frame of reference" indicator (signal §G #11).
 *
 * Run from the repo root:
 *
 *   node scripts/generate-synthetic-fixture-cross-for.mjs
 *
 * Output: 24 .dcm files (12 CT + 12 MR) under
 *   e2e/fixtures/dicom/cross-for-ct-mr/
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dcmjs = require('dcmjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'e2e', 'fixtures', 'dicom', 'cross-for-ct-mr');

const ROWS = 128;
const COLUMNS = 128;
const SLICES = 12;
const PIXEL_SPACING = 2.0;
const SLICE_THICKNESS = 2.5;

const UID_ROOT = '1.2.826.0.1.3680043.10.1338.996';
const STUDY_UID = `${UID_ROOT}.1`;
// Distinct FoRs is the whole point of this fixture.
const CT_FOR_UID = `${UID_ROOT}.10`;
const MR_FOR_UID = `${UID_ROOT}.20`;
const CT_SERIES_UID = `${UID_ROOT}.11`;
const MR_SERIES_UID = `${UID_ROOT}.21`;

const SERIES_DEFS = [
  {
    label: 'ct',
    sopClassUID: '1.2.840.10008.5.1.4.1.1.2',
    seriesUID: CT_SERIES_UID,
    forUID: CT_FOR_UID,
    modality: 'CT',
    description: 'Synthetic CT (cross-FoR pair)',
    pixelRepresentation: 1, // signed
    rescaleType: 'HU',
    background: -1000,
    foreground: 0,
  },
  {
    label: 'mr',
    sopClassUID: '1.2.840.10008.5.1.4.1.1.4', // MR Image Storage
    seriesUID: MR_SERIES_UID,
    forUID: MR_FOR_UID,
    modality: 'MR',
    description: 'Synthetic MR (cross-FoR pair)',
    pixelRepresentation: 0, // unsigned
    rescaleType: 'US',
    background: 50,
    foreground: 800,
  },
];

function buildSlice(def, sliceIndex) {
  const z = sliceIndex * SLICE_THICKNESS;
  const cx = (COLUMNS / 2) * PIXEL_SPACING;
  const cy = (ROWS / 2) * PIXEL_SPACING;
  const cz = (SLICES / 2) * SLICE_THICKNESS;
  const r = 25;

  const ArrayCtor = def.pixelRepresentation === 1 ? Int16Array : Uint16Array;
  const pixelData = new ArrayCtor(ROWS * COLUMNS);
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLUMNS; x++) {
      const px = x * PIXEL_SPACING;
      const py = y * PIXEL_SPACING;
      const dx = px - cx;
      const dy = py - cy;
      const dz = z - cz;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      pixelData[y * COLUMNS + x] = distance <= r ? def.foreground : def.background;
    }
  }
  return pixelData;
}

function buildDataset(def, sliceIndex) {
  const sopInstanceUID = `${def.seriesUID}.${sliceIndex + 1}`;
  const z = sliceIndex * SLICE_THICKNESS;

  const meta = {
    FileMetaInformationVersion: new Uint8Array([0x00, 0x01]).buffer,
    MediaStorageSOPClassUID: def.sopClassUID,
    MediaStorageSOPInstanceUID: sopInstanceUID,
    TransferSyntaxUID: '1.2.840.10008.1.2.1',
    ImplementationClassUID: `${UID_ROOT}.0`,
    ImplementationVersionName: 'XNAT-WS-SYNTH-1',
  };

  const dataset = {
    SOPClassUID: def.sopClassUID,
    SOPInstanceUID: sopInstanceUID,
    StudyInstanceUID: STUDY_UID,
    SeriesInstanceUID: def.seriesUID,
    FrameOfReferenceUID: def.forUID,
    Modality: def.modality,
    Manufacturer: 'XNAT-WS-SYNTH',
    ManufacturerModelName: 'cross-for-ct-mr',
    PatientName: 'Synthetic^Phantom',
    PatientID: 'XNAT-WS-SYNTH-004',
    PatientBirthDate: '',
    PatientSex: '',
    StudyID: '1',
    StudyDate: '20260101',
    StudyTime: '000000',
    AccessionNumber: 'SYNTH',
    SeriesNumber: def.label === 'ct' ? '100' : '200',
    AcquisitionNumber: '1',
    InstanceNumber: String(sliceIndex + 1),
    SeriesDescription: def.description,
    Rows: ROWS,
    Columns: COLUMNS,
    BitsAllocated: 16,
    BitsStored: 16,
    HighBit: 15,
    PixelRepresentation: def.pixelRepresentation,
    SamplesPerPixel: 1,
    PhotometricInterpretation: 'MONOCHROME2',
    PixelSpacing: [PIXEL_SPACING, PIXEL_SPACING],
    SliceThickness: SLICE_THICKNESS,
    SpacingBetweenSlices: SLICE_THICKNESS,
    SliceLocation: z,
    ImagePositionPatient: [0, 0, z],
    ImageOrientationPatient: [1, 0, 0, 0, 1, 0],
    RescaleIntercept: 0,
    RescaleSlope: 1,
    RescaleType: def.rescaleType,
    PixelData: buildSlice(def, sliceIndex).buffer,
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

  let written = 0;
  for (const def of SERIES_DEFS) {
    for (let sliceIndex = 0; sliceIndex < SLICES; sliceIndex++) {
      const fileName = `${def.label}-slice${String(sliceIndex + 1).padStart(2, '0')}.dcm`;
      await writeDataset(path.join(OUT_DIR, fileName), buildDataset(def, sliceIndex));
      written += 1;
    }
  }
  process.stdout.write(`Wrote ${written} synthetic DICOM files to ${OUT_DIR}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err.stack ?? err.message ?? err}\n`);
  process.exit(1);
});
