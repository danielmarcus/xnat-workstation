/**
 * The shape tools' add/remove mode, end to end.
 *
 * Cornerstone registers exactly two strategies on each scissors tool — FILL_INSIDE and
 * ERASE_INSIDE. Erase was never reachable in the running app: the fill/erase preference
 * and its Shift-invert lived on the legacy `toolService`, whose `initialize()` is never
 * called outside tests, so `applyScissorPreferences()` always returned early on a
 * tool group that did not exist. The Settings control moved bytes and nothing else.
 *
 * This drives the real surface: click the toolbox toggle, drag the shape over painted
 * voxels, and count what is left in the labelmap. A test that asserted the strategy
 * string would have passed against the dead path too.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

type Win = {
  __XNAT_E2E__: {
    resetUnifiedSegmentations: () => void;
    getPaintedVoxelCount: () => number;
  };
};

const paintedVoxels = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelCount());

async function segToolbox(page: Page) {
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await panel.getByLabel('Rename container').press('Enter');
  const mr = panel.getByLabel('Rename member');
  if (await mr.count()) await mr.press('Enter');
  return panel;
}

/** Drag the active shape tool across the middle of the viewport. */
async function dragShape(page: Page, from: [number, number], to: [number, number]) {
  const vp = page.locator('[data-testid="unified-viewport-element:panel_0"] canvas');
  const box = (await vp.boundingBox())!;
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(400);
}

/**
 * The mode is a PERSISTED preference, so it outlives the autouse page.reload() that
 * gives the other specs their isolation — leaving it on 'erase' made the scissors-fill
 * specs in voxel-tools-effect/-lock fail when they ran after this file, while passing
 * in isolation. Restore it through the same toggle the user would use.
 */
test.afterEach(async ({ page }) => {
  const fill = page
    .locator('[data-testid="scissor-mode-controls"]')
    .getByRole('button', { name: 'fill', exact: true });
  if ((await fill.count()) > 0) await fill.click();
});

test('the shape tools add in fill mode and remove in erase mode', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
  const panel = await segToolbox(page);

  // Fill mode: dragging a rectangle puts voxels in.
  await panel.getByRole('button', { name: 'Rect', exact: true }).click();
  await panel.getByRole('button', { name: 'fill', exact: true }).click();
  await dragShape(page, [120, 120], [240, 240]);

  const afterFill = await paintedVoxels(page);
  expect(afterFill, 'fill mode should paint voxels').toBeGreaterThan(0);

  // Erase mode: dragging the same rectangle takes them back out.
  await panel.getByRole('button', { name: 'erase', exact: true }).click();
  await dragShape(page, [120, 120], [240, 240]);

  const afterErase = await paintedVoxels(page);
  expect(afterErase, 'erase mode should remove the voxels fill added').toBeLessThan(afterFill);
});

test('the mode toggle reflects the active mode and survives a tool switch', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
  const panel = await segToolbox(page);

  await panel.getByRole('button', { name: 'Circle', exact: true }).click();
  await panel.getByRole('button', { name: 'erase', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'erase', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // Switching to another shape tool keeps the mode — it is one setting for the family,
  // not per-tool state, and the toggle must not silently reset to fill.
  await panel.getByRole('button', { name: 'Sphere', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'erase', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
