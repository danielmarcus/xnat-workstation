/**
 * Auto Review flythrough (SegWorks parity D6, #213–221; branch 2 R4): from the container
 * menu or ⇧Space, the viewport steps through exactly the segmented slice range, flickering
 * the masks (anatomy, then mask) on each; Esc stops and always restores the masks.
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
async function stroke(page: Page) {
  const b = await box(page);
  await page.mouse.move(b.x + b.width * 0.36, b.y + b.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.44, b.y + b.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}
async function clip(page: Page) {
  const b = await box(page);
  await page.mouse.move(b.x - 40, b.y + 10);
  const s = b.width * 0.1;
  return (await page.screenshot({ clip: { x: b.x + b.width * 0.4 - s / 2, y: b.y + b.height * 0.5 - s / 2, width: s, height: s } })).toString('base64');
}
const shown = async (page: Page) =>
  Number((await page.getByTestId('overlay-field-imageIndex:panel_0').innerText()).split('/')[0].trim());

/** Paint the displayed slices first, first+2, first+4; returns them and the panel. */
async function segmentedRange(page: Page) {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  await clickTool(panel.locator('[data-testid="context-toolbox"]'), 'Brush');
  const painted: number[] = [];
  for (let i = 0; i < 3; i++) {
    await stroke(page);
    painted.push(await shown(page));
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);
  }
  return { panel, painted };
}

async function startFromMenu(panel: ReturnType<Page['locator']>) {
  await panel.getByRole('button', { name: 'Container menu' }).first().click();
  await panel.getByRole('menuitem', { name: 'Review flythrough' }).click();
}

test('the review visits exactly the segmented range, in order, then ends', async ({ page }) => {
  const { panel, painted } = await segmentedRange(page);
  const lo = Math.min(...painted);
  const hi = Math.max(...painted);
  await startFromMenu(panel);
  await expect(page.getByTestId('flythrough-player')).toBeVisible();
  await expect(page.getByTestId('flythrough-position')).toContainText(`(${lo}–${hi})`);

  const visited: number[] = [];
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && (await page.getByTestId('flythrough-player').count()) > 0) {
    const s = await shown(page);
    if (visited[visited.length - 1] !== s) visited.push(s);
    await page.waitForTimeout(100);
  }
  const expected = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  expect(visited).toEqual(expected);
  await expect(page.getByTestId('flythrough-player')).toHaveCount(0);
});

test('flicker shows the anatomy without the mask, then the mask; Esc stops and restores it', async ({ page }) => {
  const { panel, painted } = await segmentedRange(page);
  // Back to a painted slice, and capture the mask as drawn.
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(300);
  expect(await shown(page)).toBe(Math.min(...painted));
  const withMask = await clip(page);

  await startFromMenu(panel);
  await page.getByRole('button', { name: 'Review settings' }).click();
  await page.getByLabel('Anatomy dwell').fill('2000');
  await page.getByRole('button', { name: 'Restart with these settings' }).click();
  await expect(page.getByTestId('flythrough-position')).toContainText('anatomy');
  expect((await changedRegion(page, withMask, await clip(page))).fraction, 'mask hidden during the anatomy phase').toBeGreaterThan(0.1);

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('flythrough-player')).toHaveCount(0);
  await page.waitForTimeout(300);
  expect((await changedRegion(page, withMask, await clip(page))).count, 'mask restored').toBe(0);
  // The panel's visibility state was never touched.
  await expect(panel.getByRole('button', { name: /Cycle visibility \(currently filled\)/ })).toBeVisible();
});

test('⇧Space starts and stops the review of the active segmentation', async ({ page }) => {
  await segmentedRange(page);
  await page.keyboard.press('Shift+Space');
  await expect(page.getByTestId('flythrough-player')).toBeVisible();
  await page.keyboard.press('Shift+Space');
  await expect(page.getByTestId('flythrough-player')).toHaveCount(0);
});

test('with nothing segmented it says so instead of starting', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  await startFromMenu(panel);
  await expect(page.getByTestId('viewport-hud')).toHaveText('Nothing segmented to review');
  await expect(page.getByTestId('flythrough-player')).toHaveCount(0);
});
