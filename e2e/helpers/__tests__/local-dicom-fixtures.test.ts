/**
 * Unit tests for the local DICOM fixture helpers.
 *
 * Uses a synthetic temp directory so we exercise the discovery logic
 * without requiring real DICOM data on disk. Real fixtures live in
 * e2e/fixtures/dicom/<name>/ and are out of repo scope.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  FIXTURE_NAMES,
  listAvailableFixtures,
  loadLocalDicomFixture,
} from '../local-dicom-fixtures';

let tempRoot: string;

async function makeTempFixtureTree(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'xnat-e2e-fixtures-'));
}

async function writeFile(p: string, body = ''): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, body);
}

beforeEach(async () => {
  tempRoot = await makeTempFixtureTree();
  process.env.XNAT_E2E_FIXTURE_ROOT = tempRoot;
});

afterEach(async () => {
  delete process.env.XNAT_E2E_FIXTURE_ROOT;
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('loadLocalDicomFixture', () => {
  it('returns null for a missing fixture directory', async () => {
    const result = await loadLocalDicomFixture(FIXTURE_NAMES.CT_AXIAL_300);
    expect(result).toBeNull();
  });

  it('returns null for an empty fixture directory', async () => {
    await fs.mkdir(path.join(tempRoot, FIXTURE_NAMES.CT_AXIAL_300), { recursive: true });
    const result = await loadLocalDicomFixture(FIXTURE_NAMES.CT_AXIAL_300);
    expect(result).toBeNull();
  });

  it('discovers .dcm files and returns sorted absolute paths', async () => {
    const dir = path.join(tempRoot, FIXTURE_NAMES.CT_AXIAL_300);
    await writeFile(path.join(dir, 'IM-0001-0010.dcm'));
    await writeFile(path.join(dir, 'IM-0001-0001.dcm'));
    await writeFile(path.join(dir, 'IM-0001-0005.dcm'));

    const result = await loadLocalDicomFixture(FIXTURE_NAMES.CT_AXIAL_300);
    expect(result).not.toBeNull();
    expect(result!.imagePaths).toHaveLength(3);
    expect(result!.imagePaths[0]).toMatch(/IM-0001-0001\.dcm$/);
    expect(result!.imagePaths[1]).toMatch(/IM-0001-0005\.dcm$/);
    expect(result!.imagePaths[2]).toMatch(/IM-0001-0010\.dcm$/);
    expect(result!.imagePaths.every((p) => path.isAbsolute(p))).toBe(true);
    expect(result!.directory).toBe(dir);
    expect(result!.name).toBe(FIXTURE_NAMES.CT_AXIAL_300);
  });

  it('accepts extensionless DICOM files (common output format)', async () => {
    const dir = path.join(tempRoot, FIXTURE_NAMES.MR_T1_T2_SAMEEXAM);
    await writeFile(path.join(dir, 'IM00001'));
    await writeFile(path.join(dir, 'IM00002'));

    const result = await loadLocalDicomFixture(FIXTURE_NAMES.MR_T1_T2_SAMEEXAM);
    expect(result).not.toBeNull();
    expect(result!.imagePaths).toHaveLength(2);
  });

  it('accepts .ima and .img extensions, filters out non-DICOM extensions', async () => {
    const dir = path.join(tempRoot, FIXTURE_NAMES.SEG_MULTILABEL);
    await writeFile(path.join(dir, 'a.ima'));
    await writeFile(path.join(dir, 'b.img'));
    await writeFile(path.join(dir, 'README.md')); // filtered — wrong extension

    const result = await loadLocalDicomFixture(FIXTURE_NAMES.SEG_MULTILABEL);
    expect(result).not.toBeNull();
    expect(result!.imagePaths).toHaveLength(2);
    expect(result!.imagePaths.map((p) => path.basename(p)).sort()).toEqual(['a.ima', 'b.img']);
  });

  it('rejects files with non-DICOM extensions', async () => {
    const dir = path.join(tempRoot, FIXTURE_NAMES.CINE_US);
    await writeFile(path.join(dir, 'thumbnail.png'));
    await writeFile(path.join(dir, 'metadata.json'));

    const result = await loadLocalDicomFixture(FIXTURE_NAMES.CINE_US);
    expect(result).toBeNull();
  });

  it('discovers files under the SAMEFORUID_DIFFERENT_ACQUISITION slot', async () => {
    const dir = path.join(tempRoot, FIXTURE_NAMES.SAMEFORUID_DIFFERENT_ACQUISITION);
    await writeFile(path.join(dir, 'phase00-001.dcm'));
    await writeFile(path.join(dir, 'phase50-001.dcm'));

    const result = await loadLocalDicomFixture(FIXTURE_NAMES.SAMEFORUID_DIFFERENT_ACQUISITION);
    expect(result).not.toBeNull();
    expect(result!.name).toBe(FIXTURE_NAMES.SAMEFORUID_DIFFERENT_ACQUISITION);
    expect(result!.imagePaths).toHaveLength(2);
  });
});

describe('listAvailableFixtures', () => {
  it('returns empty list when the fixture root is missing', async () => {
    delete process.env.XNAT_E2E_FIXTURE_ROOT;
    process.env.XNAT_E2E_FIXTURE_ROOT = path.join(tempRoot, 'nonexistent');
    const result = await listAvailableFixtures();
    expect(result).toEqual([]);
  });

  it('returns only names of populated fixture directories', async () => {
    // Two fixtures populated, one empty, one with non-DICOM files.
    await writeFile(path.join(tempRoot, FIXTURE_NAMES.CT_AXIAL_300, 'a.dcm'));
    await writeFile(path.join(tempRoot, FIXTURE_NAMES.RTSTRUCT_TYPED, 'b.dcm'));
    await fs.mkdir(path.join(tempRoot, FIXTURE_NAMES.MR_T1_T2_SAMEEXAM), { recursive: true });
    await writeFile(path.join(tempRoot, FIXTURE_NAMES.CINE_US, 'thumbnail.png'));

    const result = await listAvailableFixtures();
    expect(result.sort()).toEqual([FIXTURE_NAMES.CT_AXIAL_300, FIXTURE_NAMES.RTSTRUCT_TYPED].sort());
  });

  it('ignores unknown subdirectories', async () => {
    await writeFile(path.join(tempRoot, 'random-dir', 'a.dcm'));
    await writeFile(path.join(tempRoot, FIXTURE_NAMES.CT_AXIAL_300, 'b.dcm'));

    const result = await listAvailableFixtures();
    expect(result).toEqual([FIXTURE_NAMES.CT_AXIAL_300]);
  });
});
