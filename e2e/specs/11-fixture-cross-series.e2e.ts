/**
 * Fixture-Pipeline Acceptance (Multi-Viewport Phase 2 prep)
 *
 * Exercises the local DICOM fixture pipeline end-to-end at the level the
 * current harness supports: discovery via `loadLocalDicomFixture` plus
 * metadata-shape validation of the discovered files. When fixtures are
 * absent the spec skips cleanly so this passes in environments without
 * data on disk (fresh clones, CI without fixture volumes mounted).
 *
 * Scope (intentional):
 *   - Helper integration: `loadLocalDicomFixture` returns absolute paths
 *     and the file count is plausible.
 *   - Metadata-shape verification (the property each fixture is named for):
 *       MR_T1_T2_SAMEEXAM           — two distinct series, shared FoR.
 *       SAMEFORUID_DIFFERENT_ACQUISITION — two distinct series, shared
 *                                      FoR, different `AcquisitionNumber`.
 *
 * Out of scope (deferred follow-ups, see PHASES.md):
 *   - Mounting fixture paths into a running viewport. The renderer's
 *     `__XNAT_E2E__` surface currently only loads via the XNAT browser
 *     flow; a `loadLocalDicomFiles(panelId, paths)` hook is needed before
 *     this spec can drive the canvas.
 *   - Asserting the A2b dashed-stroke style on the non-native viewport
 *     (signal 9) and A2c off-by-default behavior (signal 10). Both
 *     depend on the renderer hook above.
 *
 * The spec runs without Electron — it's a Node-level pipeline check
 * hosted in the Playwright runner. No XNAT credentials required.
 */
import { test, expect } from '@playwright/test';
import { promises as fs } from 'fs';
import dcmjs from 'dcmjs';
import {
  FIXTURE_NAMES,
  loadLocalDicomFixture,
  type LoadedDicomFixture,
} from '../helpers/local-dicom-fixtures';

interface NaturalizedDataset {
  Modality?: string;
  SeriesInstanceUID?: string;
  SeriesDescription?: string;
  FrameOfReferenceUID?: string;
  AcquisitionNumber?: number | string;
}

async function readDataset(filePath: string): Promise<NaturalizedDataset> {
  const buffer = await fs.readFile(filePath);
  const dicomMessage = dcmjs.data.DicomMessage.readFile(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  );
  return dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomMessage.dict) as NaturalizedDataset;
}

async function readAllDatasets(fixture: LoadedDicomFixture): Promise<NaturalizedDataset[]> {
  return Promise.all(fixture.imagePaths.map(readDataset));
}

function uniqueDefined<T>(values: (T | undefined | null)[]): Set<T> {
  return new Set(values.filter((v): v is T => v !== undefined && v !== null && v !== ''));
}

test.describe('Local DICOM fixture pipeline', () => {
  test('mr-t1-t2-sameexam: two MR series share a FrameOfReferenceUID', async () => {
    const fixture = await loadLocalDicomFixture(FIXTURE_NAMES.MR_T1_T2_SAMEEXAM);
    test.skip(
      fixture === null,
      `Fixture '${FIXTURE_NAMES.MR_T1_T2_SAMEEXAM}' is not present locally — populate e2e/fixtures/dicom/${FIXTURE_NAMES.MR_T1_T2_SAMEEXAM}/ or set XNAT_E2E_FIXTURE_ROOT.`,
    );

    expect(fixture!.imagePaths.length).toBeGreaterThanOrEqual(2);

    const datasets = await readAllDatasets(fixture!);

    const forUIDs = uniqueDefined(datasets.map((d) => d.FrameOfReferenceUID));
    expect(forUIDs.size, 'all instances should share one FrameOfReferenceUID').toBe(1);

    const seriesUIDs = uniqueDefined(datasets.map((d) => d.SeriesInstanceUID));
    expect(seriesUIDs.size, 'fixture should contain at least two distinct series').toBeGreaterThanOrEqual(2);

    const modalities = uniqueDefined(datasets.map((d) => d.Modality));
    expect(modalities.has('MR'), `expected MR modality, got ${[...modalities].join(',')}`).toBe(true);

    const descriptions = uniqueDefined(datasets.map((d) => d.SeriesDescription));
    expect(
      descriptions.size,
      'series descriptions should differ between T1 and T2 (cosmetic, not strictly required by A2b)',
    ).toBeGreaterThanOrEqual(2);
  });

  test('sameforuid-different-acquisition: two series share FoR but differ on AcquisitionNumber', async () => {
    const fixture = await loadLocalDicomFixture(FIXTURE_NAMES.SAMEFORUID_DIFFERENT_ACQUISITION);
    test.skip(
      fixture === null,
      `Fixture '${FIXTURE_NAMES.SAMEFORUID_DIFFERENT_ACQUISITION}' is not present locally — populate e2e/fixtures/dicom/${FIXTURE_NAMES.SAMEFORUID_DIFFERENT_ACQUISITION}/ or set XNAT_E2E_FIXTURE_ROOT.`,
    );

    expect(fixture!.imagePaths.length).toBeGreaterThanOrEqual(2);

    const datasets = await readAllDatasets(fixture!);

    const forUIDs = uniqueDefined(datasets.map((d) => d.FrameOfReferenceUID));
    expect(forUIDs.size, 'all instances should share one FrameOfReferenceUID').toBe(1);

    const seriesUIDs = uniqueDefined(datasets.map((d) => d.SeriesInstanceUID));
    expect(seriesUIDs.size, 'fixture should contain at least two distinct series').toBeGreaterThanOrEqual(2);

    const acquisitionNumbers = uniqueDefined(
      datasets.map((d) => (d.AcquisitionNumber === undefined ? undefined : String(d.AcquisitionNumber))),
    );
    expect(
      acquisitionNumbers.size,
      'A2c heuristic requires distinct AcquisitionNumber values across series',
    ).toBeGreaterThanOrEqual(2);
  });
});
