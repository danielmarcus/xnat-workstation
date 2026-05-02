/**
 * Local DICOM Fixture Helpers (Phase 0 / design §8.4)
 *
 * Discovers anonymized DICOM datasets in `e2e/fixtures/dicom/<name>/` and
 * returns their absolute paths. Returns null when a fixture directory is
 * missing or empty, so specs can `test.skip()` cleanly in environments
 * without local fixture data (e.g., fresh clones or CI without data
 * volumes mounted).
 *
 * Usage in a spec:
 *
 *   import { loadLocalDicomFixture, FIXTURE_NAMES } from '../helpers/local-dicom-fixtures';
 *
 *   test('volume mode renders for axial CT fixture', async ({ page }) => {
 *     const fixture = await loadLocalDicomFixture(FIXTURE_NAMES.CT_AXIAL_300);
 *     test.skip(fixture === null, 'Local CT fixture not present');
 *     // ... drive the renderer to load fixture.imagePaths
 *   });
 */
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Canonical fixture-set names. Keep in sync with e2e/fixtures/dicom/README.md.
 *
 * `SAMEFORUID_DIFFERENT_ACQUISITION` is the metadata-shape name for what the
 * design doc originally called `breath-hold-pair`. The A2c heuristic reads
 * shared FrameOfReferenceUID + differing AcquisitionNumber, not anatomy
 * displacement, so any pair with that metadata shape (breath-hold, 4D-CT
 * phases, repeat acquisitions) exercises the same code path. The
 * 4dct-phases scenario from the design is covered by the same fixture.
 */
export const FIXTURE_NAMES = {
  CT_AXIAL_300: 'ct-axial-300',
  MR_T1_T2_SAMEEXAM: 'mr-t1-t2-sameexam',
  SAMEFORUID_DIFFERENT_ACQUISITION: 'sameforuid-different-acquisition',
  CROSS_FOR_CT_MR: 'cross-for-ct-mr',
  RTSTRUCT_TYPED: 'rtstruct-typed',
  SEG_MULTILABEL: 'seg-multilabel',
  CINE_US: 'cine-us',
} as const;

export type FixtureName = (typeof FIXTURE_NAMES)[keyof typeof FIXTURE_NAMES];

export interface LoadedDicomFixture {
  /** Fixture set name, matching the subdirectory under e2e/fixtures/dicom/. */
  name: FixtureName;
  /** Absolute paths to DICOM files inside the fixture, sorted alphabetically. */
  imagePaths: string[];
  /** Absolute path to the fixture's directory. */
  directory: string;
}

/**
 * Default fixture root. Override with the `XNAT_E2E_FIXTURE_ROOT` env var if
 * fixtures live outside the repo (common when datasets are too large to
 * commit and live on a shared volume instead).
 */
function fixtureRoot(): string {
  return process.env.XNAT_E2E_FIXTURE_ROOT
    ?? path.resolve(__dirname, '..', 'fixtures', 'dicom');
}

const DICOM_EXTENSIONS = new Set(['.dcm', '.ima', '.img']);

function looksLikeDicom(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '') return true; // many DICOM files have no extension
  return DICOM_EXTENSIONS.has(ext);
}

/**
 * Discover DICOM files in the named fixture subdirectory. Returns `null` if
 * the directory doesn't exist or contains no DICOM-shaped files.
 *
 * Files are sorted alphabetically, which usually matches the slice order
 * for series exported from typical PACS systems (instance-number-padded
 * filenames). Specs that require strict ordering should sort by SOP
 * instance UID after loading.
 */
export async function loadLocalDicomFixture(name: FixtureName): Promise<LoadedDicomFixture | null> {
  const directory = path.join(fixtureRoot(), name);

  let entries: string[];
  try {
    entries = await fs.readdir(directory);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }

  const dicomFiles = entries
    .filter((entry) => looksLikeDicom(entry))
    .sort()
    .map((entry) => path.join(directory, entry));

  if (dicomFiles.length === 0) {
    return null;
  }

  return {
    name,
    imagePaths: dicomFiles,
    directory,
  };
}

/**
 * Read all available fixtures. Useful for diagnostics (logging which
 * fixtures the current environment has).
 */
export async function listAvailableFixtures(): Promise<FixtureName[]> {
  const root = fixtureRoot();
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }

  const known = new Set<string>(Object.values(FIXTURE_NAMES));
  const present: FixtureName[] = [];
  for (const entry of entries) {
    if (known.has(entry)) {
      const fixture = await loadLocalDicomFixture(entry as FixtureName);
      if (fixture) present.push(entry as FixtureName);
    }
  }
  return present;
}
