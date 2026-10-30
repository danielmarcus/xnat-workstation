/**
 * Cleanup › Smooth edges rounds an outline at a scale in mm, in one run. Before, it was a
 * single 3×3 vote: each Commit trimmed one pixel off a thin strand and the next Preview found
 * the next, so Commit looked like it did nothing. A run now goes to a stable result.
 *
 * Drives the real affordances — the brush, the Operation picker, the Radius field, Preview,
 * the Commit button — and asserts the labelmap voxels.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';
import { clickTool } from '../../helpers/toolbox';
import { openOperation } from '../../helpers/operations';

type Win = { __XNAT_E2E__: { clearAllContainers: () => void; activeSegmentVoxelCount: () => number; setUnifiedBrushSize: (n: number) => void } };
const VIEWPORT = '[data-testid="unified-viewport-element:panel_0"]';

test.beforeEach(({ page }) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers()));

const voxels = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.activeSegmentVoxelCount());

async function drag(page: Page, from: [number, number], to: [number, number]) {
  const b = (await page.locator(`${VIEWPORT} canvas`).boundingBox())!;
  await page.mouse.move(b.x + b.width * from[0], b.y + b.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * to[0], b.y + b.height * to[1], { steps: 30 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

test('Smooth edges: one Commit removes a thin strand, and a second run finds nothing', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  await clickTool(panel.locator('[data-testid="context-toolbox"]'), 'Brush');
  // A body, and a one-pixel diagonal strand well away from it.
  await drag(page, [0.4, 0.5], [0.6, 0.5]);
  const body = await voxels(page);
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setUnifiedBrushSize(1));
  await drag(page, [0.2, 0.2], [0.3, 0.32]);
  const before = await voxels(page);
  expect(before - body, 'the strand was painted').toBeGreaterThan(10);

  const sheet = await openOperation(panel, 'Cleanup', 'Smooth edges');
  await expect(sheet.getByText('Radius', { exact: true })).toBeVisible();
  await sheet.getByRole('button', { name: 'Preview' }).click();
  const bar = page.getByTestId('mask-preview-bar');
  await expect(bar).toContainText('Smooth edges');
  await sheet.getByRole('button', { name: 'Commit' }).click();
  await expect(bar).toHaveCount(0);
  // The whole strand went in one run (the body's outline may round a little too).
  await expect.poll(() => voxels(page)).toBeLessThanOrEqual(body);
  expect(await voxels(page)).toBeGreaterThan(body * 0.8);

  await sheet.getByRole('button', { name: 'Preview' }).click();
  await expect(sheet.getByTestId('sheet-message')).toContainText('Nothing to change');
  await expect(bar).toHaveCount(0);
});
