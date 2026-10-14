/**
 * Regressions for defects the bug review found (docs/bug-review-2026-10.md) that the generic
 * sweeps cannot express — each drives the real affordance on realistic data (ct-body-512) in a
 * plain single viewport.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Locator, Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';
import { clickTool } from '../../helpers/toolbox';
import { openOperation } from '../../helpers/operations';

const PANEL = 'panel_0';
type Hooks = {
  memberVoxelCount: (i: number) => number;
  inPlanePagePoint: (p: string, dx: number, dy: number) => { x: number; y: number } | null;
  viewportPlane: (p: string) => { index: number } | null;
  clearSeeds: () => void;
};
const hooks = (page: Page) => ({
  member: (i: number) => page.evaluate((idx) => (window as unknown as { __XNAT_E2E__: Hooks }).__XNAT_E2E__.memberVoxelCount(idx), i),
  point: (dx: number, dy: number) => page.evaluate(([x, y]) => (window as unknown as { __XNAT_E2E__: Hooks }).__XNAT_E2E__.inPlanePagePoint('panel_0', x, y), [dx, dy] as const),
  slice: () => page.evaluate(() => (window as unknown as { __XNAT_E2E__: Hooks }).__XNAT_E2E__.viewportPlane('panel_0')?.index ?? -1),
});

async function drag(page: Page, path: Array<[number, number]>, shift = false) {
  const pts = [];
  for (const [dx, dy] of path) pts.push((await hooks(page).point(dx, dy))!);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(p.x, p.y, { steps: 6 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
}

async function step(page: Page, key: 'ArrowUp' | 'ArrowDown', times = 1) {
  for (let i = 0; i < times; i++) {
    const before = await hooks(page).slice();
    await page.locator(`[data-testid="unified-viewport-element:${PANEL}"]`).hover();
    await page.keyboard.press(key);
    await expect.poll(() => hooks(page).slice()).not.toBe(before);
  }
}

async function setup(page: Page): Promise<{ panel: Locator; toolbox: Locator }> {
  await page.evaluate(() => (window as unknown as { __XNAT_E2E__: Hooks }).__XNAT_E2E__.clearSeeds());
  await loadFixture(page, 'ct-body-512', PANEL);
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await expect(toolbox.getByRole('button', { name: 'Brush', exact: true })).toBeVisible({ timeout: 10_000 });
  await panel.getByRole('button', { name: 'Add member' }).first().click();
  await page.keyboard.press('Escape');
  return { panel, toolbox };
}
const row = (panel: Locator, name: string) => panel.locator('[data-testid^="member-row-"]', { hasText: name }).first();

test('O1: Interpolate A → B over All segments leaves a segment that is not on the anchors alone', async ({ page }) => {
  const { panel, toolbox } = await setup(page);
  await clickTool(toolbox, 'Rect');
  // Segment 1 on slices s and s+4 (the anchors); Segment 2 only on s+2, between them.
  await row(panel, 'Segment 1').click();
  await drag(page, [[-10, -10], [10, 10]]);
  await step(page, 'ArrowDown', 2);
  await row(panel, 'Segment 2').click();
  await drag(page, [[30, 30], [40, 40]]);
  const seg2 = await hooks(page).member(2);
  expect(seg2).toBeGreaterThan(0);
  await step(page, 'ArrowDown', 2);
  await row(panel, 'Segment 1').click();
  await drag(page, [[-8, -8], [8, 8]]);
  const sheet = await openOperation(panel, 'Interpolate');
  await sheet.getByRole('group', { name: 'Fill' }).getByRole('button', { name: 'A → B' }).click();
  await sheet.getByRole('group', { name: 'Labels' }).getByRole('button', { name: /All/ }).click();
  await sheet.getByRole('button', { name: 'Set B' }).click();
  await step(page, 'ArrowUp', 4);
  await sheet.getByRole('button', { name: 'Set A' }).click();
  await sheet.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByTestId('mask-preview-bar')).toBeVisible({ timeout: 15_000 });
  await sheet.getByRole('button', { name: 'Commit' }).click();
  await page.waitForTimeout(300);
  expect(await hooks(page).member(2), 'Segment 2 was not on the anchors — it is not erased').toBe(seg2);
  expect(await hooks(page).member(1), 'Segment 1 is interpolated between its anchors').toBeGreaterThan(0);
});

test('S2: α-expansion without Background seeds is refused — it does not paint the whole box', async ({ page }) => {
  const { panel } = await setup(page);
  const sheet = await openOperation(panel, 'Seeded segmentation');
  await sheet.getByLabel('Seed brush', { exact: true }).fill('3');
  await sheet.getByRole('button', { name: 'Paint seeds' }).click();
  const classes = sheet.getByRole('group', { name: 'Seed class' });
  await classes.getByRole('button', { name: /Segment 1/ }).click();
  await drag(page, [[-3, 0], [3, 0]]);
  await classes.getByRole('button', { name: /Segment 2/ }).click();
  await drag(page, [[-70, 0], [-64, 0]]);
  await sheet.getByLabel('Method').selectOption('alphaExpansion');
  await sheet.getByRole('button', { name: 'Run' }).click();
  await expect(sheet.getByTestId('sheet-message')).toContainText('Seed the Background too');
  await expect(page.getByTestId('mask-preview-bar')).toHaveCount(0);
  expect(await hooks(page).member(1) + await hooks(page).member(2)).toBe(0);
});

test('O2: Cleanup over All segments with one segment locked still commits the others — the locked one is left alone', async ({ page }) => {
  const { panel, toolbox } = await setup(page);
  await clickTool(toolbox, 'Rect');
  // Segment 1: a ring (a hole to fill). Segment 2: a ring too, then locked.
  await row(panel, 'Segment 1').click();
  await drag(page, [[-12, -12], [12, 12]]);
  await drag(page, [[-4, -4], [4, 4]], true); // ⇧ inverts the shape tool: erase the middle
  const seg1 = await hooks(page).member(1);
  expect(seg1).toBeGreaterThan(0);
  await row(panel, 'Segment 2').click();
  await drag(page, [[30, 30], [44, 44]]);
  const seg2 = await hooks(page).member(2);
  await row(panel, 'Segment 2').getByRole('button', { name: 'Toggle lock' }).click();
  await row(panel, 'Segment 1').click();
  const sheet = await openOperation(panel, 'Cleanup', 'Fill holes');
  await sheet.getByRole('group', { name: 'Labels' }).getByRole('button', { name: /All/ }).click();
  await sheet.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByTestId('mask-preview-bar')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Commit' }), 'not a read-only preview').toBeEnabled();
  await sheet.getByRole('button', { name: 'Commit' }).click();
  await expect.poll(() => hooks(page).member(1), { message: 'Segment 1’s hole filled' }).toBeGreaterThan(seg1);
  expect(await hooks(page).member(2), 'the locked Segment 2 untouched').toBe(seg2);
});

test('O4: a gap-table row previews its own segment\'s gap, whichever segment is active', async ({ page }) => {
  const { panel, toolbox } = await setup(page);
  await clickTool(toolbox, 'Rect');
  // Segment 2 on slices s and s+3 (a gap); Segment 1 — active — elsewhere, no gap.
  await row(panel, 'Segment 2').click();
  await drag(page, [[-8, -8], [8, 8]]);
  await step(page, 'ArrowDown', 3);
  await drag(page, [[-8, -8], [8, 8]]);
  const seg2 = await hooks(page).member(2);
  await row(panel, 'Segment 1').click();
  await drag(page, [[30, 30], [40, 40]]);
  const sheet = await openOperation(panel, 'Interpolate');
  const gapRow = sheet.getByRole('button', { name: /Preview gap .* of Segment 2/ });
  await expect(gapRow).toBeVisible();
  await gapRow.click();
  await expect(page.getByTestId('mask-preview-bar')).toBeVisible({ timeout: 15_000 });
  await sheet.getByRole('button', { name: 'Commit' }).click();
  await expect.poll(() => hooks(page).member(2), { message: 'Segment 2’s gap filled' }).toBeGreaterThan(seg2);
});

test('O9: copy, pan, next slice, paste — the paste lands where the original is, not shifted by the pan', async ({ page }) => {
  const { panel, toolbox } = await setup(page);
  await row(panel, 'Segment 1').click();
  await clickTool(toolbox, 'Rect');
  await drag(page, [[-6, -6], [6, 6]]);
  await page.locator(`[data-testid="unified-viewport-element:${PANEL}"]`).hover();
  await page.keyboard.press('Control+c');
  // Pan (middle-drag) by ~40 px, then the next slice.
  const c = (await hooks(page).point(0, 0))!;
  await page.mouse.move(c.x, c.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(c.x + 40, c.y + 25, { steps: 8 });
  await page.mouse.up({ button: 'middle' });
  await step(page, 'ArrowDown');
  await page.keyboard.press('Control+v');
  const plane = await page.evaluate(() => (window as unknown as { __XNAT_E2E__: { viewportPlane: (p: string) => { dims: number[] } | null } }).__XNAT_E2E__.viewportPlane('panel_0'));
  const per = plane!.dims[0] * plane!.dims[1];
  await expect.poll(async () => new Set(((await page.evaluate(() => (window as unknown as { __XNAT_E2E__: { memberVoxelIndices: (i: number) => number[] } }).__XNAT_E2E__.memberVoxelIndices(1))) ?? []).map((i) => Math.floor(i / per))).size).toBe(2);
  const idx = (await page.evaluate(() => (window as unknown as { __XNAT_E2E__: { memberVoxelIndices: (i: number) => number[] } }).__XNAT_E2E__.memberVoxelIndices(1)))!;
  const bySlice = new Map<number, string[]>();
  for (const i of idx) { const k = Math.floor(i / per); bySlice.set(k, [...(bySlice.get(k) ?? []), String(i % per)]); }
  const [a, b] = [...bySlice.values()];
  expect(b.length).toBe(a.length);
  expect(b, 'the same in-plane pixels').toEqual(a);
});

test('S5: erasing the middle of a seed stroke splits it — the ends are not re-joined across the erased gap', async ({ page }) => {
  const { panel } = await setup(page);
  const sheet = await openOperation(panel, 'Seeded segmentation');
  await sheet.getByLabel('Seed brush', { exact: true }).fill('3');
  await sheet.getByRole('button', { name: 'Paint seeds' }).click();
  await sheet.getByRole('group', { name: 'Seed class' }).getByRole('button', { name: /Segment 1/ }).click();
  await drag(page, [[-30, 0], [-15, 0], [0, 0], [15, 0], [30, 0]]);
  const strokes = () => page.evaluate(() => (window as unknown as { __XNAT_E2E__: { seedStrokes: () => Array<{ cls: number; points: number }> } }).__XNAT_E2E__.seedStrokes());
  expect(await strokes()).toHaveLength(1);
  await sheet.getByRole('group', { name: 'Seed class' }).getByRole('button', { name: 'Erase' }).click();
  await drag(page, [[0, -3], [0, 3]]);
  const after = await strokes();
  expect(after, 'split in two at the erased gap').toHaveLength(2);
  expect(after.every((st) => st.points > 0)).toBe(true);
});

test('O6: the ROI limit is cleared when its viewport changes plane — it no longer confines operations as a one-row strip', async ({ page }) => {
  const { toolbox } = await setup(page);
  await clickTool(toolbox, 'ROI limit');
  await drag(page, [[-10, -10], [10, 10]]);
  await expect(toolbox.getByText(/Drawn/)).toBeVisible();
  await page.locator(`[data-panel-id="${PANEL}"]`).getByTitle('Viewport orientation').selectOption('SAGITTAL');
  await expect(toolbox.getByText(/Drawn/), 'the axial rectangle does not carry over to sagittal').toHaveCount(0);
});

test('S9: a fast Smart Brush stroke paints all along its path — no gaps between mouse events', async ({ page }) => {
  const { panel, toolbox } = await setup(page);
  await row(panel, 'Segment 1').click();
  await clickTool(toolbox, 'Smart Brush');
  const stroke = async (dy: number, steps: number) => {
    const a = (await hooks(page).point(-60, dy))!, b = (await hooks(page).point(-20, dy))!;
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps }); await page.mouse.up();
    await page.waitForTimeout(300);
  };
  await stroke(-20, 40); // slow: an event every mm
  const slow = await hooks(page).member(1);
  await stroke(20, 1); // fast: one event for 40 mm
  const fast = (await hooks(page).member(1)) - slow;
  expect(slow).toBeGreaterThan(0);
  expect(fast, `fast ${fast} vs slow ${slow}`).toBeGreaterThan(slow * 0.8);
});
