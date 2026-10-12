/**
 * Labelmap interpolation (SegWorks parity #152–168; branch 3 I2). User-triggered only:
 * Operations › Interpolate fills empty slices between painted ones — every gap, the slice on
 * screen, or between anchors A and B — previewed, committed with ⏎ as one undo step.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Locator, Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';
import { clickTool } from '../../helpers/toolbox';
import { openOperation } from '../../helpers/operations';

type Win = { __XNAT_E2E__: { clearAllContainers: () => void; memberVoxelCount: (i: number) => number; activeSegmentSliceCounts: () => number[] } };
const VIEWPORT = '[data-testid="unified-viewport-element:panel_0"]';
const SCROLLBAR = '[data-testid="viewport-scrollbar:panel_0"]';
const voxels = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.memberVoxelCount(1));
const sliceCounts = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.activeSegmentSliceCounts());
const shown = async (page: Page) => Number((await page.getByTestId('overlay-field-imageIndex:panel_0').innerText()).split('/')[0].trim());

test.beforeEach(({ page }) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers()));

async function stroke(page: Page, len: number) {
  const b = (await page.locator(`${VIEWPORT} canvas`).boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.4, b.y + b.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * (0.4 + len), b.y + b.height * 0.5, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}
async function step(page: Page, n: number) {
  for (let i = 0; i < Math.abs(n); i++) await page.keyboard.press(n > 0 ? 'ArrowDown' : 'ArrowUp');
  await page.waitForTimeout(200);
}

/** A short stroke on the slice on screen, a long one four slices on: a 3-slice gap. */
async function gapOfThree(page: Page, fixture = 'ct-axial-300') {
  await loadFixture(page, fixture, 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await clickTool(toolbox, 'Brush');
  const first = await shown(page);
  await stroke(page, 0.04);
  await step(page, 4);
  await stroke(page, 0.16);
  return { panel, toolbox, first };
}

const openInterpolate = (_toolbox: Locator, panel: Locator) => openOperation(panel, 'Interpolate');

test('all gaps: the table and the slice track show the gap; preview, then ⏎ fills it as one undo step', async ({ page }) => {
  const { panel, toolbox, first } = await gapOfThree(page);
  const sheet = await openInterpolate(toolbox, panel);
  await expect(sheet.getByTestId('gap-table')).toContainText(`slices ${Math.min(first + 1, first + 3)}–${Math.max(first + 1, first + 3)}`);
  await expect(page.locator(`${SCROLLBAR} [data-testid="slice-track-gap"]`)).toHaveCount(1);
  const before = await voxels(page);

  await sheet.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByTestId('mask-preview-bar')).toContainText('Interpolate');
  expect(await voxels(page), 'nothing written while previewing').toBe(before);
  await page.keyboard.press('Enter');
  await expect.poll(() => voxels(page)).toBeGreaterThan(before);

  // Every slice between the anchors now painted, and the areas run monotonically.
  const counts = (await sliceCounts(page)).filter((c, i, arr) => c > 0 || (arr.slice(0, i).some((x) => x > 0) && arr.slice(i).some((x) => x > 0)));
  expect(counts).toHaveLength(5);
  expect(counts.every((c) => c > 0)).toBe(true);
  const rising = counts[0] < counts[4] ? counts : [...counts].reverse();
  for (let i = 1; i < rising.length; i++) expect(rising[i], `slice ${i} grows toward the larger anchor`).toBeGreaterThan(rising[i - 1]);
  await expect(sheet.getByText('No empty slices between painted ones.')).toBeVisible();
  await expect(page.locator(`${SCROLLBAR} [data-testid="slice-track-gap"]`)).toHaveCount(0);

  await page.keyboard.press('Control+z');
  await expect.poll(() => voxels(page)).toBe(before);
});

test('this slice: fills only the empty slice on screen', async ({ page }) => {
  const { panel, toolbox } = await gapOfThree(page);
  await step(page, -2); // middle of the gap
  const sheet = await openInterpolate(toolbox, panel);
  await sheet.getByRole('group', { name: 'Fill' }).getByRole('button', { name: 'This slice' }).click();
  await sheet.getByRole('button', { name: 'Commit' }).click();
  await expect.poll(async () => (await sliceCounts(page)).filter((c) => c > 0).length).toBe(3);
  await expect(sheet.getByTestId('gap-table').locator('li')).toHaveCount(2); // the gap split in two
});

test('anchors: ⌥A and ⌥B set from the keyboard, drawn on the track, and A → B fills between them', async ({ page }) => {
  const { panel, toolbox, first } = await gapOfThree(page);
  const sheet = await openInterpolate(toolbox, panel);
  await page.locator(VIEWPORT).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Alt+KeyB');
  await step(page, -4);
  await page.keyboard.press('Alt+KeyA');
  await expect(sheet.getByTestId('anchor-a')).toHaveText(String(first));
  await expect(sheet.getByTestId('anchor-b')).toHaveText(String(await shown(page) === first ? first + 4 : first));
  await expect(page.locator(`${SCROLLBAR} [data-testid="slice-track-anchor-a"]`)).toHaveAttribute('data-slice', String(first));
  await expect(page.locator(`${SCROLLBAR} [data-testid="slice-track-anchor-b"]`)).toBeVisible();
  await sheet.getByRole('button', { name: 'Commit' }).click();
  await expect.poll(async () => (await sliceCounts(page)).filter((c) => c > 0).length).toBe(5);
});

test('with Interpolate open, B still picks the Brush: the anchors are ⌥ chords, not bare letters', async ({ page }) => {
  // An operation stays open while the user paints (D1/D12 as amended 2026-10-12), so it
  // must not take the tool hotkeys: paint a keyframe with B, set an anchor with ⌥A.
  const { panel, toolbox, first } = await gapOfThree(page);
  const sheet = await openInterpolate(toolbox, panel);
  await clickTool(toolbox, 'Select');
  await page.locator(VIEWPORT).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('b');
  await expect(toolbox.getByRole('button', { name: 'Brush', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet).toBeVisible();
  await step(page, -4);
  await page.keyboard.press('Alt+KeyA');
  await expect(sheet.getByTestId('anchor-a')).toHaveText(String(first));
  await expect(sheet.getByTestId('anchor-b')).toHaveText('—');
});

test('a single gap can be previewed from its row', async ({ page }) => {
  const { panel, toolbox } = await gapOfThree(page);
  const sheet = await openInterpolate(toolbox, panel);
  await sheet.getByRole('button', { name: /^Preview gap / }).click();
  await expect(page.getByTestId('mask-preview-bar')).toContainText('3 slices');
});

test('works on an oblique acquisition', async ({ page }) => {
  const { panel, toolbox } = await gapOfThree(page, 'ct-oblique');
  const before = await voxels(page);
  const sheet = await openInterpolate(toolbox, panel);
  await sheet.getByRole('button', { name: 'Commit' }).click();
  await expect.poll(() => voxels(page)).toBeGreaterThan(before);
  await expect(sheet.getByText('No empty slices between painted ones.')).toBeVisible();
});
