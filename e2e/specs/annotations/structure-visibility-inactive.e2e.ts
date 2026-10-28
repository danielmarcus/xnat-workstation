/**
 * A Structure's eye hides its contour whichever annotation is active. Reported 2026-10-28:
 * with another annotation active (a Segmentation), clicking a Structure member's visibility
 * toggle did not hide the outline: Cornerstone 5 ignores segment visibility for any contour
 * segmentation but the active one (inactiveContourVisibility.ts). Drives the real eye button
 * and the ⋮ menu, and reads the outline Cornerstone draws in the viewport's SVG layer.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Locator, Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

const VIEWPORT = '[data-testid="unified-viewport-element:panel_0"]';
type Win = { __XNAT_E2E__: { clearAllContainers: () => void } };

test.beforeEach(({ page }) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers()));

/** Contour outlines drawn on the viewport (paths wider than a cursor glyph). */
const outlines = (page: Page) =>
  page.evaluate((vp) => Array.from(document.querySelectorAll(`${vp} .svg-layer path`))
    .filter((n) => (n as SVGGraphicsElement).getBoundingClientRect().width > 20).length, VIEWPORT);

async function structureWithContour(page: Page): Promise<Locator> {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Structure (RTSTRUCT)' }).click();
  await page.keyboard.press('Escape');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await toolbox.getByRole('button', { name: 'Freehand', exact: true }).click();
  const box = (await page.locator(`${VIEWPORT} canvas`).boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2, r = Math.min(box.width, box.height) * 0.15;
  await page.mouse.move(cx + r, cy);
  await page.mouse.down();
  for (let i = 1; i <= 32; i++) {
    const a = (i / 32) * 2 * Math.PI;
    await page.mouse.move(cx + r * Math.cos(a), cy + r * Math.sin(a), { steps: 2 });
  }
  await page.mouse.up();
  await expect.poll(() => outlines(page)).toBeGreaterThan(0);
  return panel;
}

/** The Structure member's eye (its row is "ROI 1"; a newer container lists above it). */
const structureEye = (panel: Locator) => panel.locator('[data-testid^="member-row-"]', { hasText: 'ROI 1' }).locator('[aria-label^="Cycle visibility"]');

test('control: with the Structure active, its eye hides the contour', async ({ page }) => {
  const panel = await structureWithContour(page);
  await structureEye(panel).click();
  await expect.poll(() => outlines(page), { message: 'the outline is hidden' }).toBe(0);
});

test('with a Segmentation active, the Structure’s eye still hides its contour — and shows it again', async ({ page }) => {
  const panel = await structureWithContour(page);
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  await expect(panel.getByTestId('editing-chip')).toContainText('Segmentation');
  const eye = structureEye(panel);
  await expect(eye).toBeVisible();
  await eye.click();
  await expect.poll(() => outlines(page), { message: 'the outline is hidden' }).toBe(0);
  await expect(panel.getByTestId('editing-chip'), 'hiding does not change the active annotation').toContainText('Segmentation');
  await eye.click();
  await expect.poll(() => outlines(page), { message: 'and shown again' }).toBeGreaterThan(0);
});

test('with a Segmentation active, the Structure\u2019s ⋮ Hide all hides its contour too', async ({ page }) => {
  const panel = await structureWithContour(page);
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  const structureRow = panel.locator('[data-testid^="container-row-rtstruct"]');
  await structureRow.getByRole('button', { name: 'Container menu' }).click();
  await panel.getByRole('menuitem', { name: 'Hide all' }).click();
  await expect.poll(() => outlines(page), { message: 'the outline is hidden' }).toBe(0);
});
