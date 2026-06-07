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
  } = opts;

  const studyUID = DicomMetaDictionary.uid();
  const seriesUID = DicomMetaDictionary.uid();
  const frameOfReferenceUID = DicomMetaDictionary.uid();
  const implementationClassUID = DicomMetaDictionary.uid();

  fs.mkdirSync(outDir, { recursive: true });

  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  const cz = (numSlices - 1) / 2;

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
      SOPClassUID: CT_IMAGE_STORAGE,
      SOPInstanceUID: sopInstanceUID,
      StudyInstanceUID: studyUID,
      SeriesInstanceUID: seriesUID,
      FrameOfReferenceUID: frameOfReferenceUID,
      Modality: 'CT',
      PatientName: patientName,
      PatientID: patientId,
      PatientBirthDate: '',
      PatientSex: 'O',
      StudyID: '1',
      StudyDate: '20260101',
      StudyTime: '000000',
      AccessionNumber: '',
      SeriesNumber: 1,
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
      MediaStorageSOPClassUID: CT_IMAGE_STORAGE,
      MediaStorageSOPInstanceUID: sopInstanceUID,
      TransferSyntaxUID: TRANSFER_SYNTAX_EXPLICIT_VR_LE,
      ImplementationClassUID: implementationClassUID,
      ImplementationVersionName: 'XNATWS_E2E_1',
    };

    const dicomDict = new DicomDict(DicomMetaDictionary.denaturalizeDataset(meta));
    dicomDict.dict = DicomMetaDictionary.denaturalizeDataset(dataset);
    const buffer = dicomDict.write();

    const filename = `slice-${String(s + 1).padStart(3, '0')}.dcm`;
    fs.writeFileSync(path.join(outDir, filename), Buffer.from(buffer));
  }

  return { count: numSlices, rows, cols };
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

const GENERATORS = {
  'ct-axial-300': generateCtAxial300,
  'ct-axial-anatomy': generateCtAxialAnatomy,
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
