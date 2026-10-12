/**
 * M toggles the active segmentation's masks, and hotkey changes leave a brief readout on
 * the active viewport (SegWorks parity #340, #28; branch 2 R2).
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';
import { clickTool } from '../../helpers/toolbox';
import { changedRegion } from '../../helpers/canvas-pixels';

type Win = { __XNAT_E2E__: { clearAllContainers: () => void } };
const VIEWPORT = '[data-testid="unified-viewport-element:panel_0"]';

test.beforeEach(({ page }) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers()));

async function box(page: Page) {
  return (await page.locator(`${VIEWPORT} canvas`).boundingBox())!;
}
async function clip(page: Page, fx: number, fy: number) {
  const b = await box(page);
  // Off the image, so the brush cursor ring is not in the picture.
  await page.mouse.move(b.x - 40, b.y + 10);
  await page.waitForTimeout(100);
  const s = b.width * 0.1;
  return (await page.screenshot({ clip: { x: b.x + b.width * fx - s / 2, y: b.y + b.height * fy - s / 2, width: s, height: s } })).toString('base64');
}

async function segmentationWithStroke(page: Page) {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await clickTool(toolbox, 'Brush');
  const blank = await clip(page, 0.4, 0.5);
  const b = await box(page);
  await page.mouse.move(b.x + b.width * 0.36, b.y + b.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.44, b.y + b.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  return { blank, painted: await clip(page, 0.4, 0.5) };
}

test('M hides the active segmentation\'s masks and shows them again', async ({ page }) => {
  const { blank, painted } = await segmentationWithStroke(page);
  expect((await changedRegion(page, blank, painted)).fraction, 'the stroke is drawn').toBeGreaterThan(0.1);

  await page.keyboard.press('m');
  await expect(page.getByTestId('viewport-hud')).toHaveText('Masks hidden');
  await page.waitForTimeout(300);
  expect((await changedRegion(page, blank, await clip(page, 0.4, 0.5))).count, 'mask hidden').toBe(0);

  await page.keyboard.press('m');
  await expect(page.getByTestId('viewport-hud')).toHaveText('Masks shown');
  await page.waitForTimeout(300);
  expect((await changedRegion(page, painted, await clip(page, 0.4, 0.5))).count, 'mask back').toBe(0);
});

test('hotkey changes leave a brief readout on the active viewport', async ({ page }) => {
  await segmentationWithStroke(page);
  await page.keyboard.press(']');
  await expect(page.getByTestId('viewport-hud')).toHaveText(/^Brush \d+ mm$/);
  await page.keyboard.press('e');
  await expect(page.getByTestId('viewport-hud')).toHaveText('Mode: Erase');
  await page.keyboard.press('e');
  await expect(page.getByTestId('viewport-hud')).toHaveText('Mode: Fill');
  await page.keyboard.press('w');
  await expect(page.getByTestId('viewport-hud')).toHaveText('Window/Level');
  // It fades on its own.
  await expect(page.getByTestId('viewport-hud')).toHaveCount(0, { timeout: 3000 });
});
