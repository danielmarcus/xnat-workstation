/**
 * GH #75 — loading a scan into a SECOND viewport must NOT fire the session-wide
 * unsaved-annotations prompt, and must NOT wipe other panels' unsaved work.
 *
 * The original bug (on the pre-rewrite `multiviewport-annotation` branch):
 * `loadFromXnatScan` unconditionally called `promptToSaveUnsavedAnnotations()` and
 * then session-wide-reset segmentation state — so loading ANY scan into panel_1
 * while panel_0 held unsaved annotations popped a confirm dialog and, on confirm,
 * destroyed panel_0's work. The `annotation-cleanup` rebuild replaced prompt-and-
 * wipe with the Change 1c retention model: same-session loads are panel-scoped
 * (they touch only the target panel) and cross-session loads RETAIN dirty work.
 *
 * This is the anti-regression lock for that resolution, driving the REAL import
 * affordance (file <input> targets the active panel — the same entry point a scan
 * load uses) rather than a hook shortcut. It asserts the #75 acceptance directly:
 * after painting an unsaved SEG on panel_0, loading a different scan into panel_1
 * (a) shows no unsaved/confirm dialog, and (b) leaves panel_0's SEG intact.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { ensureFixture, enterLocalViewer } from '../helpers/local-fixture';

interface E2EHooks {
  setActiveUnifiedTool: (toolName: string) => void;
  createUnifiedLabelmapSegmentation: (label?: string) => Promise<{ segmentationId: string; segmentIndex: number }>;
  setUnifiedBrushSize: (size: number) => void;
  getPaintedVoxelCount: () => number;
  getSegmentationCount: () => number;
  resetUnifiedSegmentations: () => void;
}
type Win = { __XNAT_E2E__: E2EHooks };

const panel = (page: Page, pid: string) => page.locator(`[data-testid="unified-viewport:${pid}"]`);
const canvas = (page: Page, pid: string) => panel(page, pid).locator('canvas');

const chooseLayout = async (page: Page, name: string) => {
  await page.locator('[title^="Viewport layout"]').click();
  await page.getByRole('button', { name }).click();
};

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
  // Isolate from any segmentation a prior test left in the worker-scoped app.
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
});

test('#75: loading a scan into a 2nd viewport keeps panel_0 unsaved work + shows no prompt', async ({ page }) => {
  await enterLocalViewer(page);

  // ── Panel_0: load scan A and paint an UNSAVED segmentation on it ──
  const filesA = ensureFixture('ct-axial-300');
  await page.locator('[data-testid="local-import-input"]').setInputFiles(filesA);
  await expect(canvas(page, 'panel_0')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(page.locator('[data-testid="annotations-side-panel"]')).toBeVisible({ timeout: 15_000 });

  await page.evaluate(
    async () => (await (window as unknown as Win).__XNAT_E2E__.createUnifiedLabelmapSegmentation('Panel0 SEG')).segmentationId,
  );
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setUnifiedBrushSize(25));
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setActiveUnifiedTool('Brush'));
  const box0 = await canvas(page, 'panel_0').boundingBox();
  expect(box0).not.toBeNull();
  await brushStroke(page, box0!);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelCount()), { timeout: 15_000 })
    .toBeGreaterThan(0);

  // Precondition: exactly one (unsaved) container exists, bound to panel_0's work.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getSegmentationCount()))
    .toBe(1);

  // ── Open a 2nd viewport and load a DIFFERENT scan into IT ──
  await chooseLayout(page, '1 x 2');
  await expect(panel(page, 'panel_1')).toHaveCount(1, { timeout: 20_000 });
  await panel(page, 'panel_1').click({ position: { x: 20, y: 20 } });

  // A different fixture so the file <input> change actually fires (re-setting
  // identical files is a no-op). This is the exact action #75 says popped the prompt.
  const filesB = ensureFixture('ct-axial-anatomy');
  await page.locator('[data-testid="local-import-input"]').setInputFiles(filesB);
  await expect(canvas(page, 'panel_1')).toBeVisible({ timeout: 30_000 });

  // ── #75 acceptance ──
  // (a) No unsaved/confirm dialog fired from the 2nd-viewport load.
  await expect(page.locator('[data-testid="close-unsaved-dialog"]')).toHaveCount(0);
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  // (b) Panel_0's unsaved segmentation survived — the load was panel-scoped, not a
  //     session-wide wipe (the old bug would have dropped the count to 0).
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getSegmentationCount()))
    .toBe(1);
  // Both panels still render — the load was additive, not destructive.
  await expect(canvas(page, 'panel_0')).toBeVisible();
  await expect(canvas(page, 'panel_1')).toBeVisible();
});
