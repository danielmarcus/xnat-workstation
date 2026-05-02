#!/usr/bin/env node
/**
 * Generates the synthetic `ct-axial-300` E2E fixture.
 *
 * One axial CT series, 30 slices, 128x128, 16-bit signed. Sphere
 * phantom centered in-volume so a future canvas-render acceptance
 * test has visible anatomy. Used by the Phase 1 baseline (volume-mode
 * rendering, MPR preset) once the live-XNAT specs migrate to local
 * fixtures via __XNAT_E2E__.loadLocalDicomFiles.
 *
 * Run from the repo root:
 *
 *   node scripts/generate-synthetic-fixture-ct-axial.mjs
 *
 * Output: 30 .dcm files under
 *   e2e/fixtures/dicom/ct-axial-300/
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dcmjs = require('dcmjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'e2e', 'fixtures', 'dicom', 'ct-axial-300');

const ROWS = 128;
const COLUMNS = 128;
const SLICES = 30;
const PIXEL_SPACING = 2.0;
const SLICE_THICKNESS = 2.5;

const UID_ROOT = '1.2.826.0.1.3680043.10.1338.998';
const STUDY_UID = `${UID_ROOT}.1`;
const SERIES_UID = `${UID_ROOT}.2`;
const FRAME_OF_REFERENCE_UID = `${UID_ROOT}.3`;

function buildSlice(sliceIndex) {
  const z = sliceIndex * SLICE_THICKNESS;
  const sphereCenterX = (COLUMNS / 2) * PIXEL_SPACING;
  const sphereCenterY = (ROWS / 2) * PIXEL_SPACING;
  const sphereCenterZ = (SLICES / 2) * SLICE_THICKNESS;
  const sphereRadius = 30; // mm

  const pixelData = new Int16Array(ROWS * COLUMNS);
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLUMNS; x++) {
      const px = x * PIXEL_SPACING;
      const py = y * PIXEL_SPACING;
      const dx = px - sphereCenterX;
      const dy = py - sphereCenterY;
      const dz = z - sphereCenterZ;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      pixelData[y * COLUMNS + x] = distance <= sphereRadius ? 0 : -1000;
    }
  }
  return pixelData;
}

function buildDataset(sliceIndex) {
  const sopInstanceUID = `${SERIES_UID}.${sliceIndex + 1}`;
  const z = sliceIndex * SLICE_THICKNESS;

  const meta = {
    FileMetaInformationVersion: new Uint8Array([0x00, 0x01]).buffer,
    MediaStorageSOPClassUID: '1.2.840.10008.5.1.4.1.1.2',
    MediaStorageSOPInstanceUID: sopInstanceUID,
    TransferSyntaxUID: '1.2.840.10008.1.2.1',
    ImplementationClassUID: `${UID_ROOT}.0`,
    ImplementationVersionName: 'XNAT-WS-SYNTH-1',
  };

  const dataset = {
    SOPClassUID: '1.2.840.10008.5.1.4.1.1.2',
    SOPInstanceUID: sopInstanceUID,
    StudyInstanceUID: STUDY_UID,
    SeriesInstanceUID: SERIES_UID,
    FrameOfReferenceUID: FRAME_OF_REFERENCE_UID,
    Modality: 'CT',
    Manufacturer: 'XNAT-WS-SYNTH',
    ManufacturerModelName: 'ct-axial-300',
    PatientName: 'Synthetic^Phantom',
    PatientID: 'XNAT-WS-SYNTH-002',
    PatientBirthDate: '',
    PatientSex: '',
    StudyID: '1',
    StudyDate: '20260101',
    StudyTime: '000000',
    AccessionNumber: 'SYNTH',
    SeriesNumber: '100',
    AcquisitionNumber: '1',
    InstanceNumber: String(sliceIndex + 1),
    SeriesDescription: 'Synthetic Axial CT 30 slices',
    Rows: ROWS,
    Columns: COLUMNS,
    BitsAllocated: 16,
    BitsStored: 16,
    HighBit: 15,
    PixelRepresentation: 1,
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
    RescaleType: 'HU',
    KVP: 120,
    PixelData: buildSlice(sliceIndex).buffer,
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
  for (let sliceIndex = 0; sliceIndex < SLICES; sliceIndex++) {
    const fileName = `slice${String(sliceIndex + 1).padStart(3, '0')}.dcm`;
    await writeDataset(path.join(OUT_DIR, fileName), buildDataset(sliceIndex));
    written += 1;
  }
  process.stdout.write(`Wrote ${written} synthetic DICOM files to ${OUT_DIR}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err.stack ?? err.message ?? err}\n`);
  process.exit(1);
});
