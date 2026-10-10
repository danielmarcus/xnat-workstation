/**
 * Segment operations in the Cleanup sheet (SegWorks #196–210; branch 1 S7): Clear over a
 * scope, and the two-segment operations — Move into, Copy into, Magnet bridge — with the
 * sheet's "Into" selector. Each is one undo step across every segment it touches.
 *
 * Drives the real panel (add member, brush, Process tab, sheet) and asserts per-segment
 * voxel counts in the labelmap.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Locator, Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';
import { clickTool } from '../../helpers/toolbox';

type Win = { __XNAT_E2E__: { clearAllContainers: () => void; memberVoxelCount: (i: number) => number } };
const VIEWPORT = '[data-testid="unified-viewport-element:panel_0"]';

test.beforeEach(({ page }) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers()));

const count = (page: Page, i: number) => page.evaluate((idx) => (window as unknown as Win).__XNAT_E2E__.memberVoxelCount(idx), i);

async function stroke(page: Page, fx: number, fy: number, len = 0.08) {
  const b = (await page.locator(`${VIEWPORT} canvas`).boundingBox())!;
  await page.mouse.move(b.x + b.width * fx, b.y + b.height * fy);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * (fx + len), b.y + b.height * fy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}

/** A Segmentation with Segment 1 painted at left and Segment 2 painted at right (active). */
async function twoSegments(page: Page, gap = 0.12) {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await clickTool(toolbox, 'Brush');
  await stroke(page, 0.3, 0.5);
  await panel.getByRole('button', { name: 'Add member' }).first().click();
  await page.keyboard.press('Escape');
  // Escape also selects Window/Level when no name is being captured — pick the brush again.
  await clickTool(toolbox, 'Brush');
  await stroke(page, 0.38 + gap, 0.5);
  // Guard: every assertion below is meaningless if either segment is empty.
  expect(await count(page, 1), 'Segment 1 painted').toBeGreaterThan(0);
  expect(await count(page, 2), 'Segment 2 painted').toBeGreaterThan(0);
  return { panel, toolbox };
}

async function activate(panel: Locator, name: string) {
  await panel.locator('[data-testid^="member-row-"]', { hasText: name }).first().click();
}

async function openOp(toolbox: Locator, panel: Locator, op: string) {
  await toolbox.getByRole('tab', { name: 'Process' }).click();
  await toolbox.getByRole('button', { name: 'Cleanup', exact: true }).click();
  const sheet = panel.getByTestId('cleanup-sheet');
  await sheet.getByLabel('Cleanup operation').selectOption({ label: op });
  return sheet;
}

test('Clear erases the active segment on the slice on screen only', async ({ page }) => {
  const { panel, toolbox } = await twoSegments(page);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(200);
  await stroke(page, 0.5, 0.3); // Segment 2 on a second slice
  const s2 = await count(page, 2);
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(200);
  const sheet = await openOp(toolbox, panel, 'Clear');
  await sheet.getByRole('button', { name: 'Commit' }).click();
  await expect.poll(() => count(page, 2)).toBeLessThan(s2);
  expect(await count(page, 2)).toBeGreaterThan(0); // the other slice survives
  expect(await count(page, 1)).toBeGreaterThan(0); // the other segment survives
});

test('Clear with All segments empties the slice for every segment, as one undo step', async ({ page }) => {
  const { panel, toolbox } = await twoSegments(page);
  const [a, b] = [await count(page, 1), await count(page, 2)];
  const sheet = await openOp(toolbox, panel, 'Clear');
  await sheet.getByRole('group', { name: 'Labels' }).getByRole('button', { name: 'All segments' }).click();
  await sheet.getByRole('button', { name: 'Commit' }).click();
  await expect.poll(() => count(page, 1)).toBe(0);
  expect(await count(page, 2)).toBe(0);
  await page.keyboard.press('Control+z');
  await expect.poll(() => count(page, 1)).toBe(a);
  expect(await count(page, 2)).toBe(b);
});

test('Move into merges the active segment into the chosen one; one undo restores both', async ({ page }) => {
  const { panel, toolbox } = await twoSegments(page);
  await activate(panel, 'Segment 1');
  const [a, b] = [await count(page, 1), await count(page, 2)];
  const sheet = await openOp(toolbox, panel, 'Move into…');
  await expect(sheet.getByLabel('Into segment')).toHaveValue('2');
  await expect(sheet.getByRole('group', { name: 'Labels' })).toHaveCount(0); // source is the active segment
  await sheet.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByTestId('mask-preview-bar')).toContainText('Move into Segment 2');
  await page.keyboard.press('Enter');
  await expect.poll(() => count(page, 1)).toBe(0);
  expect(await count(page, 2)).toBe(a + b);
  await page.keyboard.press('Control+z');
  await expect.poll(() => count(page, 1)).toBe(a);
  expect(await count(page, 2)).toBe(b);
});

test('Copy into adds the active segment to the chosen one and keeps both', async ({ page }) => {
  const { panel, toolbox } = await twoSegments(page);
  await activate(panel, 'Segment 1');
  const [a, b] = [await count(page, 1), await count(page, 2)];
  const sheet = await openOp(toolbox, panel, 'Copy into…');
  await sheet.getByRole('button', { name: 'Commit' }).click();
  await expect.poll(() => count(page, 2)).toBe(a + b);
  expect(await count(page, 1)).toBe(a);
});

test('Magnet bridge grows the chosen segment across the gap to meet the active one', async ({ page }) => {
  const { panel, toolbox } = await twoSegments(page, 0.03);
  await activate(panel, 'Segment 1');
  const [a, b] = [await count(page, 1), await count(page, 2)];
  const sheet = await openOp(toolbox, panel, 'Magnet bridge…');
  await sheet.getByLabel('Max gap').fill('30');
  await sheet.getByRole('button', { name: 'Commit' }).click();
  await expect.poll(() => count(page, 2)).toBeGreaterThan(b);
  expect(await count(page, 1)).toBe(a); // the source is never changed
});

test('a segmentation with one segment has nothing to go Into', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  const sheet = await openOp(toolbox, panel, 'Move into…');
  await expect(sheet.getByLabel('Into segment')).toBeDisabled();
  await sheet.getByRole('button', { name: 'Preview' }).click();
  await expect(sheet.getByTestId('sheet-message')).toHaveText('Add another segment to this segmentation first');
});
