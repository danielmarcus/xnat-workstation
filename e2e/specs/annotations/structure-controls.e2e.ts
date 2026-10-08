/**
 * The Structure toolbox has a Controls strip: contour thickness and contour opacity.
 *
 * The legacy segmentation panel showed both for every Structure; they were lost when
 * that panel was deleted (Phase 6.3, 3d8766e) — the rebuilt toolbox only carried the
 * Segmentation controls over. The store fields and segmentationService.updateContourStyle
 * survived, so a Structure's outline could no longer be thickened or faded from the panel.
 *
 * Drives the real panel and sliders, and reads the outline Cornerstone renders.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

const VIEWPORT = '[data-testid="unified-viewport-element:panel_0"]';

/** The rendered contour outline: stroke width and stroke colour. */
const outline = (page: Page) =>
  page.evaluate((vp) => {
    const path = Array.from(document.querySelectorAll(`${vp} .svg-layer path`)).find(
      (n) => (n as SVGGraphicsElement).getBoundingClientRect().width > 5,
    );
    return path ? { width: Number(path.getAttribute('stroke-width')), stroke: path.getAttribute('stroke') ?? '' } : null;
  }, VIEWPORT);

test('the Structure Controls strip sets contour thickness and opacity on the drawn outline', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Structure (RTSTRUCT)' }).click();
  await page.keyboard.press('Escape');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await toolbox.getByRole('button', { name: 'Freehand', exact: true }).click();

  const box = (await page.locator(`${VIEWPORT} canvas`).boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2, r = Math.min(box.width, box.height) * 0.12;
  await page.mouse.move(cx + r, cy);
  await page.mouse.down();
  for (let i = 1; i <= 32; i++) {
    const a = (i / 32) * 2 * Math.PI;
    await page.mouse.move(cx + r * Math.cos(a), cy + r * Math.sin(a), { steps: 2 });
  }
  await page.mouse.up();
  await expect.poll(() => outline(page)).not.toBeNull();
  // Clear the just-drawn contour's selection so its width is the style's, not +selected.
  await toolbox.getByRole('button', { name: 'Select ROI', exact: true }).click();
  await page.mouse.click(box.x + 5, box.y + 5);

  const thickness = toolbox.getByLabel('Contour thickness');
  const opacity = toolbox.getByLabel('Contour opacity');
  await expect(thickness, 'a Structure shows its contour controls').toBeVisible();
  await expect(opacity).toBeVisible();
  await expect(toolbox.getByLabel('Labelmap opacity'), 'no labelmap control on a Structure').toHaveCount(0);

  await thickness.fill('6');
  await expect.poll(async () => (await outline(page))?.width, { message: 'the outline is drawn 6 px wide' }).toBe(6);

  await opacity.fill('50');
  await expect
    .poll(async () => (await outline(page))?.stroke, { message: 'the outline is drawn at 50% opacity' })
    .toMatch(/,\s*0\.5\)$/);
});
