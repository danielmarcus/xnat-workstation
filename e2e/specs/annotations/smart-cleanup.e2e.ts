/**
 * Smart Cleanup (SegWorks #211–212; branch 1 S8): a cleanup operation run over All
 * segments first proposes a per-segment plan — segments the operation would erode (small
 * or thin) are protected — which the user reviews and edits; the plan then runs as ONE
 * undo step.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';
import { clickTool } from '../../helpers/toolbox';
import { openOperation } from '../../helpers/operations';

type Win = { __XNAT_E2E__: { clearAllContainers: () => void; memberVoxelCount: (i: number) => number } };
const VIEWPORT = '[data-testid="unified-viewport-element:panel_0"]';

test.beforeEach(({ page }) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers()));

const count = (page: Page, i: number) => page.evaluate((idx) => (window as unknown as Win).__XNAT_E2E__.memberVoxelCount(idx), i);

async function stroke(page: Page, fx: number, fy: number, dx: number, dy = 0) {
  const b = (await page.locator(`${VIEWPORT} canvas`).boundingBox())!;
  await page.mouse.move(b.x + b.width * fx, b.y + b.height * fy);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * (fx + dx), b.y + b.height * (fy + dy), { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}

/** Segment 1: a thick blob. Segment 2: a one-voxel-wide line (thin). */
async function blobAndLine(page: Page) {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await clickTool(toolbox, 'Brush');
  for (const y of [0.42, 0.46, 0.5, 0.54]) await stroke(page, 0.25, y, 0.15);
  await panel.getByRole('button', { name: 'Add member' }).first().click();
  await page.keyboard.press('Escape');
  await clickTool(toolbox, 'Brush');
  // Smallest brush for a thin line.
  await toolbox.getByLabel('Brush size').fill('1');
  await stroke(page, 0.55, 0.3, 0.2, 0.25);
  expect(await count(page, 1), 'blob painted').toBeGreaterThan(200);
  expect(await count(page, 2), 'line painted').toBeGreaterThan(0);
  const sheet = await openOperation(panel, 'Cleanup', 'Gaussian smooth');
  await sheet.getByRole('group', { name: 'Labels' }).getByRole('button', { name: 'All segments' }).click();
  return { panel, toolbox, sheet };
}

test('the plan flags the thin segment and protects it; the plan runs as one undo step', async ({ page }) => {
  const { sheet } = await blobAndLine(page);
  const [a, b] = [await count(page, 1), await count(page, 2)];
  const lineRow = sheet.getByTestId('smart-plan-row-2');
  await expect(lineRow).toContainText('thin');
  await expect(lineRow.getByRole('combobox')).toHaveValue('skip');
  await expect(sheet.getByTestId('smart-plan-row-1').getByRole('combobox')).toHaveValue('gaussian');

  await sheet.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByTestId('mask-preview-bar')).toContainText('Smart cleanup');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  expect(await count(page, 2), 'the thin line is untouched').toBe(b);
  expect(await count(page, 1), 'the blob was smoothed').not.toBe(a);

  await page.keyboard.press('Control+z');
  await expect.poll(() => count(page, 1)).toBe(a);
});

test('without protection the same smoothing erodes the thin segment', async ({ page }) => {
  const { sheet } = await blobAndLine(page);
  const b = await count(page, 2);
  await sheet.getByLabel('Protect small and thin segments').uncheck();
  await expect(sheet.getByTestId('smart-plan')).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Commit' }).click();
  await expect.poll(() => count(page, 2)).toBeLessThan(b);
});

test('a plan row can be edited before running', async ({ page }) => {
  const { sheet } = await blobAndLine(page);
  const b = await count(page, 2);
  await sheet.getByTestId('smart-plan-row-2').getByRole('combobox').selectOption('gaussian');
  await sheet.getByRole('button', { name: 'Commit' }).click();
  await expect.poll(() => count(page, 2)).toBeLessThan(b);
});
