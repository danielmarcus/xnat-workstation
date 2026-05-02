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
  SOPClassUID?: string;
  SeriesInstanceUID?: string;
  SeriesDescription?: string;
  FrameOfReferenceUID?: string;
  AcquisitionNumber?: number | string;
  NumberOfFrames?: number | string;
  SegmentationType?: string;
  SegmentSequence?: unknown;
  ApprovalStatus?: string;
  StructureSetROISequence?: unknown;
  RTROIObservationsSequence?: unknown;
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

  test('ct-axial-300: single CT series with ≥ 30 axial slices', async () => {
    const fixture = await loadLocalDicomFixture(FIXTURE_NAMES.CT_AXIAL_300);
    test.skip(
      fixture === null,
      `Fixture '${FIXTURE_NAMES.CT_AXIAL_300}' is not present locally.`,
    );
    expect(fixture!.imagePaths.length).toBeGreaterThanOrEqual(30);

    const datasets = await readAllDatasets(fixture!);
    const seriesUIDs = uniqueDefined(datasets.map((d) => d.SeriesInstanceUID));
    expect(seriesUIDs.size).toBe(1);

    const modalities = uniqueDefined(datasets.map((d) => d.Modality));
    expect(modalities.has('CT')).toBe(true);
  });

  test('cine-us: single multi-frame US instance with NumberOfFrames > 1', async () => {
    const fixture = await loadLocalDicomFixture(FIXTURE_NAMES.CINE_US);
    test.skip(
      fixture === null,
      `Fixture '${FIXTURE_NAMES.CINE_US}' is not present locally.`,
    );
    expect(fixture!.imagePaths.length).toBe(1);

    const dataset = await readDataset(fixture!.imagePaths[0]);
    expect(dataset.Modality).toBe('US');
    const numberOfFrames = Number(dataset.NumberOfFrames ?? 1);
    expect(numberOfFrames).toBeGreaterThan(1);
  });

  test('cross-for-ct-mr: two series, distinct modality and distinct FoR', async () => {
    const fixture = await loadLocalDicomFixture(FIXTURE_NAMES.CROSS_FOR_CT_MR);
    test.skip(
      fixture === null,
      `Fixture '${FIXTURE_NAMES.CROSS_FOR_CT_MR}' is not present locally.`,
    );

    const datasets = await readAllDatasets(fixture!);
    const modalities = uniqueDefined(datasets.map((d) => d.Modality));
    expect(modalities.has('CT')).toBe(true);
    expect(modalities.has('MR')).toBe(true);

    const forUIDs = uniqueDefined(datasets.map((d) => d.FrameOfReferenceUID));
    expect(
      forUIDs.size,
      'A2d heuristic requires distinct FrameOfReferenceUID across series',
    ).toBeGreaterThanOrEqual(2);
  });

  test('seg-multilabel: DICOM SEG with ≥ 5 segments', async () => {
    const fixture = await loadLocalDicomFixture(FIXTURE_NAMES.SEG_MULTILABEL);
    test.skip(
      fixture === null,
      `Fixture '${FIXTURE_NAMES.SEG_MULTILABEL}' is not present locally.`,
    );
    expect(fixture!.imagePaths.length).toBe(1);

    const dataset = await readDataset(fixture!.imagePaths[0]);
    expect(dataset.SOPClassUID).toBe('1.2.840.10008.5.1.4.1.1.66.4');
    expect(dataset.Modality).toBe('SEG');

    const segments = Array.isArray(dataset.SegmentSequence)
      ? dataset.SegmentSequence
      : dataset.SegmentSequence !== undefined
        ? [dataset.SegmentSequence]
        : [];
    expect(segments.length).toBeGreaterThanOrEqual(5);
  });

  test('rtstruct-typed: RTSTRUCT covering all canonical RTROIInterpretedType values', async () => {
    const fixture = await loadLocalDicomFixture(FIXTURE_NAMES.RTSTRUCT_TYPED);
    test.skip(
      fixture === null,
      `Fixture '${FIXTURE_NAMES.RTSTRUCT_TYPED}' is not present locally.`,
    );
    expect(fixture!.imagePaths.length).toBe(1);

    const dataset = await readDataset(fixture!.imagePaths[0]);
    expect(dataset.SOPClassUID).toBe('1.2.840.10008.5.1.4.1.1.481.3');
    expect(dataset.Modality).toBe('RTSTRUCT');

    const observations = Array.isArray(dataset.RTROIObservationsSequence)
      ? (dataset.RTROIObservationsSequence as Array<{ RTROIInterpretedType?: string }>)
      : [];
    const types = new Set(
      observations.map((o) => o.RTROIInterpretedType).filter((t): t is string => !!t),
    );
    for (const expected of ['GTV', 'CTV', 'PTV', 'ORGAN', 'EXTERNAL', 'AVOIDANCE']) {
      expect(types.has(expected), `RTSTRUCT must contain ${expected}`).toBe(true);
    }
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

  electronTest('signal 9 (A2b): T1+T2 cross-series classification + dashed-stroke action', async ({ page }) => {
    // Reload to reset volume-mode state from the previous test in the
    // worker (test 8 leaves multiViewport.enabled=true plus volume cache
    // entries that prevent the stack canvas from mounting cleanly here).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__XNAT_E2E__, undefined, { timeout: 30_000 });

    const fixture = await loadLocalDicomFixture(FIXTURE_NAMES.MR_T1_T2_SAMEEXAM);
    electronTest.skip(
      fixture === null,
      `Fixture '${FIXTURE_NAMES.MR_T1_T2_SAMEEXAM}' is not present locally.`,
    );

    const datasets = await readAllDatasets(fixture!);
    const seriesGroups = new Map<string, string[]>();
    for (let i = 0; i < datasets.length; i++) {
      const key = datasets[i].SeriesInstanceUID ?? `unknown-${i}`;
      const list = seriesGroups.get(key) ?? [];
      list.push(fixture!.imagePaths[i]);
      seriesGroups.set(key, list);
    }
    const series = [...seriesGroups.values()];

    // Stack mode: the cross-series classifier reads the viewport's
    // `getCurrentImageId()` to resolve viewport source identity, which is
    // populated for stack viewports but not for volume viewports in
    // Phase 1. Until volume-mode viewport identity gets a hook, run the
    // classifier acceptance against stack mode.
    await page.evaluate(() => window.__XNAT_E2E__?.setFakeConnected(true));
    await page.evaluate(() => window.__XNAT_E2E__?.setMultiViewportEnabled(false));
    await page.evaluate(() => window.__XNAT_E2E__?.setLayout('1x2' as const));

    await page.evaluate(async (paths) => {
      await window.__XNAT_E2E__!.loadLocalDicomFiles('panel_0', paths);
    }, series[0]);
    await page.evaluate(async (paths) => {
      await window.__XNAT_E2E__!.loadLocalDicomFiles('panel_1', paths);
    }, series[1]);

    // Wait for both stack canvases to mount.
    for (const pid of ['panel_0', 'panel_1']) {
      await page.locator(`[data-testid="cornerstone-viewport-canvas:${pid}"] canvas`)
        .first().waitFor({ state: 'visible', timeout: 30_000 });
    }

    // Create a structure on panel_0 (the "T1" panel — but identity here
    // depends on which series mounted first; either way it's the native
    // viewport for the segmentation).
    const segId = await page.evaluate(async () => {
      return window.__XNAT_E2E__?.createTestStructure('panel_0', 'T1Native') ?? null;
    });
    expect(segId, 'createTestStructure should return a segmentation id').toBeTruthy();

    // Native viewport: action should be 'reset' (no override applied).
    await expect.poll(async () => {
      return page.evaluate((sid) => window.__XNAT_E2E__?.getCrossSeriesAction(sid, 'panel_0'), segId);
    }, { timeout: 10_000 }).toMatchObject({
      eligibility: 'native',
      action: { kind: 'reset' },
    });

    // Cross-series viewport (panel_1 holds the other series, same FoR):
    // eligibility = cross-series-A2b, action = apply-cross-series.
    await expect.poll(async () => {
      return page.evaluate((sid) => window.__XNAT_E2E__?.getCrossSeriesAction(sid, 'panel_1'), segId);
    }, { timeout: 10_000 }).toMatchObject({
      eligibility: 'cross-series-A2b',
      action: { kind: 'apply-cross-series', visible: true },
    });
  });

  // FIXME: Cornerstone's wadouri 'instance' metadata module does not surface
  // AcquisitionNumber for dicomfile: image IDs. The A2c branch of
  // classifyForEligibility (visibility.ts:80-87) needs both sides to have a
  // non-null AcquisitionNumber to distinguish A2c from A2b; with that gap
  // the synthetic fixture classifies as A2b instead of A2c. Real DICOM
  // loaded via XNAT's wadouri endpoint exposes AcquisitionNumber via the
  // QIDO-RS metadata pre-fetch, which is why the live-XNAT E2E paths don't
  // hit this. Fix is to either ship a per-imageId AcquisitionNumber
  // metadata provider for the dicomfile: scheme or surface it via the
  // dicomwebLoader.orderImageIdsByDicomMetadata pre-load — both are
  // Phase 2.x territory. Promote back to a real test once that's wired.
  electronTest.fixme('signal 10 (A2c): sameforuid-different-acquisition is hidden by default on the cross-series viewport', async ({ page }) => {
    const fixture = await loadLocalDicomFixture(FIXTURE_NAMES.SAMEFORUID_DIFFERENT_ACQUISITION);
    electronTest.skip(
      fixture === null,
      `Fixture '${FIXTURE_NAMES.SAMEFORUID_DIFFERENT_ACQUISITION}' is not present locally.`,
    );

    const datasets = await readAllDatasets(fixture!);
    const seriesGroups = new Map<string, string[]>();
    for (let i = 0; i < datasets.length; i++) {
      const key = datasets[i].SeriesInstanceUID ?? `unknown-${i}`;
      const list = seriesGroups.get(key) ?? [];
      list.push(fixture!.imagePaths[i]);
      seriesGroups.set(key, list);
    }
    const series = [...seriesGroups.values()];

    await page.evaluate(() => window.__XNAT_E2E__?.setFakeConnected(true));
    await page.evaluate(() => window.__XNAT_E2E__?.setMultiViewportEnabled(true));
    await page.evaluate(() => window.__XNAT_E2E__?.setLayout('1x2' as const));

    await page.evaluate(async (paths) => {
      await window.__XNAT_E2E__!.loadLocalDicomFiles('panel_0', paths);
    }, series[0]);
    await page.evaluate(async (paths) => {
      await window.__XNAT_E2E__!.loadLocalDicomFiles('panel_1', paths);
    }, series[1]);

    for (const pid of ['panel_0', 'panel_1']) {
      const c = page.locator(`[data-testid="volume-viewport-canvas:${pid}"] canvas, [data-testid="cornerstone-viewport-canvas:${pid}"] canvas`);
      await c.first().waitFor({ state: 'visible', timeout: 30_000 });
    }

    const segId = await page.evaluate(async () => {
      return window.__XNAT_E2E__?.createTestStructure('panel_0', 'A2cNative') ?? null;
    });
    expect(segId, 'createTestStructure should return a segmentation id').toBeTruthy();

    // Native viewport: action 'reset'.
    await expect.poll(async () => {
      return page.evaluate((sid) => window.__XNAT_E2E__?.getCrossSeriesAction(sid, 'panel_0'), segId);
    }, { timeout: 10_000 }).toMatchObject({
      eligibility: 'native',
      action: { kind: 'reset' },
    });

    // Cross-series viewport: same FoR, different AcquisitionNumber → A2c.
    // Action should be 'hide' because Phase 2 ships with a2cOptedIn=false
    // (per-container opt-in lands in Phase 3).
    await expect.poll(async () => {
      return page.evaluate((sid) => window.__XNAT_E2E__?.getCrossSeriesAction(sid, 'panel_1'), segId);
    }, { timeout: 10_000 }).toMatchObject({
      eligibility: 'cross-series-A2c',
      action: { kind: 'hide' },
    });
  });
});
