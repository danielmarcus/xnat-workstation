/**
 * Acceptance signals G10, G11, G12 — cross-series classifier + drawing routing.
 *
 *   G10: "Open two breath-hold CTs of the same patient (shared FoR, anatomy
 *        displaced). Draw a contour on breath-hold #1. Breath-hold #2 panel
 *        does NOT display it by default. ..." Tests the A2c (same FoR,
 *        different AcquisitionNumber) classifier branch + the off-by-default
 *        rendering action when a2cOptedIn is false.
 *
 *   G11: "Open a CT and an unregistered MR (different FoR, no SRO). The
 *        structure-set from the CT does not display on the MR viewport.
 *        ..." Tests the A2d (different FoR) classifier + 'hide' action.
 *
 *   G12: "Active container is structure-set S1 (native to series A). Focus a
 *        viewport showing series B (same FoR, different series). Try to
 *        draw a contour. Drawing is blocked at gesture-start with a hint
 *        ..." Tests `decideDrawingRouting` returning a `block` decision
 *        with the cross-series reason + a series-A-pointing hint message.
 *
 * G10's classifier path was previously gated on AcquisitionNumber being
 * available for `dicomfile:` IDs (spec 11 had a `test.fixme` here). The
 * `acquisitionNumberProvider.ts` extension landed 2026-05-03 unblocks this.
 *
 * G9 (T1+T2 dashed stroke + hover tooltip + read-only handle drag) is
 * pinned at the classifier-action layer in spec 11; the visual / DOM-overlay
 * parts remain ⏳ on a pixel-comparison or DOM-overlay test that this spec
 * does not attempt.
 */
import { expect } from '@playwright/test';
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
  AcquisitionNumber?: number | string;
  FrameOfReferenceUID?: string;
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

function partitionBy<T, K>(items: T[], key: (item: T) => K): T[][] {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = groups.get(k) ?? [];
    list.push(item);
    groups.set(k, list);
  }
  return [...groups.values()];
}

electronTest.describe('Cross-series acceptance (G10 / G11 / G12)', () => {
  electronTest.beforeEach(async ({ page }) => {
    await page.waitForFunction(() => !!window.__XNAT_E2E__, undefined, { timeout: 30_000 });
    // Stack mode for cross-series classifier coverage. Volume-mode
    // viewport identity gap (spec 11 commentary) means the classifier
    // can't resolve `getCurrentImageId()` for volume viewports yet —
    // a Phase 5 follow-up. Stack mode is the production legacy path
    // and exercises the classifier deterministically.
    await page.evaluate(() => {
      window.__XNAT_E2E__?.setFakeConnected(true);
      window.__XNAT_E2E__?.setMultiViewportEnabled(false);
      window.__XNAT_E2E__?.setLayout('1x2' as const);
    });
    await expect(page.locator('[data-testid="login-form"]')).toBeHidden({ timeout: 30_000 });
  });

  electronTest.afterEach(async ({ page }) => {
    await page.evaluate(() => {
      window.__XNAT_E2E__?.markAllSegmentationsClean?.();
      window.__XNAT_E2E__?.setLayout?.('1x1' as const);
      window.__XNAT_E2E__?.setMultiViewportEnabled?.(false);
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
  });

  electronTest('G10: shared-FoR-different-acquisition is HIDDEN on the cross-series viewport (a2cOptedIn=false)', async ({ page }) => {
    const fixture = await loadLocalDicomFixture(FIXTURE_NAMES.SAMEFORUID_DIFFERENT_ACQUISITION);
    electronTest.skip(
      fixture === null,
      `Fixture '${FIXTURE_NAMES.SAMEFORUID_DIFFERENT_ACQUISITION}' is not present locally.`,
    );

    const datasets = await readAllDatasets(fixture!);
    expect(
      new Set(datasets.map((d) => d.FrameOfReferenceUID)).size,
      'A2c precondition: all instances must share one FrameOfReferenceUID',
    ).toBe(1);
    expect(
      new Set(datasets.map((d) => String(d.AcquisitionNumber ?? ''))).size,
      'A2c precondition: at least two distinct AcquisitionNumbers',
    ).toBeGreaterThanOrEqual(2);

    const series = partitionBy(
      fixture!.imagePaths.map((path, i) => ({ path, ds: datasets[i] })),
      (entry) => entry.ds.SeriesInstanceUID ?? 'unknown',
    ).map((group) => group.map((entry) => entry.path));
    expect(series.length, 'fixture should expose two distinct series').toBeGreaterThanOrEqual(2);

    await page.evaluate((p) => window.__XNAT_E2E__!.loadLocalDicomFiles('panel_0', p), series[0]);
    await page.evaluate((p) => window.__XNAT_E2E__!.loadLocalDicomFiles('panel_1', p), series[1]);

    for (const pid of ['panel_0', 'panel_1']) {
      await page
        .locator(`[data-testid="cornerstone-viewport-canvas:${pid}"] canvas`)
        .first()
        .waitFor({ state: 'visible', timeout: 30_000 });
    }

    const segId = await page.evaluate(
      (panel) => window.__XNAT_E2E__!.createTestStructure(panel, 'A2cNative'),
      'panel_0',
    );
    expect(segId).toBeTruthy();

    // Native viewport: 'reset' (no override applied — the classifier
    // recognises this is the segmentation's home series).
    await expect.poll(async () =>
      page.evaluate((sid) => window.__XNAT_E2E__!.getCrossSeriesAction(sid, 'panel_0'), segId),
    { timeout: 10_000 },
    ).toMatchObject({
      eligibility: 'native',
      action: { kind: 'reset' },
    });

    // Cross-series viewport: same FoR, different AcquisitionNumber → A2c.
    // Action must be 'hide' because the master a2cOptedIn ships false; the
    // structure renders only on the native series until the user opts in.
    await expect.poll(async () =>
      page.evaluate((sid) => window.__XNAT_E2E__!.getCrossSeriesAction(sid, 'panel_1'), segId),
    { timeout: 10_000 },
    ).toMatchObject({
      eligibility: 'cross-series-A2c',
      action: { kind: 'hide' },
    });
  });

  electronTest('G11: cross-FoR (CT + unregistered MR) → structure hidden on the MR viewport', async ({ page }) => {
    const fixture = await loadLocalDicomFixture(FIXTURE_NAMES.CROSS_FOR_CT_MR);
    electronTest.skip(
      fixture === null,
      `Fixture '${FIXTURE_NAMES.CROSS_FOR_CT_MR}' is not present locally.`,
    );

    const datasets = await readAllDatasets(fixture!);
    const forUIDs = new Set(datasets.map((d) => d.FrameOfReferenceUID));
    expect(forUIDs.size, 'cross-FoR fixture must expose two distinct FrameOfReferenceUIDs').toBeGreaterThanOrEqual(2);
    const modalities = new Set(datasets.map((d) => d.Modality));
    expect(modalities.has('CT'), `expected CT modality, got ${[...modalities].join(',')}`).toBe(true);
    expect(modalities.has('MR'), `expected MR modality, got ${[...modalities].join(',')}`).toBe(true);

    // Partition by Modality for clarity — CT to panel_0, MR to panel_1.
    const ct = fixture!.imagePaths.filter((_path, i) => datasets[i].Modality === 'CT');
    const mr = fixture!.imagePaths.filter((_path, i) => datasets[i].Modality === 'MR');
    expect(ct.length).toBeGreaterThan(0);
    expect(mr.length).toBeGreaterThan(0);

    await page.evaluate((p) => window.__XNAT_E2E__!.loadLocalDicomFiles('panel_0', p), ct);
    await page.evaluate((p) => window.__XNAT_E2E__!.loadLocalDicomFiles('panel_1', p), mr);

    for (const pid of ['panel_0', 'panel_1']) {
      await page
        .locator(`[data-testid="cornerstone-viewport-canvas:${pid}"] canvas`)
        .first()
        .waitFor({ state: 'visible', timeout: 30_000 });
    }

    const segId = await page.evaluate(
      (panel) => window.__XNAT_E2E__!.createTestStructure(panel, 'CtNativeStructure'),
      'panel_0',
    );
    expect(segId).toBeTruthy();

    // CT panel: native to the structure → 'reset'.
    await expect.poll(async () =>
      page.evaluate((sid) => window.__XNAT_E2E__!.getCrossSeriesAction(sid, 'panel_0'), segId),
    { timeout: 10_000 },
    ).toMatchObject({
      eligibility: 'native',
      action: { kind: 'reset' },
    });

    // MR panel: different FoR (A2d) → 'hide'. The structure-set must NOT
    // render on the MR viewport per requirements §A2d.
    await expect.poll(async () =>
      page.evaluate((sid) => window.__XNAT_E2E__!.getCrossSeriesAction(sid, 'panel_1'), segId),
    { timeout: 10_000 },
    ).toMatchObject({
      eligibility: 'cross-FoR',
      action: { kind: 'hide' },
    });
  });

  electronTest('G12: drawing on a cross-series viewport is blocked at gesture-start with a series-A-pointing hint', async ({ page }) => {
    const fixture = await loadLocalDicomFixture(FIXTURE_NAMES.MR_T1_T2_SAMEEXAM);
    electronTest.skip(
      fixture === null,
      `Fixture '${FIXTURE_NAMES.MR_T1_T2_SAMEEXAM}' is not present locally.`,
    );

    const datasets = await readAllDatasets(fixture!);
    const series = partitionBy(
      fixture!.imagePaths.map((path, i) => ({ path, ds: datasets[i] })),
      (entry) => entry.ds.SeriesInstanceUID ?? 'unknown',
    ).map((group) => group.map((entry) => entry.path));
    expect(series.length).toBeGreaterThanOrEqual(2);

    await page.evaluate((p) => window.__XNAT_E2E__!.loadLocalDicomFiles('panel_0', p), series[0]);
    await page.evaluate((p) => window.__XNAT_E2E__!.loadLocalDicomFiles('panel_1', p), series[1]);

    for (const pid of ['panel_0', 'panel_1']) {
      await page
        .locator(`[data-testid="cornerstone-viewport-canvas:${pid}"] canvas`)
        .first()
        .waitFor({ state: 'visible', timeout: 30_000 });
    }

    const segId = await page.evaluate(
      (panel) => window.__XNAT_E2E__!.createTestStructure(panel, 'NativePanel0'),
      'panel_0',
    );
    expect(segId).toBeTruthy();

    // Drawing on panel_0 (the native panel for the segmentation) must be
    // ALLOWED — no block at gesture-start.
    const nativeDecision = await page.evaluate(
      (panel) => window.__XNAT_E2E__!.getDrawingRoutingDecision(panel),
      'panel_0',
    );
    expect(nativeDecision.kind).toBe('allow');

    // Drawing on panel_1 (cross-series, same FoR) must be BLOCKED with a
    // 'cross-series' reason. The hint message should be informative —
    // typically pointing the user back to the native series.
    const crossDecision = await page.evaluate(
      (panel) => window.__XNAT_E2E__!.getDrawingRoutingDecision(panel),
      'panel_1',
    );
    expect(crossDecision.kind).toBe('block');
    if (crossDecision.kind === 'block') {
      expect(crossDecision.reason).toBe('cross-series');
      expect(crossDecision.hintMessage).toBeTruthy();
      expect(crossDecision.hintMessage.length).toBeGreaterThan(0);
    }
  });
});
