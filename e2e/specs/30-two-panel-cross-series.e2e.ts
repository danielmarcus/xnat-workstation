/**
 * Two-panel cross-series pixel-diff harness (Phase 2 signals 9/10/11 — A2 / D9).
 *
 * The harness: load two series of one study into a 1×2 layout (panel_0 + panel_1)
 * and pixel-compare the canvases. This file's first test proves the harness itself
 * (two distinct same-exam series render independently); later tests layer the
 * cross-series SEG-rendering contract on top.
 *
 * Fixtures (already on disk): mr-t1-t2-sameexam (same FoR — A2b cross-series-show),
 * cross-for-ct-mr (different FoR — A2d not-viewable).
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

test.beforeEach(async ({ page }) => {
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setMultiviewportEnabled(true));
});

test('harness: two same-exam series load into a 1×2 grid and render independently', async ({ page }) => {
  await loadTwoSeries(page, 'mr-t1-t2-sameexam', 't1-slice', 't2-slice');

  const p0 = canvas(page, 'panel_0');
  const p1 = canvas(page, 'panel_1');
  await expect(p0).toBeVisible({ timeout: 30_000 });
  await expect(p1).toBeVisible({ timeout: 30_000 });

  // The two panels show DIFFERENT series (T1 vs T2) → their rendered pixels differ.
  const shot0 = await p0.screenshot();
  const shot1 = await p1.screenshot();
  expect(shot0.equals(shot1)).toBe(false);
});

test('signal 9 (A2b): a SEG painted on the T1 panel also renders on the same-FoR T2 panel (cross-series-show)', async ({ page }) => {
  await loadTwoSeries(page, 'mr-t1-t2-sameexam', 't1-slice', 't2-slice');
  const p0 = canvas(page, 'panel_0');
  const p1 = canvas(page, 'panel_1');
  await expect(p0).toBeVisible({ timeout: 30_000 });
  await expect(p1).toBeVisible({ timeout: 30_000 });

  // Create the SEG on panel_0 (native to T1) and paint a stroke there. Click the
  // canvas centre to activate the panel (the corners hold overlay controls).
  await p0.click();
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.createUnifiedLabelmapSegmentation('Cross-series SEG'));
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setUnifiedBrushSize(25));
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setActiveUnifiedTool('Brush'));

  const p1Before = await p1.screenshot();
  const box0 = await p0.boundingBox();
  expect(box0).not.toBeNull();
  await brushStroke(page, box0!);

  // Native render on panel_0: the stroke painted voxels.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelCount()), { timeout: 15_000 })
    .toBeGreaterThan(0);

  // Cross-series render on panel_1 (T2, same FoR): the SEG appears there too (A2b).
  await expect
    .poll(async () => !(await p1.screenshot()).equals(p1Before), {
      timeout: 15_000,
      message: 'cross-series SEG should render on the same-FoR T2 panel (A2b)',
    })
    .toBe(true);
});

test('signal 11 (A2d): a SEG painted on the CT panel does NOT render on the different-FoR MR panel', async ({ page }) => {
  await loadTwoSeries(page, 'cross-for-ct-mr', 'ct-slice', 'mr-slice');
  const p0 = canvas(page, 'panel_0'); // CT
  const p1 = canvas(page, 'panel_1'); // MR — different frame of reference
  await expect(p0).toBeVisible({ timeout: 30_000 });
  await expect(p1).toBeVisible({ timeout: 30_000 });

  await p0.click();
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.createUnifiedLabelmapSegmentation('CT SEG'));
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setUnifiedBrushSize(25));
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setActiveUnifiedTool('Brush'));

  const p1Before = await p1.screenshot();
  const box0 = await p0.boundingBox();
  expect(box0).not.toBeNull();
  await brushStroke(page, box0!);

  // Native render on the CT panel.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelCount()), { timeout: 15_000 })
    .toBeGreaterThan(0);

  // The MR panel is a DIFFERENT frame of reference (A2d) — the SEG is not viewable
  // there, so painting on the CT must NOT change the MR canvas. Give it time to
  // (not) propagate, then assert it stayed put.
  await page.waitForTimeout(2000);
  expect((await p1.screenshot()).equals(p1Before)).toBe(true);
});
