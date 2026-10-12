/**
 * The Cleanup operation (SegWorks parity branch 1 S5; in the Operations section since the
 * 2026-10-12 D1 amendment — layout and tool independence are in operations-section.e2e).
 *
 * Drives the real affordances — the Operation picker, Cleanup's operation picker, scope
 * buttons and footer, the ⏎ key, the X hotkey, the member row's lock — and asserts the
 * labelmap voxels, which are the ground truth.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Locator, Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';
import { clickTool } from '../../helpers/toolbox';
import { openOperation } from '../../helpers/operations';

type Win = { __XNAT_E2E__: { clearAllContainers: () => void; activeSegmentVoxelCount: () => number } };
const VIEWPORT = '[data-testid="unified-viewport-element:panel_0"]';

test.beforeEach(({ page }) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers()));

const voxels = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.activeSegmentVoxelCount());

async function box(page: Page) {
  return (await page.locator(`${VIEWPORT} canvas`).boundingBox())!;
}

async function stroke(page: Page, fx: number, fy: number, len: number) {
  const b = await box(page);
  await page.mouse.move(b.x + b.width * fx, b.y + b.height * fy);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * (fx + len), b.y + b.height * fy, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

/** A closed brush ring around (fx, fy) — its centre is a hole. */
async function ring(page: Page, fx: number, fy: number, rf: number) {
  const b = await box(page);
  const cx = b.x + b.width * fx, cy = b.y + b.height * fy, r = b.width * rf;
  await page.mouse.move(cx + r, cy);
  await page.mouse.down();
  for (let i = 1; i <= 40; i++) {
    const a = (i / 40) * 2 * Math.PI;
    await page.mouse.move(cx + r * Math.cos(a), cy + r * Math.sin(a), { steps: 2 });
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
}

async function segmentation(page: Page, fixture = 'ct-axial-300') {
  await loadFixture(page, fixture, 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await clickTool(toolbox, 'Brush');
  return { panel, toolbox };
}

const openCleanup = (_toolbox: Locator, panel: Locator, op?: string) => openOperation(panel, 'Cleanup', op);

test('Keep largest: Preview shows it, ⏎ writes it as one undo step', async ({ page }) => {
  const { panel, toolbox } = await segmentation(page);
  await stroke(page, 0.25, 0.5, 0.2);
  await stroke(page, 0.75, 0.5, 0.01);
  const before = await voxels(page);
  const sheet = await openCleanup(toolbox, panel, 'Keep largest');
  await sheet.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByTestId('mask-preview-bar')).toContainText('Keep largest');
  expect(await voxels(page)).toBe(before);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('mask-preview-bar')).toHaveCount(0);
  const after = await voxels(page);
  expect(after).toBeLessThan(before);
  expect(after).toBeGreaterThan(0);
  await page.keyboard.press('Control+z');
  await expect.poll(() => voxels(page)).toBe(before);
});

test('Commit without a preview runs and writes in one go', async ({ page }) => {
  const { panel, toolbox } = await segmentation(page);
  await stroke(page, 0.25, 0.5, 0.2);
  await stroke(page, 0.75, 0.5, 0.01);
  const before = await voxels(page);
  const sheet = await openCleanup(toolbox, panel, 'Keep largest');
  await sheet.getByRole('button', { name: 'Commit' }).click();
  await expect.poll(() => voxels(page)).toBeLessThan(before);
  await expect(page.getByTestId('mask-preview-bar')).toHaveCount(0);
});

test('scope: Slice cleans only the slice on screen; Volume cleans every slice', async ({ page }) => {
  const { panel, toolbox } = await segmentation(page);
  await ring(page, 0.5, 0.5, 0.12);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);
  await ring(page, 0.5, 0.5, 0.12);
  const painted = await voxels(page);

  const sheet = await openCleanup(toolbox, panel, 'Fill holes');
  await sheet.getByRole('button', { name: 'Commit' }).click();
  await expect.poll(() => voxels(page)).toBeGreaterThan(painted);
  const oneSlice = await voxels(page);
  const holeArea = oneSlice - painted;

  await page.keyboard.press('Control+z');
  await expect.poll(() => voxels(page)).toBe(painted);
  await sheet.getByRole('group', { name: 'Slices' }).getByRole('button', { name: 'Volume' }).click();
  await sheet.getByRole('button', { name: 'Commit' }).click();
  // Both rings filled: roughly twice the single-slice gain.
  await expect.poll(() => voxels(page)).toBeGreaterThan(painted + holeArea * 1.5);
});

test('Range starts at the slice on screen, in the viewport\'s own numbering', async ({ page }) => {
  const { panel, toolbox } = await segmentation(page);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(200);
  const shown = (await page.getByTestId('overlay-field-imageIndex:panel_0').innerText()).split('/')[0].trim();
  const sheet = await openCleanup(toolbox, panel);
  await sheet.getByRole('group', { name: 'Slices' }).getByRole('button', { name: 'Range' }).click();
  await expect(sheet.getByLabel('Range from')).toHaveValue(shown);
  await expect(sheet.getByLabel('Range to')).toHaveValue(shown);
});

test('a locked segment previews read-only and cannot be committed', async ({ page }) => {
  const { panel, toolbox } = await segmentation(page);
  await stroke(page, 0.25, 0.5, 0.2);
  await stroke(page, 0.75, 0.5, 0.01);
  const before = await voxels(page);
  await panel.locator('[data-testid^="member-row-"]').first().getByRole('button', { name: 'Toggle lock' }).click();
  const sheet = await openCleanup(toolbox, panel, 'Keep largest');
  await expect(sheet.getByRole('button', { name: 'Commit' })).toBeDisabled();
  await expect(sheet.getByTestId('sheet-message')).toContainText('locked');
  await sheet.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByTestId('mask-preview-bar')).toContainText('Locked · preview only');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  expect(await voxels(page)).toBe(before);
});

test('X opens Cleanup from the viewport', async ({ page }) => {
  const { panel } = await segmentation(page);
  await page.locator(VIEWPORT).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('x');
  await expect(panel.getByTestId('cleanup-sheet')).toBeVisible();
});

test('closing Cleanup with a preview pending asks first, inline', async ({ page }) => {
  const { panel, toolbox } = await segmentation(page);
  await stroke(page, 0.25, 0.5, 0.2);
  await stroke(page, 0.75, 0.5, 0.01);
  const sheet = await openCleanup(toolbox, panel, 'Keep largest');
  await sheet.getByRole('button', { name: 'Preview' }).click();
  await panel.getByRole('button', { name: 'Close operation' }).click();
  await expect(sheet.getByText('Discard the preview?')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0); // inline, not a modal
  await sheet.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(panel.getByTestId('cleanup-sheet')).toHaveCount(0);
  await expect(page.getByTestId('mask-preview-bar')).toHaveCount(0);
});

test('Fill holes works on an oblique acquisition (index space, not world space)', async ({ page }) => {
  const { panel, toolbox } = await segmentation(page, 'ct-oblique');
  await ring(page, 0.5, 0.5, 0.12);
  const painted = await voxels(page);
  const sheet = await openCleanup(toolbox, panel, 'Fill holes');
  await sheet.getByRole('button', { name: 'Commit' }).click();
  await expect.poll(() => voxels(page)).toBeGreaterThan(painted);
  // The whole hole was filled: a second pass finds nothing left to fill.
  await sheet.getByRole('button', { name: 'Preview' }).click();
  await expect(sheet.getByTestId('sheet-message')).toHaveText('Nothing to change in this scope');
});
