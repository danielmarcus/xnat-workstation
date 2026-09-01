/**
 * P1.7c — signal 7: undo a brush stroke whose panel has since been closed
 * (offline, flag on).
 *
 * MPR-2×2 of one CT over a shared volume + a volume labelmap on every panel.
 * Brush-paint on panel_2 (a reformatted SLICE panel of the MPR layout — panel_3 is
 * the 3D volume rendering, C5c, which is deliberately not a drawing surface), then
 * switch to the `single` layout, which destroys panels 1–3 including the panel the
 * stroke was drawn on. Undo via
 * the GLOBAL history ring (viewport-independent) and confirm the stroke is
 * undone: the labelmap returns to zero painted voxels (structural) and the
 * surviving axial panel reverts (visual). This is the architectural point —
 * undo is bound to the global history, not the (now-gone) source viewport.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { ensureFixture, enterLocalViewer } from '../helpers/local-fixture';

interface E2EHooks {
  setLayoutPreset: (preset: 'single' | 'mpr-2x2') => void;
  setActiveUnifiedTool: (toolName: string) => void;
  createUnifiedLabelmapSegmentation: (label?: string) => Promise<{ segmentationId: string; segmentIndex: number }>;
  setUnifiedBrushSize: (size: number) => void;
  getPaintedVoxelCount: () => number;
  isUnifiedVolumeReady: () => boolean;
  resetUnifiedSegmentations: () => void;
  canUnifiedUndo: () => boolean;
  triggerUnifiedUndo: () => void;
}
type Win = { __XNAT_E2E__: E2EHooks };

async function brushStroke(page: Page, box: { x: number; y: number; width: number; height: number }) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const d = Math.min(box.width, box.height) * 0.12;
  await page.mouse.move(cx - d, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy, { steps: 4 });
  await page.mouse.move(cx + d, cy, { steps: 4 });
  await page.mouse.move(cx + d, cy + d, { steps: 4 });
  await page.mouse.up();
}

test('undo restores a brush stroke after its panel was closed (flag on)', async ({ page }) => {
  await enterLocalViewer(page);
  const files = ensureFixture('ct-axial-300');
  await page.locator('[data-testid="local-import-input"]').setInputFiles(files);
  await expect(page.locator('[data-testid="unified-viewport-element:panel_0"] canvas'))
    .toBeVisible({ timeout: 30_000 });

  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setLayoutPreset('mpr-2x2'));
  for (const id of ['panel_1', 'panel_2', 'panel_3']) {
    await expect(page.locator(`[data-testid="unified-viewport-element:${id}"] canvas`))
      .toBeVisible({ timeout: 30_000 });
  }
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.isUnifiedVolumeReady()), { timeout: 30_000 })
    .toBe(true);

  // Isolate from any segmentation a prior spec left in the worker-scoped app.
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.createUnifiedLabelmapSegmentation('Signal-7 SEG'));
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setUnifiedBrushSize(60));
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setActiveUnifiedTool('Brush'));

  // Baseline painted-voxel count (the worker-scoped app may carry paint from a
  // prior spec). Undo of THIS stroke must return to exactly this baseline.
  const beforeVoxels = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelCount());

  // Brush on panel_2 — a slice panel that the single layout will close.
  const p2 = await page.locator('[data-testid="unified-viewport-element:panel_2"] canvas').boundingBox();
  expect(p2).not.toBeNull();
  await brushStroke(page, p2!);

  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelCount()), { timeout: 15_000 })
    .toBeGreaterThan(beforeVoxels);
  expect(await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.canUnifiedUndo())).toBe(true);

  // Close the source panel by switching to the single layout.
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setLayoutPreset('single'));
  await expect(page.locator('[data-testid="unified-viewport-element:panel_2"]')).toHaveCount(0, { timeout: 15_000 });
  const axCanvas = page.locator('[data-testid="unified-viewport-element:panel_0"] canvas');
  await expect(axCanvas).toBeVisible();
  // The paint persists on the surviving axial panel across the layout swap.
  await page.waitForTimeout(500);
  const paintedShot = await axCanvas.screenshot();

  // Undo via the global history — the source panel (panel_2) is gone.
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.triggerUnifiedUndo());

  // Structural: the stroke is undone — labelmap back to the pre-stroke baseline.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelCount()), {
      timeout: 15_000,
      message: 'undo should restore the pre-stroke painted-voxel count',
    })
    .toBe(beforeVoxels);

  // Visual: the surviving axial panel reverted (paint removed).
  await expect
    .poll(async () => !(await axCanvas.screenshot()).equals(paintedShot), {
      timeout: 15_000,
      message: 'axial panel should revert after undo',
    })
    .toBe(true);
});
