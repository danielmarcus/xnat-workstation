/**
 * Unified selection S4 — selecting mask islands (docs/unified-selection.md).
 *
 * A segment's selectable component is an island: one connected painted region on the
 * current slice. With the Select tool, a click inside an island of the active segment
 * selects it (an outline is drawn round it); Shift-click adds or removes one; a click in
 * another segment's island makes that segment the active member; a click on empty image
 * clears; changing slice clears.
 *
 * Drives the real panel, brush and Select tool; reads the selection outline drawn over
 * the viewport.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

type Win = { __XNAT_E2E__: { clearAllContainers: () => void } };
const VIEWPORT = '[data-testid="unified-viewport-element:panel_0"]';

test.beforeEach(({ page }) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers()));

/** Selected islands drawn on the viewport (one outline path per island). */
const outlined = (page: Page) =>
  page.locator(`${VIEWPORT} [data-testid="mask-selection-outline"] path`).count();

async function box(page: Page) {
  return (await page.locator(`${VIEWPORT} canvas`).boundingBox())!;
}

/** A short brush stroke; returns a point inside what it painted. */
async function blob(page: Page, fx: number, fy: number) {
  const b = await box(page);
  const x = b.x + b.width * fx, y = b.y + b.height * fy;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + b.width * 0.05, y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  return { x: x + b.width * 0.025, y };
}

async function clickAt(page: Page, p: { x: number; y: number }, shift = false) {
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.click(p.x, p.y);
  if (shift) await page.keyboard.up('Shift');
}

async function segmentation(page: Page) {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await toolbox.getByRole('button', { name: 'Brush', exact: true }).click();
  return { panel, toolbox };
}

test('Select picks an island of the active segment; Shift adds and removes; empty image clears', async ({ page }) => {
  const { toolbox } = await segmentation(page);
  const left = await blob(page, 0.3, 0.5);
  const right = await blob(page, 0.65, 0.5);
  await toolbox.getByRole('button', { name: 'Select', exact: true }).click();

  await clickAt(page, left);
  await expect.poll(() => outlined(page), { message: 'the island is outlined' }).toBe(1);
  await clickAt(page, right, true);
  await expect.poll(() => outlined(page), { message: 'Shift-click adds the other island' }).toBe(2);
  await clickAt(page, left, true);
  await expect.poll(() => outlined(page), { message: 'Shift-click on a selected island removes it' }).toBe(1);
  const b = await box(page);
  await page.mouse.click(b.x + 5, b.y + 5);
  await expect.poll(() => outlined(page), { message: 'empty image clears' }).toBe(0);
});

test('a click in another segment\'s island makes that segment the active member', async ({ page }) => {
  const { panel, toolbox } = await segmentation(page);
  await blob(page, 0.3, 0.5); // Segment 1
  await panel.getByRole('button', { name: 'Add member' }).click();
  await page.keyboard.press('Escape');
  await toolbox.getByRole('button', { name: 'Brush', exact: true }).click();
  const second = await blob(page, 0.6, 0.35); // Segment 2
  const rows = panel.locator('[data-testid^="member-row-"]');
  await expect(rows).toHaveCount(2);

  await rows.nth(0).click();
  await expect(rows.nth(0)).toHaveAttribute('data-active', 'true');
  await toolbox.getByRole('button', { name: 'Select', exact: true }).click();
  await clickAt(page, second);

  await expect(rows.nth(1), 'the panel follows: Segment 2 is active').toHaveAttribute('data-active', 'true');
  await expect.poll(() => outlined(page)).toBe(1);
});

test('changing slice clears the island selection', async ({ page }) => {
  const { toolbox } = await segmentation(page);
  const p = await blob(page, 0.4, 0.5);
  await toolbox.getByRole('button', { name: 'Select', exact: true }).click();
  await clickAt(page, p);
  await expect.poll(() => outlined(page)).toBe(1);
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => outlined(page), { message: 'scrolling away clears it' }).toBe(0);
});

// ── S5: copy / paste the selected islands ────────────────────────────────────────

type Hooks = { __XNAT_E2E__: { getPaintedVoxelsPerImage: () => number[]; getPanelSliceState: (p: string) => { displayedImageIndex: number } } };
const perImage = (page: Page) => page.evaluate(() => (window as unknown as Hooks).__XNAT_E2E__.getPaintedVoxelsPerImage());
const sliceIndex = (page: Page) => page.evaluate(() => (window as unknown as Hooks).__XNAT_E2E__.getPanelSliceState('panel_0').displayedImageIndex);

test('Ctrl+C copies only the selected island; Ctrl+V pastes it onto this slice, selected, as one undo step', async ({ page }) => {
  const { toolbox } = await segmentation(page);
  const source = await sliceIndex(page);
  const left = await blob(page, 0.3, 0.5);
  await expect.poll(async () => (await perImage(page))[source] ?? 0).toBeGreaterThan(0);
  const leftCount = (await perImage(page))[source];
  await blob(page, 0.65, 0.5);
  await expect.poll(async () => (await perImage(page))[source]).toBeGreaterThan(leftCount);
  const bothCount = (await perImage(page))[source];

  await toolbox.getByRole('button', { name: 'Select', exact: true }).click();
  await clickAt(page, left);
  await expect.poll(() => outlined(page)).toBe(1);
  await page.keyboard.press('Control+c');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await expect.poll(async () => Math.abs((await sliceIndex(page)) - source)).toBe(3);
  const target = await sliceIndex(page);

  await page.keyboard.press('Control+v');
  await expect
    .poll(async () => (await perImage(page))[target] ?? 0, { message: 'the pasted slice carries the selected island only' })
    .toBe(leftCount);
  expect((await perImage(page))[source], 'the source slice is untouched').toBe(bothCount);
  await expect.poll(() => outlined(page), { message: 'the pasted island is selected' }).toBe(1);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await perImage(page))[target] ?? 0, { message: 'one undo takes the paste back' }).toBe(0);
  expect((await perImage(page))[source]).toBe(bothCount);
});
