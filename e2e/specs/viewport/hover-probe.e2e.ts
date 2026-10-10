/**
 * Hold-Q intensity probe (SegWorks parity #25; branch 2 R3): while Q is held the value
 * under the cursor is shown beside it — in HU on CT — without changing the active tool;
 * releasing Q removes it. Ground truth is the anatomy phantom's known regions (air −1000,
 * soft tissue +40, bone core +1000 HU).
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

const VIEWPORT = '[data-testid="unified-viewport-element:panel_0"]';

async function hoverAt(page: Page, fx: number, fy: number) {
  const b = (await page.locator(`${VIEWPORT} canvas`).boundingBox())!;
  await page.mouse.move(b.x + b.width * fx, b.y + b.height * fy, { steps: 3 });
}

test('holding Q reads the intensity under the cursor, in HU, and releasing it clears the readout', async ({ page }) => {
  await loadFixture(page, 'ct-axial-anatomy', 'panel_0');
  await hoverAt(page, 0.5, 0.5);
  await expect(page.getByTestId('hover-probe')).toHaveCount(0);

  await page.keyboard.down('q');
  await expect(page.getByTestId('hover-probe')).toContainText(/^HU 1000 · \(\d+, \d+, \d+\)$/);
  await hoverAt(page, 0.5, 0.75);
  await expect(page.getByTestId('hover-probe')).toContainText(/^HU 40 /);
  await hoverAt(page, 0.5, 0.04); // air, inside the image
  await expect(page.getByTestId('hover-probe')).toContainText(/^HU -1000 /);
  await hoverAt(page, 0.01, 0.5); // beside the image: nothing to read
  await expect(page.getByTestId('hover-probe')).toHaveCount(0);
  await page.keyboard.up('q');
  await expect(page.getByTestId('hover-probe')).toHaveCount(0);
});

test('probing does not change the active tool', async ({ page }) => {
  await loadFixture(page, 'ct-axial-anatomy', 'panel_0');
  await page.locator(VIEWPORT).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('z'); // Zoom
  const zoom = page.getByRole('button', { name: /Zoom/ }).first();
  const pressedBefore = await zoom.getAttribute('class');
  await hoverAt(page, 0.5, 0.5);
  await page.keyboard.down('q');
  await expect(page.getByTestId('hover-probe')).toBeVisible();
  await page.keyboard.up('q');
  expect(await zoom.getAttribute('class')).toBe(pressedBefore);
});
