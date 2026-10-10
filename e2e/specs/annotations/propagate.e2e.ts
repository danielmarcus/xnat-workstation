/**
 * Mask propagation (SegWorks parity #169–181; branch 3 I3): from a seed painted inside the
 * anatomy phantom's bone core (+1000 HU in +40 HU tissue), Process › Propagate grows the
 * segment slice by slice through the core and stops where it ends — never into the tissue.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';
import { clickTool } from '../../helpers/toolbox';

type Win = { __XNAT_E2E__: { clearAllContainers: () => void; memberVoxelCount: (i: number) => number; activeSegmentSliceCounts: () => number[]; activeSegmentMinSourceValue: () => number | null } };
const VIEWPORT = '[data-testid="unified-viewport-element:panel_0"]';
const voxels = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.memberVoxelCount(1));
const sliceCounts = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.activeSegmentSliceCounts());
const minValue = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.activeSegmentMinSourceValue());

test.beforeEach(({ page }) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers()));

async function seededSheet(page: Page, paint = true) {
  await loadFixture(page, 'ct-axial-anatomy', 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await clickTool(toolbox, 'Brush');
  if (paint) {
    const b = (await page.locator(`${VIEWPORT} canvas`).boundingBox())!;
    await page.mouse.move(b.x + b.width * 0.49, b.y + b.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.51, b.y + b.height * 0.5, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(250);
  }
  await toolbox.getByRole('tab', { name: 'Process' }).click();
  await toolbox.getByRole('button', { name: 'Propagate', exact: true }).click();
  const sheet = panel.getByTestId('propagate-sheet');
  await expect(sheet).toBeVisible();
  return sheet;
}

test('propagates through the bone core in both directions, and only through bone', async ({ page }) => {
  const sheet = await seededSheet(page);
  expect(await minValue(page), 'the seed is inside the bone core').toBeGreaterThanOrEqual(900);
  const seedVoxels = await voxels(page);
  await sheet.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByTestId('mask-preview-bar')).toContainText('Propagate');
  expect(await voxels(page)).toBe(seedVoxels);
  await page.keyboard.press('Enter');
  await expect.poll(() => voxels(page)).toBeGreaterThan(seedVoxels);

  const counts = await sliceCounts(page);
  const painted = counts.map((c, k) => (c > 0 ? k : -1)).filter((k) => k >= 0);
  expect(painted.length, 'reached neighbouring slices').toBeGreaterThan(2);
  expect(painted.length, 'stopped where the core ends').toBeLessThan(counts.length);
  expect(painted[painted.length - 1] - painted[0] + 1, 'one contiguous run').toBe(painted.length);
  expect(await minValue(page), 'never into the +40 HU tissue').toBeGreaterThanOrEqual(900);

  await page.keyboard.press('Control+z');
  await expect.poll(() => voxels(page)).toBe(seedVoxels);
});

test('forward only stays on one side of the start slice', async ({ page }) => {
  const sheet = await seededSheet(page);
  const seedSlice = (await sliceCounts(page)).findIndex((c) => c > 0);
  await sheet.getByRole('group', { name: 'Direction' }).getByRole('button', { name: 'Forward →' }).click();
  await sheet.getByRole('button', { name: 'Commit' }).click();
  await expect.poll(async () => (await sliceCounts(page)).filter((c) => c > 0).length).toBeGreaterThan(1);
  const painted = (await sliceCounts(page)).map((c, k) => (c > 0 ? k : -1)).filter((k) => k >= 0);
  expect(painted[0] === seedSlice || painted[painted.length - 1] === seedSlice).toBe(true);
});

test('with nothing painted on the slice it says where to start', async ({ page }) => {
  const sheet = await seededSheet(page, false);
  await sheet.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(sheet.getByTestId('sheet-message')).toContainText('Paint the segment on the slice on screen first');
});

