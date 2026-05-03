#!/usr/bin/env node
/**
 * Generates the synthetic `ct-axial-anatomy` E2E fixture.
 *
 * One axial CT series, 30 slices, 128x128, 16-bit signed. Designed for
 * intensity-aware tools (RegionSegment / RegionSegmentPlus, ThresholdBrush,
 * Paint Fill in non-trivial anatomy) — the existing `ct-axial-300` sphere
 * phantom is binary (0 HU inside, -1000 HU outside) so GrowCut-style
 * region-grow degenerates: zero std dev inside (no tolerance band → empty
 * grow) or huge std dev across the boundary (grow runs unbounded).
 *
 * Geometry per slice:
 *   - Background air at -1000 HU ± 5 HU Gaussian noise.
 *   - Large soft-tissue ellipsoidal blob centered in-volume at 40 HU
 *     ± 10 HU Gaussian noise. ~10 HU std dev mimics real liver / muscle
 *     parenchyma so RegionSegment's positiveSeedVariance: 0.5 produces
 *     a sensible tolerance band (≈ ±5 HU).
 *   - Bone insert (small spherical region) at 800 HU ± 50 HU.
 *   - 2-voxel-wide gradient transition between tissue classes (linear
 *     blend of mean values + reduced noise) so boundary clicks don't
 *     produce huge bimodal seed samples.
 *
 * Deterministic seeded RNG (mulberry32) keeps the output bit-identical
 * across runs of the same node version.
 *
 * Run from the repo root:
 *
 *   node scripts/generate-synthetic-fixture-ct-anatomy.mjs
 *
 * Output: 30 .dcm files under
 *   e2e/fixtures/dicom/ct-axial-anatomy/
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dcmjs = require('dcmjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'e2e', 'fixtures', 'dicom', 'ct-axial-anatomy');

const ROWS = 128;
const COLUMNS = 128;
const SLICES = 30;
const PIXEL_SPACING = 2.0;
const SLICE_THICKNESS = 2.5;

// World-space anatomy. The soft-tissue blob and bone insert are
// ellipsoids centered in-volume so multi-slice contiguity is guaranteed.
const SOFT_TISSUE_CENTER = {
  x: (COLUMNS / 2) * PIXEL_SPACING,
  y: (ROWS / 2) * PIXEL_SPACING,
  z: (SLICES / 2) * SLICE_THICKNESS,
};
const SOFT_TISSUE_RADII = { x: 50, y: 38, z: 28 }; // mm; flattened ellipsoid
const SOFT_TISSUE_MEAN_HU = 40;
const SOFT_TISSUE_STDDEV_HU = 10;

const BONE_CENTER = {
  x: SOFT_TISSUE_CENTER.x + 18, // off-center inside the soft tissue
  y: SOFT_TISSUE_CENTER.y - 8,
  z: SOFT_TISSUE_CENTER.z,
};
const BONE_RADII = { x: 8, y: 8, z: 10 };
const BONE_MEAN_HU = 800;
const BONE_STDDEV_HU = 50;

const AIR_MEAN_HU = -1000;
const AIR_STDDEV_HU = 5;

// Width of the linear gradient blend between tissue classes (in mm).
// Two voxel widths at PIXEL_SPACING = 2.0 → 4 mm.
const TRANSITION_WIDTH_MM = 4;

const UID_ROOT = '1.2.826.0.1.3680043.10.1338.997';
const STUDY_UID = `${UID_ROOT}.1`;
const SERIES_UID = `${UID_ROOT}.2`;
const FRAME_OF_REFERENCE_UID = `${UID_ROOT}.3`;

// ─── Deterministic RNG (mulberry32) ─────────────────────────────────────

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller: convert two uniform samples to one Gaussian sample.
function gaussian(rng) {
  let u1 = rng();
  let u2 = rng();
  if (u1 < 1e-12) u1 = 1e-12;
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ─── Anatomy sampler ────────────────────────────────────────────────────

/**
 * Signed-distance-style "membership" in [0, 1] for an ellipsoid:
 *   1 deep inside, 0 well outside, linear blend across TRANSITION_WIDTH_MM.
 *
 * Using Math.hypot with normalized coordinates plus a transition-width
 * blend avoids a real SDF computation while still giving a smooth boundary.
 */
function ellipsoidMembership(px, py, pz, center, radii) {
  const nx = (px - center.x) / radii.x;
  const ny = (py - center.y) / radii.y;
  const nz = (pz - center.z) / radii.z;
  const normDist = Math.hypot(nx, ny, nz);
  // Convert normalized distance back to a rough world-space margin:
  // gradient half-width in normalized units, scaled by the smallest radius.
  const minRadius = Math.min(radii.x, radii.y, radii.z);
  const halfWidthNorm = TRANSITION_WIDTH_MM / (2 * minRadius);
  if (normDist <= 1 - halfWidthNorm) return 1;
  if (normDist >= 1 + halfWidthNorm) return 0;
  // Linear blend across the transition band.
  return (1 + halfWidthNorm - normDist) / (2 * halfWidthNorm);
}

function sampleVoxel(px, py, pz, rng) {
  const boneM = ellipsoidMembership(px, py, pz, BONE_CENTER, BONE_RADII);
  const tissueM = ellipsoidMembership(px, py, pz, SOFT_TISSUE_CENTER, SOFT_TISSUE_RADII);

  // Resolve membership precedence: bone > soft tissue > air.
  // For voxels inside bone (boneM ≈ 1), use bone stats. In the bone
  // transition band, blend with soft tissue. Outside the soft-tissue
  // boundary, blend with air.
  let mean;
  let stddev;
  if (boneM > 0) {
    // Bone or bone↔tissue gradient. Soft-tissue mean as the blending
    // partner since bone is fully enclosed in soft tissue.
    mean = boneM * BONE_MEAN_HU + (1 - boneM) * SOFT_TISSUE_MEAN_HU;
    // Reduce noise in the gradient band so seeds clicked there don't
    // blow up the GrowCut tolerance.
    stddev = boneM * BONE_STDDEV_HU + (1 - boneM) * SOFT_TISSUE_STDDEV_HU * 0.5;
  } else if (tissueM > 0) {
    // Soft tissue or tissue↔air gradient.
    mean = tissueM * SOFT_TISSUE_MEAN_HU + (1 - tissueM) * AIR_MEAN_HU;
    stddev = tissueM * SOFT_TISSUE_STDDEV_HU + (1 - tissueM) * AIR_STDDEV_HU;
    // Gradient band: damp noise so a click on the boundary doesn't
    // sample wildly bimodal voxels.
    if (tissueM > 0 && tissueM < 1) {
      stddev *= 0.4;
    }
  } else {
    mean = AIR_MEAN_HU;
    stddev = AIR_STDDEV_HU;
  }

  const noise = gaussian(rng) * stddev;
  return Math.round(mean + noise);
}

function buildSlice(sliceIndex) {
  const z = sliceIndex * SLICE_THICKNESS;
  // Per-slice deterministic seed: combine fixed root with slice index so
  // reruns produce byte-identical pixel data.
  const rng = mulberry32(0x4321 + sliceIndex * 1009);

  const pixelData = new Int16Array(ROWS * COLUMNS);
  for (let y = 0; y < ROWS; y++) {
    const py = y * PIXEL_SPACING;
    for (let x = 0; x < COLUMNS; x++) {
      const px = x * PIXEL_SPACING;
      const value = sampleVoxel(px, py, z, rng);
      // Clamp to the int16 representable range.
      pixelData[y * COLUMNS + x] = Math.max(-32768, Math.min(32767, value));
    }
  }
  return pixelData;
}

// ─── DICOM dataset ──────────────────────────────────────────────────────

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
    ManufacturerModelName: 'ct-axial-anatomy',
    PatientName: 'Synthetic^Anatomy',
    PatientID: 'XNAT-WS-SYNTH-003',
    PatientBirthDate: '',
    PatientSex: '',
    StudyID: '1',
    StudyDate: '20260101',
    StudyTime: '000000',
    AccessionNumber: 'SYNTH',
    SeriesNumber: '101',
    AcquisitionNumber: '1',
    InstanceNumber: String(sliceIndex + 1),
    SeriesDescription: 'Synthetic Anatomy CT (soft-tissue + bone insert)',
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
