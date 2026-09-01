/**
 * Bug (user-reported, screenshot): with one segmentation's segment selected in the
 * panel, the brush painted into a DIFFERENT segmentation (the most-recently-created
 * one). Root cause: the panel's activateAndBridge set only the Zustand store's
 * activeSegmentationId/Index — it never routed CORNERSTONE's active segmentation
 * (the brush target). So the brush kept painting whichever segmentation Cornerstone
 * last activated (the last-created), regardless of the panel selection.
 *
 * This drives the real panel: create two segmentations, then re-select the first and
 * assert Cornerstone's active segmentation (the brush target) follows the selection.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page, Locator } from '@playwright/test';
import { loadFixture } from '../helpers/local-fixture';

interface E2EHooks {
  getCsActiveSegmentationId: (panelId: string) => string | null;
}
type Win = { __XNAT_E2E__: E2EHooks };
const csActive = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getCsActiveSegmentationId('panel_0'));

async function createSeg(panel: Locator, name: string) {
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  const rc = panel.getByLabel('Rename container');
  await rc.fill(name);
  await rc.press('Enter');
  const rm = panel.getByLabel('Rename member');
  if (await rm.isVisible({ timeout: 5_000 }).catch(() => false)) await rm.press('Enter');
}

test('selecting a segmentation routes the brush to it (not the last-created)', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  await expect(panel).toBeVisible({ timeout: 15_000 });

  await createSeg(panel, 'Alpha');
  const subA = (await csActive(page)) ?? '';
  expect(subA).toBeTruthy();

  await createSeg(panel, 'Beta');
  const subB = (await csActive(page)) ?? '';
  expect(subB).toBeTruthy();
  // The most-recently-created (Beta) is now Cornerstone's active brush target.
  expect(subB).not.toBe(subA);

  // Re-select Alpha in the panel → the brush target must move back to Alpha's sub-seg.
  const groupA = subA.replace(/_layer_\d+$/, '');
  await panel.locator(`[data-testid="container-activate-${groupA}"]`).click();
  await expect
    .poll(() => csActive(page), {
      timeout: 10_000,
      message: 'the brush target (cs active segmentation) should follow the selected segmentation',
    })
    .toBe(subA);
});
