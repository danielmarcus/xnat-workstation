/**
 * Fixture-Pipeline Acceptance (Multi-Viewport Phase 2 prep)
 *
 * Exercises the local DICOM fixture pipeline end-to-end:
 *
 *   - Helper integration: `loadLocalDicomFixture` returns absolute paths
 *     and the file count is plausible.
 *   - Metadata-shape verification (the property each fixture is named for).
 *   - Renderer-mount via the `__XNAT_E2E__.loadLocalDicomFiles` hook —
 *     drives the production wadouri.fileManager + setPanelImageIds path
 *     and asserts both panels mount a visible canvas. This proves the
 *     fixture flows through the same code path the XNAT browser uses,
 *     no XNAT round-trip required.
 *
 * When fixtures are absent the spec skips cleanly. The renderer-mount
 * test launches the Electron app; the metadata-shape tests don't.
 */
import { test, expect } from '@playwright/test';
import { test as electronTest } from '../fixtures/electron-app';
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

electronTest.describe('Local fixture renderer mount (loadLocalDicomFiles)', () => {
  electronTest('mr-t1-t2-sameexam mounts both series via __XNAT_E2E__.loadLocalDicomFiles', async ({ page }) => {
    const fixture = await loadLocalDicomFixture(FIXTURE_NAMES.MR_T1_T2_SAMEEXAM);
    electronTest.skip(
      fixture === null,
      `Fixture '${FIXTURE_NAMES.MR_T1_T2_SAMEEXAM}' is not present locally — populate e2e/fixtures/dicom/${FIXTURE_NAMES.MR_T1_T2_SAMEEXAM}/ or set XNAT_E2E_FIXTURE_ROOT.`,
    );

    // Partition by SeriesInstanceUID so we can mount the two series on
    // separate panels. Both share FoR, which is what the cross-series
    // pipeline needs to flag the non-native viewport.
    const datasets = await readAllDatasets(fixture!);
    const seriesGroups = new Map<string, string[]>();
    for (let i = 0; i < datasets.length; i++) {
      const key = datasets[i].SeriesInstanceUID ?? `unknown-${i}`;
      const list = seriesGroups.get(key) ?? [];
      list.push(fixture!.imagePaths[i]);
      seriesGroups.set(key, list);
    }
    const series = [...seriesGroups.values()];
    expect(series.length).toBeGreaterThanOrEqual(2);

    // Open the viewer gate without an XNAT round-trip and switch to a
    // 1×2 layout so both panels exist before we mount.
    await page.evaluate(() => window.__XNAT_E2E__?.setFakeConnected(true));
    await page.evaluate(() => window.__XNAT_E2E__?.setMultiViewportEnabled(true));
    await page.evaluate(() => window.__XNAT_E2E__?.setLayout('1x2' as const));

    // Mount each series on its own panel. The hook drives wadouri.fileManager
    // + setPanelImageIds — same code path as drag-and-drop import.
    const panel0Result = await page.evaluate(
      async (paths) => {
        const result = await window.__XNAT_E2E__!.loadLocalDicomFiles('panel_0', paths);
        return { imageIdCount: result.imageIds.length, panelId: result.panelId };
      },
      series[0],
    );
    expect(panel0Result.imageIdCount).toBe(series[0].length);

    const panel1Result = await page.evaluate(
      async (paths) => {
        const result = await window.__XNAT_E2E__!.loadLocalDicomFiles('panel_1', paths);
        return { imageIdCount: result.imageIds.length, panelId: result.panelId };
      },
      series[1],
    );
    expect(panel1Result.imageIdCount).toBe(series[1].length);

    // Both panels should mount a viewport canvas. Whether it's the volume
    // or stack root depends on the same eligibility predicate the XNAT
    // path uses; we accept either.
    for (const pid of ['panel_0', 'panel_1']) {
      const volumeCanvas = page.locator(`[data-testid="volume-viewport-canvas:${pid}"] canvas`);
      const stackCanvas = page.locator(`[data-testid="cornerstone-viewport-canvas:${pid}"] canvas`);
      await Promise.race([
        volumeCanvas.first().waitFor({ state: 'visible', timeout: 30_000 }),
        stackCanvas.first().waitFor({ state: 'visible', timeout: 30_000 }),
      ]);
    }
  });
});
