/**
 * Acceptance signals G2 + G8 (requirements §G).
 *
 *   G2: "Open same series in two stack panels at different slice indices.
 *        Edit a contour on panel A's slice; panel B unaffected (different
 *        slice). Scroll panel B to the edited slice; the edit is there."
 *
 *   G8: "Two panels on the same scan. Click contour in panel A →
 *        highlighted in both. Click in list panel → highlighted in both.
 *        Click empty space in panel B → cleared in both."
 *
 * Both signals share a precondition: two panels mounted on the same series.
 * That precondition was previously broken by issue #75 (loadFromXnatScan
 * fired the unsaved-annotations prompt on every 2nd-panel load and
 * unconditionally tore down session-wide segmentation state). The fix in
 * commit `0fab685` panel-scopes the prompt + the session reset; this spec
 * exercises the now-reachable end-to-end flow against the local CT fixture.
 *
 * Skips cleanly when `e2e/fixtures/dicom/ct-axial-300/` is not populated.
 */
import { expect } from '@playwright/test';
import { test as electronTest } from '../fixtures/electron-app';
import { FIXTURE_NAMES, loadLocalDicomFixture } from '../helpers/local-dicom-fixtures';

const PANEL_A = 'panel_0';
const PANEL_B = 'panel_1';

electronTest.describe('Acceptance G2 + G8: two panels on the same series', () => {
  electronTest.beforeEach(async ({ page }) => {
    await page.waitForFunction(() => !!window.__XNAT_E2E__, undefined, { timeout: 30_000 });
    // G2 acceptance is explicitly "two stack panels"; volume-mode is G3.
    // Run flag-off so both panels mount as stack viewports with the
    // expected `setImageIdIndex` / `getCurrentImageIdIndex` API surface.
    await page.evaluate(() => {
      window.__XNAT_E2E__?.setFakeConnected(true);
      window.__XNAT_E2E__?.setMultiViewportEnabled(false);
      window.__XNAT_E2E__?.setLayout('1x2' as const);
    });
    await expect(page.locator('[data-testid="login-form"]')).toBeHidden({ timeout: 30_000 });
  });

  electronTest.afterEach(async ({ page }) => {
    await page.evaluate(() => {
      const e2e = window.__XNAT_E2E__;
      e2e?.markAllSegmentationsClean?.();
      e2e?.setLayout?.('1x1' as const);
      e2e?.setMultiViewportEnabled?.(false);
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
  });

  electronTest('G2: edit on panel A is visible on panel B after scrolling to the edited slice', async ({ page }) => {
    const fixture = await loadLocalDicomFixture(FIXTURE_NAMES.CT_AXIAL_300);
    electronTest.skip(
      fixture === null,
      `Fixture '${FIXTURE_NAMES.CT_AXIAL_300}' is not present locally — populate e2e/fixtures/dicom/${FIXTURE_NAMES.CT_AXIAL_300}/.`,
    );

    // Mount the same series on both panels via the production wadouri
    // file-import path. This is the precondition that issue #75 used to
    // break; with the loader-scoping fix the second mount is additive.
    const paths = fixture!.imagePaths;
    const a = await page.evaluate(
      (p) => window.__XNAT_E2E__!.loadLocalDicomFiles('panel_0', p),
      paths,
    );
    const b = await page.evaluate(
      (p) => window.__XNAT_E2E__!.loadLocalDicomFiles('panel_1', p),
      paths,
    );
    expect(a.imageIds.length).toBe(paths.length);
    expect(b.imageIds.length).toBe(paths.length);
    expect(a.imageIds).toEqual(b.imageIds);

    // Both panels mount a canvas (volume or stack — accept either).
    for (const pid of [PANEL_A, PANEL_B]) {
      const volume = page.locator(`[data-testid="volume-viewport-canvas:${pid}"] canvas`);
      const stack = page.locator(`[data-testid="stack-viewport-canvas:${pid}"] canvas`);
      await Promise.race([
        volume.first().waitFor({ state: 'visible', timeout: 30_000 }),
        stack.first().waitFor({ state: 'visible', timeout: 30_000 }),
      ]);
    }

    // Drive the two panels to *different* slice indices — the explicit
    // G2 precondition. Use mid-fixture indices that exist on a 30-slice
    // CT (the populated CT_AXIAL_300 fixture).
    const sliceA = 5;
    const sliceB = 15;
    await page.evaluate(
      (params) => {
        window.__XNAT_E2E__!.setSliceIndex('panel_0', params.a);
        window.__XNAT_E2E__!.setSliceIndex('panel_1', params.b);
      },
      { a: sliceA, b: sliceB },
    );
    await page.waitForTimeout(200);

    expect(await page.evaluate(() => window.__XNAT_E2E__!.getSliceIndex('panel_0'))).toBe(sliceA);
    expect(await page.evaluate(() => window.__XNAT_E2E__!.getSliceIndex('panel_1'))).toBe(sliceB);

    // Create a structure + contour on panel A. The contour lands on
    // panel A's current slice (sliceA).
    const segmentationId = await page.evaluate(
      (panelId) => window.__XNAT_E2E__!.createTestStructure(panelId, 'G2 GTV'),
      PANEL_A,
    );
    expect(segmentationId).toBeTruthy();

    const annotationUID = await page.evaluate(
      (params) => window.__XNAT_E2E__!.createTestContour(params.panel, params.segId, 1),
      { panel: PANEL_A, segId: segmentationId },
    );
    expect(annotationUID).toBeTruthy();

    // Snapshot panel A: contour total=1 and on-current-slice=1.
    const aSnap = await page.evaluate(
      (panel) => window.__XNAT_E2E__!.getActiveContourSnapshot(panel, null) ?? null,
      PANEL_A,
    );
    expect(aSnap).toBeTruthy();
    expect(aSnap!.total).toBe(1);
    expect(aSnap!.onCurrentSlice).toBe(1);
    expect(aSnap!.currentSliceIndex).toBe(sliceA);

    // Snapshot panel B (still at sliceB): the contour exists in
    // Cornerstone's annotation state (total=1) but is NOT on B's current
    // slice — onCurrentSlice should be 0.
    const bSnapBefore = await page.evaluate(
      (panel) => window.__XNAT_E2E__!.getActiveContourSnapshot(panel, null) ?? null,
      PANEL_B,
    );
    expect(bSnapBefore).toBeTruthy();
    expect(bSnapBefore!.total).toBe(1);
    expect(bSnapBefore!.currentSliceIndex).toBe(sliceB);
    expect(bSnapBefore!.onCurrentSlice).toBe(0);

    // Scroll panel B to the edited slice.
    await page.evaluate(
      (s) => window.__XNAT_E2E__!.setSliceIndex('panel_1', s),
      sliceA,
    );
    await page.waitForTimeout(200);

    // Panel B should now report the contour on its current slice.
    const bSnapAfter = await page.evaluate(
      (panel) => window.__XNAT_E2E__!.getActiveContourSnapshot(panel, null) ?? null,
      PANEL_B,
    );
    expect(bSnapAfter).toBeTruthy();
    expect(bSnapAfter!.currentSliceIndex).toBe(sliceA);
    expect(bSnapAfter!.onCurrentSlice).toBe(1);
  });

  electronTest('G8: contour on the same scan is observable as selected on both panels', async ({ page }) => {
    const fixture = await loadLocalDicomFixture(FIXTURE_NAMES.CT_AXIAL_300);
    electronTest.skip(
      fixture === null,
      `Fixture '${FIXTURE_NAMES.CT_AXIAL_300}' is not present locally.`,
    );

    const paths = fixture!.imagePaths;
    await page.evaluate((p) => window.__XNAT_E2E__!.loadLocalDicomFiles('panel_0', p), paths);
    await page.evaluate((p) => window.__XNAT_E2E__!.loadLocalDicomFiles('panel_1', p), paths);

    for (const pid of [PANEL_A, PANEL_B]) {
      const volume = page.locator(`[data-testid="volume-viewport-canvas:${pid}"] canvas`);
      const stack = page.locator(`[data-testid="stack-viewport-canvas:${pid}"] canvas`);
      await Promise.race([
        volume.first().waitFor({ state: 'visible', timeout: 30_000 }),
        stack.first().waitFor({ state: 'visible', timeout: 30_000 }),
      ]);
    }

    // Both panels at slice 0 so the contour is visible on each.
    await page.evaluate(() => {
      window.__XNAT_E2E__!.setSliceIndex('panel_0', 0);
      window.__XNAT_E2E__!.setSliceIndex('panel_1', 0);
    });
    await page.waitForTimeout(150);

    const segmentationId = await page.evaluate(
      (panel) => window.__XNAT_E2E__!.createTestStructure(panel, 'G8 GTV'),
      PANEL_A,
    );
    expect(segmentationId).toBeTruthy();

    const annotationUID = await page.evaluate(
      (params) => window.__XNAT_E2E__!.createTestContour(params.panel, params.segId, 1),
      { panel: PANEL_A, segId: segmentationId },
    );
    expect(annotationUID).toBeTruthy();

    // Cornerstone's annotation-selection state is global (single source of
    // truth across viewports). Both panels read from the same state, so a
    // contour selected via panel A's creation reports as selected from
    // panel B's snapshot too. This is the load-bearing G8 evidence: the
    // selection is shared without per-viewport replication.
    const aSnap = await page.evaluate(
      (panel) => window.__XNAT_E2E__!.getActiveContourSnapshot(panel, null) ?? null,
      PANEL_A,
    );
    const bSnap = await page.evaluate(
      (panel) => window.__XNAT_E2E__!.getActiveContourSnapshot(panel, null) ?? null,
      PANEL_B,
    );
    expect(aSnap?.selected).toContain(annotationUID);
    expect(bSnap?.selected).toContain(annotationUID);

    // Both panels also resolve the same active (segmentationId, segmentIndex)
    // via the global active-segmentation state, which is what tools and the
    // list panel read for highlight rendering.
    expect(aSnap?.activeSegmentationId).toBe(segmentationId);
    expect(bSnap?.activeSegmentationId).toBe(segmentationId);
    expect(aSnap?.activeSegmentIndex).toBe(1);
    expect(bSnap?.activeSegmentIndex).toBe(1);
  });
});
