#!/usr/bin/env node
/**
 * Generates the synthetic `cine-us` E2E fixture.
 *
 * One multi-frame Ultrasound instance — 16 frames, 128x128, 8-bit
 * unsigned. Multi-frame US is the canonical case for the
 * stack-eligibility predicate's "multi-frame cine without spatial
 * dimension → stack" branch (see viewportService/stackEligibility.ts).
 *
 * Run from the repo root:
 *
 *   node scripts/generate-synthetic-fixture-cine-us.mjs
 *
 * Output: 1 .dcm file under
 *   e2e/fixtures/dicom/cine-us/
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dcmjs = require('dcmjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'e2e', 'fixtures', 'dicom', 'cine-us');

const ROWS = 128;
const COLUMNS = 128;
const FRAMES = 16;

const UID_ROOT = '1.2.826.0.1.3680043.10.1338.997';
const STUDY_UID = `${UID_ROOT}.1`;
const SERIES_UID = `${UID_ROOT}.2`;
const SOP_INSTANCE_UID = `${UID_ROOT}.3`;

function buildPixelData() {
  // A bouncing-bar pattern across frames so cine playback shows motion.
  const buffer = new Uint8Array(ROWS * COLUMNS * FRAMES);
  for (let f = 0; f < FRAMES; f++) {
    const barX = Math.floor((COLUMNS / FRAMES) * f);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLUMNS; x++) {
        const idx = f * ROWS * COLUMNS + y * COLUMNS + x;
        const inBar = Math.abs(x - barX) < 4;
        buffer[idx] = inBar ? 220 : 32;
      }
    }
  }
  return buffer;
}

function buildDataset() {
  const meta = {
    FileMetaInformationVersion: new Uint8Array([0x00, 0x01]).buffer,
    MediaStorageSOPClassUID: '1.2.840.10008.5.1.4.1.1.6.1', // Ultrasound Image Storage
    MediaStorageSOPInstanceUID: SOP_INSTANCE_UID,
    TransferSyntaxUID: '1.2.840.10008.1.2.1',
    ImplementationClassUID: `${UID_ROOT}.0`,
    ImplementationVersionName: 'XNAT-WS-SYNTH-1',
  };

  const dataset = {
    SOPClassUID: '1.2.840.10008.5.1.4.1.1.6.1',
    SOPInstanceUID: SOP_INSTANCE_UID,
    StudyInstanceUID: STUDY_UID,
    SeriesInstanceUID: SERIES_UID,
    Modality: 'US',
    Manufacturer: 'XNAT-WS-SYNTH',
    ManufacturerModelName: 'cine-us',
    PatientName: 'Synthetic^Phantom',
    PatientID: 'XNAT-WS-SYNTH-003',
    PatientBirthDate: '',
    PatientSex: '',
    StudyID: '1',
    StudyDate: '20260101',
    StudyTime: '000000',
    AccessionNumber: 'SYNTH',
    SeriesNumber: '100',
    InstanceNumber: '1',
    SeriesDescription: 'Synthetic Cine US 16 frames',
    NumberOfFrames: FRAMES,
    FrameTime: 33.333, // ms — ~30 fps
    Rows: ROWS,
    Columns: COLUMNS,
    BitsAllocated: 8,
    BitsStored: 8,
    HighBit: 7,
    PixelRepresentation: 0,
    SamplesPerPixel: 1,
    PhotometricInterpretation: 'MONOCHROME2',
    PixelData: buildPixelData().buffer,
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
  await writeDataset(path.join(OUT_DIR, 'cine-us.dcm'), buildDataset());
  process.stdout.write(`Wrote 1 synthetic multi-frame US file to ${OUT_DIR}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err.stack ?? err.message ?? err}\n`);
  process.exit(1);
});
