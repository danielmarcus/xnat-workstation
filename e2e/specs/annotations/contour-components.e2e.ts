/**
 * Unified selection S2 — selecting contour components of the active ROI
 * (docs/unified-selection.md).
 *
 * The selection lives inside the active member: with the Select tool, a click on a
 * contour of the active ROI selects it, Shift-click adds or removes one, a click on
 * another ROI's contour makes THAT ROI active (the panel follows) and selects it, and
 * changing slice clears the selection (it is the current slice's). A member-row click
 * selects all of that ROI's contours on the slice.
 *
 * Drives the real panel, toolbox, strokes and clicks; reads Cornerstone's selection and
 * the rendered outline widths (a selected contour is drawn thicker).
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Locator, Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

type Snapshot = { selected: string[]; currentSliceIndex: number | null };
type Win = {
  __XNAT_E2E__: {
    clearAllContainers: () => void;
    getActiveContourSnapshot: (panelId?: string) => Snapshot;
  };
};
const VIEWPORT = '[data-testid="unified-viewport-element:panel_0"]';

test.beforeEach(({ page }) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers()));

const selected = async (page: Page) =>
  (await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getActiveContourSnapshot('panel_0'))).selected;

/** Contour outlines on this slice, left to right, with their rendered width. */
const outlines = (page: Page) =>
  page.evaluate((vp) =>
    Array.from(document.querySelectorAll(`${vp} .svg-layer path`))
      .map((n) => ({ r: (n as SVGGraphicsElement).getBoundingClientRect(), w: Number(n.getAttribute('stroke-width')) }))
      .filter(({ r }) => r.width > 5)
      .sort((a, b) => a.r.x - b.r.x)
      .map(({ r, w }) => ({ x: r.x, y: r.y, width: r.width, height: r.height, w })),
  VIEWPORT);

async function loop(page: Page, fx: number, fy: number) {
  const box = (await page.locator(`${VIEWPORT} canvas`).boundingBox())!;
  const cx = box.x + box.width * fx, cy = box.y + box.height * fy, r = Math.min(box.width, box.height) * 0.07;
  await page.mouse.move(cx + r, cy);
  await page.mouse.down();
  for (let i = 1; i <= 32; i++) {
    const a = (i / 32) * 2 * Math.PI;
    await page.mouse.move(cx + r * Math.cos(a), cy + r * Math.sin(a), { steps: 2 });
  }
  await page.mouse.up();
  await page.waitForTimeout(500);
}

/** Click a contour's top edge (with the Select tool active), optionally with Shift held. */
async function clickOutline(page: Page, o: { x: number; y: number; width: number }, modifiers: Array<'Shift'> = []) {
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.click(o.x + o.width / 2, o.y + 1);
  for (const m of modifiers) await page.keyboard.up(m);
}

async function structure(page: Page) {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Structure (RTSTRUCT)' }).click();
  await page.keyboard.press('Escape');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await toolbox.getByRole('button', { name: 'Freehand', exact: true }).click();
  const box = (await page.locator(`${VIEWPORT} canvas`).boundingBox())!;
  return { panel, toolbox, box };
}

const pickSelect = async (page: Page, toolbox: Locator, box: { x: number; y: number }) => {
  await toolbox.getByRole('button', { name: 'Select', exact: true }).click();
  await page.mouse.click(box.x + 5, box.y + 5); // empty image: start from no selection
  await expect.poll(() => selected(page)).toEqual([]);
};

test('Shift-click adds a contour of the active ROI to the selection, and removes it again', async ({ page }) => {
  const { toolbox, box } = await structure(page);
  await loop(page, 0.3, 0.5);
  await loop(page, 0.7, 0.5);
  await expect.poll(async () => (await outlines(page)).length).toBe(2);
  await pickSelect(page, toolbox, box);
  const [left, right] = await outlines(page);

  await clickOutline(page, left);
  await expect.poll(async () => (await selected(page)).length).toBe(1);
  await clickOutline(page, right, ['Shift']);
  await expect.poll(async () => (await selected(page)).length, { message: 'Shift-click adds' }).toBe(2);
  await expect.poll(async () => { const [l, r] = await outlines(page); return l.w === r.w && l.w > 2; }, { message: 'both drawn as selected' }).toBe(true);

  await clickOutline(page, left, ['Shift']);
  await expect.poll(async () => (await selected(page)).length, { message: 'Shift-click on a selected one removes it' }).toBe(1);
  await expect.poll(async () => { const [l, r] = await outlines(page); return r.w > l.w; }).toBe(true);
});

test('clicking another ROI\'s contour makes that ROI the active member and selects it', async ({ page }) => {
  const { panel, toolbox, box } = await structure(page);
  await loop(page, 0.3, 0.5); // ROI 1
  // A second ROI (the container's "+"), with its own contour.
  await panel.getByRole('button', { name: 'Add member' }).click();
  await page.keyboard.press('Escape');
  await toolbox.getByRole('button', { name: 'Freehand', exact: true }).click();
  await loop(page, 0.7, 0.5); // ROI 2
  const rows = panel.locator('[data-testid^="member-row-"]');
  await expect(rows).toHaveCount(2);

  // Make ROI 1 active from the panel, then click ROI 2's contour with Select.
  await rows.nth(0).click();
  await expect(rows.nth(0)).toHaveAttribute('data-active', 'true');
  await pickSelect(page, toolbox, box);
  const [, right] = await outlines(page);
  await clickOutline(page, right);

  await expect(rows.nth(1), 'the panel follows: ROI 2 is now active').toHaveAttribute('data-active', 'true');
  await expect(rows.nth(0)).toHaveAttribute('data-active', 'false');
  await expect.poll(async () => (await selected(page)).length).toBe(1);
});

test('changing slice clears the selection — it is the current slice\'s', async ({ page }) => {
  const { toolbox, box } = await structure(page);
  await loop(page, 0.5, 0.5);
  await pickSelect(page, toolbox, box);
  const [only] = await outlines(page);
  await clickOutline(page, only);
  await expect.poll(async () => (await selected(page)).length).toBe(1);

  await page.keyboard.press('ArrowDown');
  await expect.poll(() => selected(page), { message: 'scrolling away clears it' }).toEqual([]);
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(300);
  expect(await selected(page), 'and coming back does not restore it').toEqual([]);
});

test('a member-row click selects all of that ROI\'s contours on this slice', async ({ page }) => {
  const { panel, toolbox, box } = await structure(page);
  await loop(page, 0.3, 0.5);
  await loop(page, 0.7, 0.5);
  await pickSelect(page, toolbox, box);

  await panel.locator('[data-testid^="member-row-"]').first().click();
  await expect.poll(async () => (await selected(page)).length, { message: 'both contours of the ROI' }).toBe(2);
});

// ── S3: act on the whole selection ───────────────────────────────────────────────

test('copying several selected contours pastes them all, as one undo step', async ({ page }) => {
  const { panel, toolbox, box } = await structure(page);
  await loop(page, 0.3, 0.5);
  await loop(page, 0.7, 0.5);
  await pickSelect(page, toolbox, box);
  await panel.locator('[data-testid^="member-row-"]').first().click(); // both contours
  await expect.poll(async () => (await selected(page)).length).toBe(2);

  await page.keyboard.press('Control+c');
  const from = (await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getActiveContourSnapshot('panel_0'))).currentSliceIndex ?? 0;
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getActiveContourSnapshot('panel_0'))).currentSliceIndex).toBe(from + 3);
  await expect.poll(async () => (await outlines(page)).length).toBe(0);

  await page.keyboard.press('Control+v');
  await expect.poll(async () => (await outlines(page)).length, { message: 'both contours are pasted' }).toBe(2);
  await expect.poll(async () => (await selected(page)).length, { message: 'and both stay selected' }).toBe(2);

  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await outlines(page)).length, { message: 'one undo takes the whole paste back' }).toBe(0);
});

test('Delete removes every selected contour, and one undo brings them all back', async ({ page }) => {
  const { panel, toolbox, box } = await structure(page);
  await loop(page, 0.3, 0.5);
  await loop(page, 0.7, 0.5);
  await pickSelect(page, toolbox, box);
  await panel.locator('[data-testid^="member-row-"]').first().click();
  await expect.poll(async () => (await selected(page)).length).toBe(2);

  await page.keyboard.press('Delete');
  await expect.poll(async () => (await outlines(page)).length, { message: 'both deleted' }).toBe(0);

  await page.locator('button[title^="Undo"]').click();
  await expect.poll(async () => (await outlines(page)).length, { message: 'one undo restores both' }).toBe(2);
  await page.locator('button[title^="Redo"]').click();
  await expect.poll(async () => (await outlines(page)).length, { message: 'redo deletes them again' }).toBe(0);
});

test('with nothing selected, Ctrl+C copies the active ROI\'s contours on this slice', async ({ page }) => {
  const { toolbox, box } = await structure(page);
  await loop(page, 0.3, 0.5);
  await loop(page, 0.7, 0.5);
  await pickSelect(page, toolbox, box); // ends with an empty selection

  await page.keyboard.press('Control+c');
  const from = (await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getActiveContourSnapshot('panel_0'))).currentSliceIndex ?? 0;
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getActiveContourSnapshot('panel_0'))).currentSliceIndex).toBe(from + 3);
  await page.keyboard.press('Control+v');
  await expect.poll(async () => (await outlines(page)).length, { message: 'both of the ROI\'s contours are pasted' }).toBe(2);
});
