/**
 * Bug (user-reported): a measurement's color can't be set — the row swatch is grey,
 * and the drawn measurement renders green (while drawing) then yellow (Cornerstone's
 * default annotation style), never the chosen color. Root cause: onColorChange only
 * handled numeric SEG/RTSTRUCT indices (NaN for an SR annotationUID → no-op), and
 * measurements were never assigned a display color.
 *
 * Real affordances + real display surface: draw a Length → the row swatch is a real
 * color (not grey) and the rendered SVG stroke is NOT Cornerstone's default yellow;
 * pick a palette color → both the swatch and the rendered stroke become that color.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../helpers/local-fixture';

interface E2EHooks {
  setActiveUnifiedTool: (toolName: string) => void;
  getMeasurementCount: () => number;
  clearAllContainers: () => void;
}
type Win = { __XNAT_E2E__: E2EHooks };

const GREY = 'rgb(113, 117, 122)';       // swatchColor() placeholder when no color
const CS_DEFAULT_YELLOW = 'rgb(255, 255, 0)'; // Cornerstone's default annotation color

const cleanSlate = async (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers());
test.beforeEach(({ page }) => cleanSlate(page));
test.afterEach(({ page }) => cleanSlate(page));

/** All stroke colors (attribute or computed) on the viewport's annotation SVG layer. */
const svgStrokes = (page: Page) =>
  page.locator('[data-testid="unified-viewport-element:panel_0"] .svg-layer [stroke]').evaluateAll((els) =>
    els.map((e) => e.getAttribute('stroke') || getComputedStyle(e as Element).stroke),
  );

test('a measurement gets a real display color (not green/yellow) and the swatch picker recolors it', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');

  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  }
  await expect(panel).toBeVisible({ timeout: 15_000 });

  // Draw a Length.
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setActiveUnifiedTool('Length'));
  const canvas = page.locator('[data-testid="unified-viewport-element:panel_0"] canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const cy = box!.y + box!.height / 2;
  await page.mouse.move(box!.x + box!.width * 0.35, cy);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.65, cy, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getMeasurementCount()), { timeout: 15_000 })
    .toBe(1);

  // The row swatch shows a real color (the default-assigned one), not the grey placeholder.
  const swatch = panel.locator('[data-testid^="color-swatch-"]').first();
  await expect(swatch).toBeVisible();
  const defaultSwatch = await swatch.evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(defaultSwatch).not.toBe(GREY);

  // The rendered measurement is NOT Cornerstone's default yellow.
  await expect.poll(() => svgStrokes(page), { timeout: 10_000 }).not.toEqual([]);
  expect(await svgStrokes(page)).not.toContain(CS_DEFAULT_YELLOW);

  // Open the picker, choose a specific palette color → swatch + rendered stroke follow it.
  await swatch.click();
  const picker = panel.locator('[data-testid^="color-picker-"]').first();
  await expect(picker).toBeVisible();
  const paletteSwatch = picker.getByLabel('Set color 3');
  const chosen = await paletteSwatch.evaluate((e) => getComputedStyle(e).backgroundColor);
  await paletteSwatch.click();

  await expect.poll(() => swatch.evaluate((e) => getComputedStyle(e).backgroundColor), { timeout: 10_000 }).toBe(chosen);
  await expect.poll(() => svgStrokes(page), { timeout: 10_000 }).toContain(chosen);
});
