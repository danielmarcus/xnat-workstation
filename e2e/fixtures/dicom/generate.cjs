#!/usr/bin/env node
/**
 * Synthetic DICOM fixture generator (annotation rebuild, Phase 0).
 *
 * Produces deterministic-shape, PHI-free DICOM datasets for offline E2E.
 * No network, no real patient data. UIDs are freshly generated per run via
 * dcmjs (DicomMetaDictionary.uid), so each regeneration is internally
 * consistent but not byte-identical across runs — fine for fixtures.
 *
 * Currently generates:
 *   - ct-axial-300 : binary CT sphere phantom (uniform two-value intensity).
 *
 * Usage:
 *   node e2e/fixtures/dicom/generate.cjs            # all datasets
 *   node e2e/fixtures/dicom/generate.cjs ct-axial-300
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

/** Build one axial slice of a centered sphere phantom (Int16 HU values). */
function makeSphereSlice(rows, cols, sliceIndex, numSlices, opts) {
  const { pixelSpacing, sliceThickness, insideHU, outsideHU, radiusMm } = opts;
  const data = new Int16Array(rows * cols);
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  const cz = (numSlices - 1) / 2;
  const z = (sliceIndex - cz) * sliceThickness;
  let i = 0;
  for (let r = 0; r < rows; r++) {
    const y = (r - cy) * pixelSpacing[0];
    for (let c = 0; c < cols; c++) {
      const x = (c - cx) * pixelSpacing[1];
      const dist = Math.sqrt(x * x + y * y + z * z);
      data[i++] = dist <= radiusMm ? insideHU : outsideHU;
    }
  }
  return data;
}

function generateCtAxial300(outDir) {
  const rows = 128;
  const cols = 128;
  const numSlices = 16;
  const pixelSpacing = [1.0, 1.0]; // mm [row, col]
  const sliceThickness = 3.0; // mm
  const opts = {
    pixelSpacing,
    sliceThickness,
    insideHU: 300, // binary phantom: two intensities
    outsideHU: -1000, // air
    radiusMm: 24,
  };

  const studyUID = DicomMetaDictionary.uid();
  const seriesUID = DicomMetaDictionary.uid();
  const frameOfReferenceUID = DicomMetaDictionary.uid();
  const implementationClassUID = DicomMetaDictionary.uid();

  fs.mkdirSync(outDir, { recursive: true });

  for (let s = 0; s < numSlices; s++) {
    const sopInstanceUID = DicomMetaDictionary.uid();
    const pixels = makeSphereSlice(rows, cols, s, numSlices, opts);

    const dataset = {
      SOPClassUID: CT_IMAGE_STORAGE,
      SOPInstanceUID: sopInstanceUID,
      StudyInstanceUID: studyUID,
      SeriesInstanceUID: seriesUID,
      FrameOfReferenceUID: frameOfReferenceUID,
      Modality: 'CT',
      PatientName: 'PHANTOM^SPHERE',
      PatientID: 'CT-AXIAL-300',
      PatientBirthDate: '',
      PatientSex: 'O',
      StudyID: '1',
      StudyDate: '20260101',
      StudyTime: '000000',
      AccessionNumber: '',
      SeriesNumber: 1,
      InstanceNumber: s + 1,
      SeriesDescription: 'CT AXIAL 300 (sphere phantom)',
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
      ImagePositionPatient: [
        -((cols - 1) / 2) * pixelSpacing[1],
        -((rows - 1) / 2) * pixelSpacing[0],
        (s - (numSlices - 1) / 2) * sliceThickness,
      ],
      SliceLocation: (s - (numSlices - 1) / 2) * sliceThickness,
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

const GENERATORS = {
  'ct-axial-300': generateCtAxial300,
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
