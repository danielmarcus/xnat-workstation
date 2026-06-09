/**
 * Two-panel cross-series pixel-diff harness (Phase 2 signals 9/10/11 — A2 / D9).
 *
 * The harness: load two series of one study into a 1×2 layout (panel_0 + panel_1)
 * and pixel-compare the canvases — the infrastructure the cross-series rendering
 * signals were blocked on. `loadTwoSeries` is the reusable piece.
 *
 * HARNESS FINDING (recorded honestly): the eligibility-aware attach
 * (unifiedSegService.attachLabelmapWithEligibility — classify native / cross-show /
 * cross-hide / different-FoR + per-viewport style, Slice 2, unit-verified) is NOT
 * wired into the live SEG-create/attach flow. createUnifiedLabelmapSegmentation /
 * segmentationService.addToViewport attach a labelmap to ALL unified viewports
 * unconditionally (the MPR behavior), so a same-FoR sibling shows the SEG at full
 * (native) opacity rather than dimmed (D9), a displaced sibling is not hidden
 * (A2c), and a different-FoR panel still gets a (non-rendering) representation
 * instead of being skipped (A2d). The signals below that depend on that wiring are
 * `fixme` — the harness drives them and will verify them once the eligibility
 * attach is routed into the live flow (the next slice).
 *
 * Fixtures (on disk): mr-t1-t2-sameexam (same FoR), breath-hold-pair (same FoR,
 * bulk-displaced), cross-for-ct-mr (different FoR).
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadTwoSeries } from '../helpers/local-fixture';

interface E2EHooks {
  setMultiviewportEnabled: (v: boolean) => void;
  setActiveUnifiedTool: (toolName: string) => void;
  createUnifiedLabelmapSegmentation: (label?: string) => Promise<{ segmentationId: string; segmentIndex: number }>;
  setUnifiedBrushSize: (size: number) => void;
  getPaintedVoxelCount: () => number;
}
type Win = { __XNAT_E2E__: E2EHooks };

const canvas = (page: Page, pid: string) =>
  page.locator(`[data-testid="unified-viewport-element:${pid}"] canvas`);

async function brushStroke(page: Page, box: { x: number; y: number; width: number; height: number }) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const d = Math.min(box.width, box.height) * 0.12;
  await page.mouse.move(cx - d, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy, { steps: 4 });
  await page.mouse.move(cx + d, cy + d, { steps: 4 });
  await page.mouse.up();
}

async function paintSegOnPanel0(page: Page, label: string) {
  const p0 = canvas(page, 'panel_0');
  await p0.click(); // activate panel_0 (centre — corners hold overlay controls)
  await page.evaluate((l) => (window as unknown as Win).__XNAT_E2E__.createUnifiedLabelmapSegmentation(l), label);
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setUnifiedBrushSize(25));
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setActiveUnifiedTool('Brush'));
  const box0 = await p0.boundingBox();
  expect(box0).not.toBeNull();
  await brushStroke(page, box0!);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelCount()), { timeout: 15_000 })
    .toBeGreaterThan(0);
}

test.beforeEach(async ({ page }) => {
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setMultiviewportEnabled(true));
});

test('harness: two same-exam series load into a 1×2 grid and render independently', async ({ page }) => {
  await loadTwoSeries(page, 'mr-t1-t2-sameexam', 't1-slice', 't2-slice');
  const p0 = canvas(page, 'panel_0');
  const p1 = canvas(page, 'panel_1');
  await expect(p0).toBeVisible({ timeout: 30_000 });
  await expect(p1).toBeVisible({ timeout: 30_000 });
  // Two DIFFERENT series (T1 vs T2) → distinct rendered pixels.
  expect((await p0.screenshot()).equals(await p1.screenshot())).toBe(false);
});

test('cross-series render presence: a SEG painted on the T1 panel appears on the same-FoR T2 panel', async ({ page }) => {
  await loadTwoSeries(page, 'mr-t1-t2-sameexam', 't1-slice', 't2-slice');
  const p1 = canvas(page, 'panel_1');
  await expect(canvas(page, 'panel_0')).toBeVisible({ timeout: 30_000 });
  await expect(p1).toBeVisible({ timeout: 30_000 });

  const p1Before = await p1.screenshot();
  await paintSegOnPanel0(page, 'Cross-series SEG');

  // The world-space labelmap renders on the same-FoR sibling panel (signal 9 render
  // presence). NB: full-opacity here — the D9 non-native dimming needs the
  // eligibility attach (fixme below); it is unit-verified in Slice 2.
  await expect
    .poll(async () => !(await p1.screenshot()).equals(p1Before), {
      timeout: 15_000,
      message: 'cross-series SEG should render on the same-FoR T2 panel (A2b)',
    })
    .toBe(true);
});

// PENDING — needs the eligibility attach wired into the live SEG flow (see header).
// The same-FoR sibling currently shows the SEG at full (native) opacity; D9 wants a
// dimmed/dashed non-native treatment distinct from the native panel. Verified at the
// unit layer (eligibilityStyle + attachLabelmapWithEligibility setStyle, Slice 2);
// the pixel-level distinction needs the live attach + a tolerance pixel-diff.
test.fixme('signal 9 (D9): the cross-series SEG renders DIMMED (non-native) vs the native panel', async () => {});

// PENDING — A2c displacement-hide. The harness drives the breath-hold pair, but the
// live attach does not compute bulk displacement between the two volumes and hide
// the SEG on the displaced sibling — it renders there (cross-series-show) instead.
// Confirmed RED. Needs: read both volumes' scalar data + bulkDisplacement (Slice 1,
// unit-tested) + route the cross-series attach through attachLabelmapWithEligibility
// so > threshold ⇒ visibility off.
test.fixme('signal 10 (A2c): a SEG on one breath-hold series is HIDDEN on the displaced same-FoR sibling', async ({ page }) => {
  await loadTwoSeries(page, 'breath-hold-pair', 'bh1-slice', 'bh2-slice');
  const p1 = canvas(page, 'panel_1');
  const p1Before = await p1.screenshot();
  await paintSegOnPanel0(page, 'BH SEG');
  await page.waitForTimeout(2000);
  expect((await p1.screenshot()).equals(p1Before)).toBe(true);
});

// PENDING — A2d. The live attach adds a (non-rendering) representation to the
// different-FoR panel instead of skipping it; the SEG should not be attached there
// at all. Robust verification is structural (the SEG's viewport list must exclude
// the different-FoR panel) once the eligibility attach is wired — screenshot-equals
// for "unchanged" is too sensitive (incidental re-renders flake).
test.fixme('signal 11 (A2d): a SEG on the CT panel is NOT attached to the different-FoR MR panel', async () => {});
