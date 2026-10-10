/**
 * A locked member is not changed — not deleted, pasted into, edited or drawn into — and
 * every attempt says so: a warning in the viewport area ("… is locked — unlock it to
 * edit"), which goes away by itself after ~3 s and can be dismissed sooner.
 *
 * Reported: a locked ROI's contour could be deleted. Contour delete never checked the
 * lock, and the guards that did exist (paste, drawing, undo) failed silently or with a
 * modal. Drives the real panel lock toggle, toolbox, keys and mouse.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Locator, Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

type Snapshot = { total: number; selected: string[]; currentSliceIndex: number | null };
type Win = {
  __XNAT_E2E__: {
    clearAllContainers: () => void;
    getActiveContourSnapshot: (panelId?: string) => Snapshot;
    getContourShapes: () => Array<{ polyline: string }>;
    getPaintedVoxelsPerImage: () => number[];
    getPanelSliceState: (p: string) => { displayedImageIndex: number };
  };
};
const VIEWPORT = '[data-testid="unified-viewport-element:panel_0"]';
const e2e = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getActiveContourSnapshot('panel_0'));
const shapes = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getContourShapes().map((s) => s.polyline));
const toast = (page: Page) => page.locator('[data-testid="viewport-toast"]');

test.beforeEach(({ page }) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers()));

async function openPanel(page: Page) {
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  return panel;
}

async function loop(page: Page, fx: number, fy: number) {
  const box = (await page.locator(`${VIEWPORT} canvas`).boundingBox())!;
  const cx = box.x + box.width * fx, cy = box.y + box.height * fy, r = Math.min(box.width, box.height) * 0.08;
  await page.mouse.move(cx + r, cy);
  await page.mouse.down();
  for (let i = 1; i <= 32; i++) {
    const a = (i / 32) * 2 * Math.PI;
    await page.mouse.move(cx + r * Math.cos(a), cy + r * Math.sin(a), { steps: 2 });
  }
  await page.mouse.up();
  await page.waitForTimeout(500);
  return { cx, cy, r };
}

async function structureWithContour(page: Page) {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  const panel = await openPanel(page);
  await panel.getByRole('button', { name: 'New Structure (RTSTRUCT)' }).click();
  await page.keyboard.press('Escape');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await toolbox.getByRole('button', { name: 'Freehand', exact: true }).click();
  const c = await loop(page, 0.4, 0.5);
  await expect.poll(async () => (await e2e(page)).total).toBe(1);
  return { panel, toolbox, c };
}

const lockRow = (row: Locator) => row.getByRole('button', { name: 'Toggle lock' }).click();

/** The warning names the lock, then leaves by itself after ~3 s. */
async function expectLockWarning(page: Page) {
  await expect(toast(page), 'a lock warning appears in the viewport').toBeVisible({ timeout: 3_000 });
  await expect(toast(page)).toContainText(/locked/i);
  await expect(toast(page), 'and goes away by itself').toBeHidden({ timeout: 5_000 });
}

test('Delete on a locked ROI\'s selected contour leaves it, and warns', async ({ page }) => {
  const { panel, toolbox } = await structureWithContour(page);
  const row = panel.locator('[data-testid^="member-row-"]').first();
  await toolbox.getByRole('button', { name: 'Select', exact: true }).click();
  await row.click(); // selects the ROI's contour
  await expect.poll(async () => (await e2e(page)).selected.length).toBe(1);
  await lockRow(row);

  await page.keyboard.press('Delete');
  await expectLockWarning(page);
  expect((await e2e(page)).total, 'the contour is still there').toBe(1);
});

test('the warning can be dismissed before it times out', async ({ page }) => {
  const { panel, toolbox } = await structureWithContour(page);
  const row = panel.locator('[data-testid^="member-row-"]').first();
  await toolbox.getByRole('button', { name: 'Select', exact: true }).click();
  await row.click();
  await expect.poll(async () => (await e2e(page)).selected.length).toBe(1);
  await lockRow(row);
  await page.keyboard.press('Delete');
  await expect(toast(page)).toBeVisible({ timeout: 3_000 });
  await toast(page).getByRole('button', { name: 'Dismiss' }).click();
  await expect(toast(page), 'dismissed at once').toBeHidden({ timeout: 500 });
});

test('pasting into a locked ROI pastes nothing, and warns', async ({ page }) => {
  const { panel, toolbox } = await structureWithContour(page);
  const row = panel.locator('[data-testid^="member-row-"]').first();
  await toolbox.getByRole('button', { name: 'Select', exact: true }).click();
  await row.click();
  await expect.poll(async () => (await e2e(page)).selected.length).toBe(1);
  await page.keyboard.press('Control+c');
  await lockRow(row);
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);
  await page.keyboard.press('Control+v');
  await expectLockWarning(page);
  expect((await e2e(page)).total, 'nothing was pasted').toBe(1);
});

test('drawing into a locked ROI draws nothing, and warns', async ({ page }) => {
  const { panel } = await structureWithContour(page);
  await lockRow(panel.locator('[data-testid^="member-row-"]').first());
  await loop(page, 0.7, 0.3);
  await expectLockWarning(page);
  expect((await e2e(page)).total, 'no new contour').toBe(1);
});

test('dragging a locked ROI\'s contour with a drawing tool does not edit it, even with another ROI active', async ({ page }) => {
  const { panel, toolbox, c } = await structureWithContour(page);
  const rows = panel.locator('[data-testid^="member-row-"]');
  await lockRow(rows.first());
  // A second, unlocked ROI becomes the active member.
  await panel.getByRole('button', { name: 'Add member' }).click();
  await page.keyboard.press('Escape');
  await toolbox.getByRole('button', { name: 'Freehand', exact: true }).click();
  await expect(rows.nth(1)).toHaveAttribute('data-active', 'true');
  const before = await shapes(page);

  // Grab the locked contour's edge and drag it outward.
  await page.mouse.move(c.cx + c.r, c.cy);
  await page.mouse.down();
  await page.mouse.move(c.cx + c.r * 1.8, c.cy, { steps: 10 });
  await page.mouse.up();
  await expectLockWarning(page);
  expect(await shapes(page), 'the locked contour is unchanged').toEqual(before);
});

test('undo of an edit to a now-locked ROI is refused with the same warning (no modal)', async ({ page }) => {
  const { panel } = await structureWithContour(page);
  await lockRow(panel.locator('[data-testid^="member-row-"]').first());
  await page.locator('button[title^="Undo"]').click();
  await expectLockWarning(page);
  expect((await e2e(page)).total, 'the contour was not undone away').toBe(1);
  await expect(page.getByRole('dialog'), 'no modal').toHaveCount(0);
});

test('Delete on a locked segment\'s selected island leaves it, and warns', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  const panel = await openPanel(page);
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await toolbox.getByRole('button', { name: 'Brush', exact: true }).click();
  const box = (await page.locator(`${VIEWPORT} canvas`).boundingBox())!;
  const x = box.x + box.width * 0.4, y = box.y + box.height * 0.5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + box.width * 0.05, y, { steps: 8 });
  await page.mouse.up();
  const source = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPanelSliceState('panel_0').displayedImageIndex);
  const perImage = () => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelsPerImage());
  await expect.poll(async () => (await perImage())[source] ?? 0).toBeGreaterThan(0);
  const painted = (await perImage())[source];

  await toolbox.getByRole('button', { name: 'Select', exact: true }).click();
  await lockRow(panel.locator('[data-testid^="member-row-"]').first());
  await page.mouse.click(x + box.width * 0.025, y);
  await expect.poll(() => page.locator(`${VIEWPORT} [data-testid="mask-selection-outline"] path`).count()).toBe(1);
  await page.keyboard.press('Delete');
  await expectLockWarning(page);
  expect((await perImage())[source], 'the island is still painted').toBe(painted);
});

test('the Sculptor does not reshape a locked ROI\'s contour, even with another ROI active', async ({ page }) => {
  const { panel, toolbox, c } = await structureWithContour(page);
  const rows = panel.locator('[data-testid^="member-row-"]');
  await lockRow(rows.first());
  await panel.getByRole('button', { name: 'Add member' }).click();
  await page.keyboard.press('Escape');
  await expect(rows.nth(1)).toHaveAttribute('data-active', 'true');
  await toolbox.getByRole('button', { name: 'Sculptor', exact: true }).click();
  const before = await shapes(page);

  // Push into the locked contour from inside it.
  await page.mouse.move(c.cx, c.cy);
  await page.mouse.down();
  await page.mouse.move(c.cx + c.r * 1.3, c.cy, { steps: 12 });
  await page.mouse.up();
  await expectLockWarning(page);
  expect(await shapes(page), 'the locked contour is unchanged').toEqual(before);
});


test('dragging a locked ROI\'s contour with Select does not move it, and warns', async ({ page }) => {
  const { panel, toolbox, c } = await structureWithContour(page);
  await toolbox.getByRole('button', { name: 'Select', exact: true }).click();
  await lockRow(panel.locator('[data-testid^="member-row-"]').first());
  const before = await shapes(page);
  await page.mouse.move(c.cx + c.r, c.cy);
  await page.mouse.down();
  await page.mouse.move(c.cx + c.r + 40, c.cy + 25, { steps: 10 });
  await page.mouse.up();
  await expectLockWarning(page);
  expect(await shapes(page), 'the locked contour did not move').toEqual(before);
});
