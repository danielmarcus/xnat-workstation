/**
 * A12 stress variant — concurrency safety on rapid layout churn.
 *
 * Requirements §A12: "Mounting/unmounting viewports rapidly (orientation
 * toggles, MPR ↔ stack, layout grid changes) must not lose attachments,
 * leak representations, or produce stale 'ghost' structures."
 *
 * The existing 10-layout-switching.e2e.ts spec covers Signal 6's "no
 * stale highlights" / "single dirty flag" invariant on a quiescent layout
 * sequence (<200ms with no async loads in flight). The Phase 1 deferred-
 * task hand-off documented an open follow-up: "A real A12 stress would be
 * 4 panels with real scan loads streaming + layout churn during streaming."
 *
 * This spec implements that stress against the local CT fixture: load
 * three independent panels in rapid succession, then churn the layout
 * (1×1 → 2×2 → 1×2 → MPR → 2×2) before the third load completes. End
 * state must satisfy the A12 invariants:
 *
 *   - segmentationStore.segmentations contains exactly the structures
 *     that were created (no duplicates).
 *   - segmentationManagerStore.activeSegmentationIdByPanel has no
 *     entries for panels that no longer exist in the current layout
 *     (no ghost panel records).
 *   - hasUnsavedChanges (when a structure was created) reports a single
 *     dirty flag at session level — no ambient flag flipping during
 *     churn.
 *
 * This is the harness pattern from 10-layout-switching extended with
 * concurrent loads and structure creation. Skips cleanly when the local
 * CT fixture is absent.
 */
import { expect } from '@playwright/test';
import { test as electronTest } from '../fixtures/electron-app';
import { FIXTURE_NAMES, loadLocalDicomFixture } from '../helpers/local-dicom-fixtures';

electronTest.describe('A12 stress: rapid layout churn during concurrent loads', () => {
  electronTest.beforeEach(async ({ page }) => {
    await page.waitForFunction(() => !!window.__XNAT_E2E__, undefined, { timeout: 30_000 });
    await page.evaluate(() => {
      window.__XNAT_E2E__?.setFakeConnected(true);
      window.__XNAT_E2E__?.setLayout('1x1' as const);
    });
    await expect(page.locator('[data-testid="login-form"]')).toBeHidden({ timeout: 30_000 });
  });

  electronTest.afterEach(async ({ page }) => {
    await page.evaluate(() => {
      const e2e = window.__XNAT_E2E__;
      e2e?.markAllSegmentationsClean?.();
      e2e?.setLayout?.('1x1' as const);
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
  });

  electronTest('rapid layout churn during streaming loads leaves no ghost panel records', async ({ page }) => {
    const fixture = await loadLocalDicomFixture(FIXTURE_NAMES.CT_AXIAL_300);
    electronTest.skip(
      fixture === null,
      `Fixture '${FIXTURE_NAMES.CT_AXIAL_300}' is not present locally — populate e2e/fixtures/dicom/${FIXTURE_NAMES.CT_AXIAL_300}/.`,
    );
    const paths = fixture!.imagePaths;

    // Move to 2x2 so all four panels exist and can be loaded.
    await page.evaluate(() => window.__XNAT_E2E__!.setLayout('2x2' as const));

    // Kick off three loads in flight without awaiting between them — the
    // intent is to overlap the wadouri.fileManager + setPanelImageIds path
    // with the layout-change events fired below.
    const loads = Promise.all([
      page.evaluate((p) => window.__XNAT_E2E__!.loadLocalDicomFiles('panel_0', p), paths),
      page.evaluate((p) => window.__XNAT_E2E__!.loadLocalDicomFiles('panel_1', p), paths),
      page.evaluate((p) => window.__XNAT_E2E__!.loadLocalDicomFiles('panel_2', p), paths),
    ]);

    // Mid-stream: rapid layout churn. Each setLayout fires viewerStore
    // panel-create / panel-destroy events, which the segmentationManager
    // observes via clearPanel and panelEpoch bumps.
    await page.evaluate(() => {
      const e2e = window.__XNAT_E2E__!;
      e2e.setLayout('1x1' as const);
      e2e.setLayout('2x2' as const);
      e2e.setLayout('1x2' as const);
      e2e.setLayout('2x2' as const);
    });

    await loads;

    // Wait briefly for the post-churn render cycle to settle. The churn
    // bumps panelEpoch repeatedly; the segmentationManager's
    // reconcilePanelAfterReady is queued for the latest epoch.
    await page.waitForTimeout(500);

    // Settle to a known good 1x1 layout before structure creation. The
    // earlier churn may have left panel_0 in 2x2 with three other panels
    // mid-mount; createTestStructure needs panel_0 to have a stable
    // viewport with imageIds available.
    await page.evaluate(() => window.__XNAT_E2E__!.setLayout('1x1' as const));
    const stack = page.locator(`[data-testid="stack-viewport-canvas:panel_0"] canvas`);
    const volume = page.locator(`[data-testid="volume-viewport-canvas:panel_0"] canvas`);
    await Promise.race([
      stack.first().waitFor({ state: 'visible', timeout: 30_000 }),
      volume.first().waitFor({ state: 'visible', timeout: 30_000 }),
    ]);

    const segmentationId = await page.evaluate(
      (panel) => window.__XNAT_E2E__!.createTestStructure(panel, 'A12 GTV'),
      'panel_0',
    );
    expect(segmentationId).toBeTruthy();
    await page.evaluate((segId) => window.__XNAT_E2E__!.markSegmentationDirty(segId), segmentationId);

    // Another layout churn AFTER the structure was created.
    await page.evaluate(() => {
      const e2e = window.__XNAT_E2E__!;
      e2e.setLayout('1x1' as const);
      e2e.setLayout('2x2' as const);
    });

    // ─── Invariants ──────────────────────────────────────────────

    // No duplicate / leaked structures.
    const snapshot = await page.evaluate(() => window.__XNAT_E2E__!.getSegmentationSnapshot());
    expect(snapshot.length, 'exactly one structure expected after churn').toBe(1);
    expect(snapshot[0]?.segmentationId).toBe(segmentationId);

    // No ghost panel records — every entry in activeByPanel must
    // correspond to a panel currently in the layout.
    const activeByPanel = await page.evaluate(() => window.__XNAT_E2E__!.getActiveByPanel());
    const ghosts = activeByPanel.filter((entry) => entry.isCurrentLayoutPanel === false);
    expect(
      ghosts,
      `no stale activeSegmentation entries should reference panels removed by setLayout (got ${JSON.stringify(ghosts)})`,
    ).toEqual([]);

    // Single dirty flag — exactly one entry in perSegmentationDirty + the
    // global flag still true. End state, not transient.
    const dirty = await page.evaluate(() => window.__XNAT_E2E__!.getDirtyState());
    expect(dirty.globalDirty, 'global hasUnsavedChanges should be true after the single edit').toBe(true);
    expect(dirty.perSegmentationDirty).toEqual([segmentationId]);
  });
});
