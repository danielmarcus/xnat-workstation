#!/usr/bin/env node
/**
 * Generates the synthetic `sameforuid-different-acquisition` E2E fixture.
 *
 * Two CT series sharing one FrameOfReferenceUID with different
 * AcquisitionNumber values — the metadata shape the A2c heuristic in
 * `segmentationService/visibility.ts` keys on. A sphere phantom is
 * displaced between the two series so any future visual differentiation
 * test (cross-series rendering with the displacement visible) has data.
 *
 * Run from the repo root:
 *
 *   node scripts/generate-synthetic-fixture-sameforuid.mjs
 *
 * Output: 32 .dcm files (16 per series) under
 *   e2e/fixtures/dicom/sameforuid-different-acquisition/
 *
 * Files are deterministic — re-running overwrites with the same content.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dcmjs = require('dcmjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'e2e', 'fixtures', 'dicom', 'sameforuid-different-acquisition');

const ROWS = 128;
const COLUMNS = 128;
const SLICES = 16;
const PIXEL_SPACING = 2.0;
const SLICE_THICKNESS = 2.5;

// Stable UIDs — deterministic so re-runs don't churn the LFS pointers.
const UID_ROOT = '1.2.826.0.1.3680043.10.1338.999';
const STUDY_UID = `${UID_ROOT}.1.1`;
const FRAME_OF_REFERENCE_UID = `${UID_ROOT}.1.2`;
const SERIES_UIDS = [`${UID_ROOT}.1.10`, `${UID_ROOT}.1.20`];
const ACQUISITION_NUMBERS = [1, 5];
const SERIES_DESCRIPTIONS = ['Synthetic CT Phase 00', 'Synthetic CT Phase 50'];

function buildSlice({ seriesIndex, sliceIndex }) {
  const z = sliceIndex * SLICE_THICKNESS;
  // Phantom: -1000 HU background, 0 HU sphere. Series 1 sphere is offset 5 mm
  // along +x to model the displacement A2c expects between phases / breath-hold pairs.
  const sphereCenterX = (COLUMNS / 2) * PIXEL_SPACING + (seriesIndex === 1 ? 5 : 0);
  const sphereCenterY = (ROWS / 2) * PIXEL_SPACING;
  const sphereCenterZ = (SLICES / 2) * SLICE_THICKNESS;
  const sphereRadius = 25; // mm

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

function buildDataset({ seriesIndex, sliceIndex }) {
  const seriesUID = SERIES_UIDS[seriesIndex];
  const acquisitionNumber = ACQUISITION_NUMBERS[seriesIndex];
  const seriesDescription = SERIES_DESCRIPTIONS[seriesIndex];
  const sopInstanceUID = `${seriesUID}.${sliceIndex + 1}`;
  const z = sliceIndex * SLICE_THICKNESS;
  const pixelData = buildSlice({ seriesIndex, sliceIndex });

  const meta = {
    FileMetaInformationVersion: new Uint8Array([0x00, 0x01]).buffer,
    MediaStorageSOPClassUID: '1.2.840.10008.5.1.4.1.1.2',
    MediaStorageSOPInstanceUID: sopInstanceUID,
    TransferSyntaxUID: '1.2.840.10008.1.2.1',
    ImplementationClassUID: `${UID_ROOT}.0`,
    ImplementationVersionName: 'XNAT-WS-SYNTH-1',
  };

  const dataset = {
    SOPClassUID: '1.2.840.10008.5.1.4.1.1.2', // CT Image Storage
    SOPInstanceUID: sopInstanceUID,
    StudyInstanceUID: STUDY_UID,
    SeriesInstanceUID: seriesUID,
    FrameOfReferenceUID: FRAME_OF_REFERENCE_UID,

    Modality: 'CT',
    Manufacturer: 'XNAT-WS-SYNTH',
    ManufacturerModelName: 'sameforuid-different-acquisition',
    PatientName: 'Synthetic^Phantom',
    PatientID: 'XNAT-WS-SYNTH-001',
    PatientBirthDate: '',
    PatientSex: '',
    StudyID: '1',
    StudyDate: '20260101',
    StudyTime: '000000',
    AccessionNumber: 'SYNTH',
    SeriesNumber: String(100 + seriesIndex * 10),
    AcquisitionNumber: String(acquisitionNumber),
    InstanceNumber: String(sliceIndex + 1),
    SeriesDescription: seriesDescription,

    Rows: ROWS,
    Columns: COLUMNS,
    BitsAllocated: 16,
    BitsStored: 16,
    HighBit: 15,
    PixelRepresentation: 1, // signed
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
    PixelData: pixelData.buffer,
  };

  return { dataset, meta };
}

async function writeDataset(filePath, { dataset, meta }) {
  const denaturalizedMeta = dcmjs.data.DicomMetaDictionary.denaturalizeDataset(meta);
  const denaturalizedDict = dcmjs.data.DicomMetaDictionary.denaturalizeDataset(dataset);
  const dict = new dcmjs.data.DicomDict(denaturalizedMeta);
  dict.dict = denaturalizedDict;
  const buffer = Buffer.from(dict.write());
  await fs.writeFile(filePath, buffer);
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  for (const entry of await fs.readdir(OUT_DIR)) {
    if (entry.endsWith('.dcm')) {
      await fs.unlink(path.join(OUT_DIR, entry));
    }
  }

  let written = 0;
  for (let seriesIndex = 0; seriesIndex < SERIES_UIDS.length; seriesIndex++) {
    for (let sliceIndex = 0; sliceIndex < SLICES; sliceIndex++) {
      const fileName = `series${seriesIndex + 1}-slice${String(sliceIndex + 1).padStart(3, '0')}.dcm`;
      const filePath = path.join(OUT_DIR, fileName);
      await writeDataset(filePath, buildDataset({ seriesIndex, sliceIndex }));
      written += 1;
    }
  }
  process.stdout.write(`Wrote ${written} synthetic DICOM files to ${OUT_DIR}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err.stack ?? err.message ?? err}\n`);
  process.exit(1);
});
