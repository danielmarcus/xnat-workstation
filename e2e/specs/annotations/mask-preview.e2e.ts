/**
 * Mask-operation preview (SegWorks parity D4 — docs/mockup/segworks-wireframes.html §6).
 *
 * An operation's result is shown before it is written: the labelmap is untouched while
 * the preview is up, the change is DRAWN over the viewport (removed voxels dimmed, added
 * voxels hatched), ⏎ commits it as one undo step, ⎋ leaves no trace, holding `\` hides
 * the overlay to compare, and a preview whose labelmap changes underneath it is
 * discarded rather than committed onto a state it was not computed from.
 *
 * The operation is started through the service hook until the Cleanup sheet (S5) exists
 * to drive it; everything after that — keys, bar, pixels, labelmap — is the real path.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';
import { changedRegion } from '../../helpers/canvas-pixels';

type Win = {
  __XNAT_E2E__: {
    clearAllContainers: () => void;
    previewCleanup: (opId: string, params: Record<string, number | string>, slices: 'current' | 'volume') => { ok: boolean; reason?: string };
    activeSegmentVoxelCount: () => number;
  };
};
const VIEWPORT = '[data-testid="unified-viewport-element:panel_0"]';

test.beforeEach(({ page }) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers()));

async function box(page: Page) {
  return (await page.locator(`${VIEWPORT} canvas`).boundingBox())!;
}

async function stroke(page: Page, fx: number, fy: number, len: number) {
  const b = await box(page);
  const x = b.x + b.width * fx, y = b.y + b.height * fy;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + b.width * len, y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(400);
}

/** A screenshot of a small square of the viewport around (fx, fy), base64. */
async function clip(page: Page, fx: number, fy: number) {
  const b = await box(page);
  const s = b.width * 0.06;
  const shot = await page.screenshot({ clip: { x: b.x + b.width * fx - s / 2, y: b.y + b.height * fy - s / 2, width: s, height: s } });
  return shot.toString('base64');
}

const voxels = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.activeSegmentVoxelCount());
const preview = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.previewCleanup('keepLargest', { alsoKeepPct: 0 }, 'current'));

/** One large island at left, one small island at right, on the current slice. */
async function twoIslands(page: Page) {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  await panel.locator('[data-testid="context-toolbox"]').getByRole('button', { name: 'Brush', exact: true }).click();
  await stroke(page, 0.25, 0.5, 0.2); // large
  await stroke(page, 0.75, 0.5, 0.01); // small
}

const SMALL = [0.755, 0.5] as const;
const LARGE = [0.35, 0.5] as const;

test('a preview draws the change over the image and leaves the labelmap untouched', async ({ page }) => {
  await twoIslands(page);
  const count = await voxels(page);
  const smallBefore = await clip(page, ...SMALL);
  const largeBefore = await clip(page, ...LARGE);

  expect(await preview(page)).toEqual({ ok: true });
  await expect(page.getByTestId('mask-preview-bar')).toContainText('Keep largest');
  await page.waitForTimeout(300);

  expect(await voxels(page), 'nothing written while previewing').toBe(count);
  expect((await changedRegion(page, smallBefore, await clip(page, ...SMALL))).fraction, 'the doomed island is drawn differently').toBeGreaterThan(0.1);
  expect((await changedRegion(page, largeBefore, await clip(page, ...LARGE))).count, 'the kept island is not').toBe(0);
});

test('the bar names the slice the way the viewport numbers it', async ({ page }) => {
  await twoIslands(page);
  // Move off the middle so a reversed numbering cannot coincide with the grid's.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);
  await stroke(page, 0.25, 0.5, 0.2);
  await stroke(page, 0.75, 0.5, 0.01);
  const shown = (await page.getByTestId('overlay-field-imageIndex:panel_0').innerText()).split('/')[0].trim();
  await preview(page);
  await expect(page.getByTestId('mask-preview-bar')).toContainText(`slice ${shown} ·`);
});

test('holding \\ hides the preview to compare against the current mask', async ({ page }) => {
  await twoIslands(page);
  const smallBefore = await clip(page, ...SMALL);
  await preview(page);
  await page.waitForTimeout(300);
  await page.keyboard.down('\\');
  await page.waitForTimeout(200);
  expect((await changedRegion(page, smallBefore, await clip(page, ...SMALL))).count, 'compare shows the mask as it is').toBe(0);
  await page.keyboard.up('\\');
  await page.waitForTimeout(200);
  expect((await changedRegion(page, smallBefore, await clip(page, ...SMALL))).fraction).toBeGreaterThan(0.1);
});

test('⏎ commits the previewed change as ONE undo step', async ({ page }) => {
  await twoIslands(page);
  const count = await voxels(page);
  const smallBefore = await clip(page, ...SMALL);
  await preview(page);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('mask-preview-bar')).toHaveCount(0);
  const after = await voxels(page);
  expect(after).toBeLessThan(count);
  expect(after).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  expect((await changedRegion(page, smallBefore, await clip(page, ...SMALL))).fraction, 'the small island is gone from the image').toBeGreaterThan(0.1);

  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  expect(await voxels(page), 'one undo restores it').toBe(count);
  expect((await changedRegion(page, smallBefore, await clip(page, ...SMALL))).count).toBe(0);
});

test('⎋ discards: no labelmap change, no overlay, nothing to undo', async ({ page }) => {
  await twoIslands(page);
  const count = await voxels(page);
  const smallBefore = await clip(page, ...SMALL);
  await preview(page);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('mask-preview-bar')).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(await voxels(page)).toBe(count);
  expect((await changedRegion(page, smallBefore, await clip(page, ...SMALL))).count).toBe(0);
});

test('painting under a preview discards it instead of committing a stale result', async ({ page }) => {
  await twoIslands(page);
  await preview(page);
  await expect(page.getByTestId('mask-preview-bar')).toBeVisible();
  await stroke(page, 0.5, 0.3, 0.05);
  await expect(page.getByTestId('mask-preview-bar')).toHaveCount(0);
  const count = await voxels(page);
  await page.keyboard.press('Enter'); // nothing pending: must not write anything
  await page.waitForTimeout(200);
  expect(await voxels(page)).toBe(count);
});

