/**
 * An operation refuses when the active viewport does not show the active segment (#91,
 * ledger X3).
 *
 * Mask operations take "the slice on screen" from the active viewport's camera, projected
 * into the active container's grid. With a second scan in the other viewport of a 1×2
 * layout, clicking that viewport left the segment active while the camera belonged to a
 * scan the segment is not drawn on: Cleanup ran on whatever grid slice that camera mapped
 * to — an edit nobody was looking at. It must refuse with a visible message instead, and
 * no voxel may change.
 *
 * Two CT breath-holds in ONE frame of reference (breath-hold-pair): the geometry lines up,
 * so the stray camera lands on a real slice of the segment's grid — the dangerous case.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadTwoSeries } from '../../helpers/local-fixture';
import { clickTool } from '../../helpers/toolbox';
import { openOperation } from '../../helpers/operations';

type Win = { __XNAT_E2E__: { activeSegmentVoxelCount: () => number } };
const voxels = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.activeSegmentVoxelCount());

/** A closed brush ring on panel_0 — its centre is a hole Fill holes would fill. */
async function ring(page: Page) {
  const b = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;
  const cx = b.x + b.width * 0.5, cy = b.y + b.height * 0.5, r = b.width * 0.12;
  await page.mouse.move(cx + r, cy);
  await page.mouse.down();
  for (let i = 1; i <= 40; i++) {
    const a = (i / 40) * 2 * Math.PI;
    await page.mouse.move(cx + r * Math.cos(a), cy + r * Math.sin(a), { steps: 2 });
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
}

test('Cleanup on a viewport that does not show the segment refuses and changes nothing', async ({ page }) => {
  await loadTwoSeries(page, 'breath-hold-pair', 'bh1-', 'bh2-');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });

  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  // Each scan has its own segmentation, so the panel lists something on either viewport.
  // panel_1 (breath-hold 2) is focused after loading: its segmentation first.
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  // Viewports are focused with Select, which never paints.
  await clickTool(toolbox, 'Select');
  await page.locator('[data-testid="unified-viewport:panel_0"]').click({ position: { x: 20, y: 20 } });
  // The segment under test lives on panel_0's scan (breath-hold 1).
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  await clickTool(toolbox, 'Brush');
  await ring(page);
  const painted = await voxels(page);
  expect(painted).toBeGreaterThan(0);
  await clickTool(toolbox, 'Select');

  const sheet = await openOperation(panel, 'Cleanup', 'Fill holes');
  // Make panel_1 (breath-hold 2) the active viewport. The segment stays active.
  await page.locator('[data-testid="unified-viewport:panel_1"]').click({ position: { x: 20, y: 20 } });
  await expect(page.locator('[data-testid="unified-viewport:panel_1"]')).toHaveAttribute('data-active', 'true');
  expect(await voxels(page), 'focusing a viewport does not change the active segment').toBe(painted);
  await sheet.getByRole('button', { name: 'Commit' }).click();
  await page.waitForTimeout(500);
  expect(await voxels(page), 'no voxel may change').toBe(painted);
  await expect(page.getByTestId('mask-preview-bar')).toHaveCount(0);
  await expect(sheet.getByTestId('sheet-message')).toContainText('scan in this viewport');

  // Back on the segment's own viewport the same operation runs.
  await page.locator('[data-testid="unified-viewport:panel_0"]').click({ position: { x: 20, y: 20 } });
  await sheet.getByRole('button', { name: 'Commit' }).click();
  await expect.poll(() => voxels(page)).toBeGreaterThan(painted);
});
