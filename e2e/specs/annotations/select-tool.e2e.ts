/**
 * One Select tool, the same in the Structure and the Segmentation toolbox (unified
 * selection, S1 — docs/unified-selection.md).
 *
 * Before: Structures had "Select ROI" (an arrow-plus-loop icon) and Segmentations had
 * "Select" — Cornerstone's hover tool, which silently changed the active segment and
 * never told the panel — with a different arrow icon, and neither icon matched the
 * cursor. Now both toolboxes offer the same "Select", and its icon is the cursor's arrow.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

const VIEWPORT = '[data-testid="unified-viewport-element:panel_0"]';

async function toolbox(page: Page, create: string) {
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: create }).click();
  await page.keyboard.press('Escape');
  const box = panel.locator('[data-testid="context-toolbox"]');
  await expect(box).toBeVisible({ timeout: 10_000 });
  return box;
}

/** The `d` of the arrow path in the Select button's icon. */
const iconPath = (box: import('@playwright/test').Locator) =>
  box.getByRole('button', { name: 'Select', exact: true }).locator('svg path').first().getAttribute('d');

/** The `d` of the arrow path inside the cursor's SVG data URL. */
const cursorPath = (page: Page) =>
  page.evaluate((vp) => {
    const c = getComputedStyle(document.querySelector(vp) as HTMLElement).cursor;
    const url = c.match(/url\("?data:image\/svg\+xml;utf8,([^"#]+)/)?.[1];
    if (!url) return null;
    const svg = decodeURIComponent(url);
    return svg.match(/<path[^>]* d="([^"]+)"/)?.[1] ?? null;
  }, VIEWPORT);

test('Structure and Segmentation toolboxes offer the same Select, and its icon is the cursor', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');

  const structure = await toolbox(page, 'New Structure (RTSTRUCT)');
  await expect(structure.getByRole('button', { name: 'Select', exact: true })).toBeVisible();
  const structureIcon = await iconPath(structure);
  await structure.getByRole('button', { name: 'Select', exact: true }).click();
  const box = (await page.locator(`${VIEWPORT} canvas`).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(150);
  const cursor = await cursorPath(page);

  const segmentation = await toolbox(page, 'New Segmentation (SEG)');
  await expect(segmentation.getByRole('button', { name: 'Select', exact: true })).toBeVisible();
  const segmentationIcon = await iconPath(segmentation);

  expect(structureIcon, 'one Select: the same icon in both toolboxes').toBe(segmentationIcon);
  expect(cursor, 'the cursor is drawn').not.toBeNull();
  expect(structureIcon, 'the icon is the cursor\'s arrow').toBe(cursor);
});
