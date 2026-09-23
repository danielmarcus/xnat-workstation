/**
 * A stroke made right after "New Segmentation (SEG)" must mark the container unsaved.
 *
 * Attaching a segmentation to a viewport opens a short wall-clock window in which
 * dirty tracking is suppressed (Cornerstone fires async data-modified events of its
 * own while a representation settles). The edit's undo memo used to be gated on that
 * same window, so a stroke landing inside it — painting straight after creating —
 * changed the voxels but left the container clean: no unsaved count, no leave-guard
 * prompt, no autosave. Driven through the real panel button and a real mouse stroke,
 * with no pause between them.
 */
import { test, expect } from '../../fixtures/electron-app';
import { loadFixture } from '../../helpers/local-fixture';

type Win = { __XNAT_E2E__: {
  setUnifiedBrushSize: (n: number) => void;
  getPaintedVoxelCount: () => number;
  getDirtyFlag: () => boolean;
}; };

test('painting immediately after New Segmentation marks it unsaved', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(panel.locator('[data-testid="unsaved-count"]')).toHaveCount(0);

  const box = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setUnifiedBrushSize(25));

  // Create, then stroke with no settle time in between (create activates the Brush).
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await expect(panel.locator('[data-testid^="container-row-"]')).toHaveCount(1);
  await page.mouse.move(cx - 20, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 20, cy + 20, { steps: 4 });
  await page.mouse.up();

  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelCount()))
    .toBeGreaterThan(0);
  await expect(panel.locator('[data-testid="unsaved-count"]')).toHaveText('1', { timeout: 5_000 });
  expect(await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getDirtyFlag())).toBe(true);
});
