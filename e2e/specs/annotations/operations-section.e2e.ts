/**
 * The Operations section and the Segmentation toolbox (SegWorks parity D1/D2 as amended
 * 2026-10-12; tool families and modes, docs/annotation-panel-modes.md, 2026-10-28).
 *
 * Tools and operations are separate: every tool family is on screen at once in a toolbox
 * whose height never changes, and an operation opens in its own section between the member list
 * and the toolbox, where it stays usable while the tools change. Drives the real
 * affordances (tool buttons, the Operation picker, collapse, strokes on the image) and
 * asserts layout in pixels and the labelmap in voxels.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';
import { clickTool, toolFamily } from '../../helpers/toolbox';
import { openOperation } from '../../helpers/operations';

type Win = { __XNAT_E2E__: { clearAllContainers: () => void; activeSegmentVoxelCount: () => number } };
const VIEWPORT = '[data-testid="unified-viewport-element:panel_0"]';

/** The Segmentation tool families, in the toolbox's order. */
const SEG_FAMILIES = ['Select', 'Brush', 'Fill', 'Shape', 'Contour', 'Region', 'Trace'];
/** Every Segmentation tool (each a family and its modes), plus the ROI limit toggle. */
const SEG_TOOLS = [
  'Select',
  'Brush', 'Threshold', 'Dyn. Thresh', 'Sph. Brush', 'Sph. Thresh', 'Paint Fill', 'Smart Brush',
  'Circle', 'Rect', 'Sphere', 'Rect Threshold', 'Circle Threshold', 'Contour Fill',
  'Region', 'Region+', 'Level Trace', 'ROI limit',
];

test.beforeEach(({ page }) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers()));

const voxels = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.activeSegmentVoxelCount());

async function stroke(page: Page, fx: number, fy: number, len: number) {
  const b = (await page.locator(`${VIEWPORT} canvas`).boundingBox())!;
  await page.mouse.move(b.x + b.width * fx, b.y + b.height * fy);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * (fx + len), b.y + b.height * fy, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

async function segmentation(page: Page) {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await clickTool(toolbox, 'Brush');
  return { panel, toolbox };
}

/** Two islands of the active segment: a long stroke and a dot. Keep largest removes the dot. */
async function twoIslands(page: Page) {
  await stroke(page, 0.25, 0.5, 0.2);
  await stroke(page, 0.75, 0.5, 0.01);
}

test('every Segmentation tool family is on screen at once, in one row: there are no tabs', async ({ page }) => {
  const { toolbox } = await segmentation(page);
  await expect(toolbox.getByRole('tab')).toHaveCount(0);
  const tops = new Set<number>();
  for (const label of SEG_FAMILIES) {
    const b = toolbox.getByTestId('toolbox-grid').getByRole('button', { name: label, exact: true });
    await expect(b, label).toBeVisible();
    tops.add(Math.round((await b.boundingBox())!.y));
  }
  expect(tops.size, 'one row').toBe(1);
});

test('the toolbox keeps one height whatever tool is active, and no tool\'s controls scroll', async ({ page }) => {
  const { toolbox } = await segmentation(page);
  const heights: Record<string, number> = {};
  const overflow: Record<string, number | null> = {};
  for (const label of SEG_TOOLS) {
    await clickTool(toolbox, label);
    await page.waitForTimeout(80);
    heights[label] = Math.round((await toolbox.boundingBox())!.height);
    overflow[label] = await toolbox.evaluate((el) => {
      const c = el.querySelector('[data-testid="toolbox-controls"]');
      return c ? c.scrollHeight - c.clientHeight : null;
    });
  }
  // Contour Fill's controls change with its boundary (D3): each mode counts as a tool here.
  await clickTool(toolbox, 'Contour Fill');
  for (const mode of ['Freehand', 'Spline', 'Live Wire']) {
    await toolbox.getByRole('group', { name: 'Boundary' }).getByRole('button', { name: mode }).click();
    await page.waitForTimeout(80);
    const key = `Contour Fill · ${mode}`;
    heights[key] = Math.round((await toolbox.boundingBox())!.height);
    overflow[key] = await toolbox.evaluate((el) => {
      const c = el.querySelector('[data-testid="toolbox-controls"]');
      return c ? c.scrollHeight - c.clientHeight : null;
    });
  }
  expect(new Set(Object.values(heights)).size, JSON.stringify(heights)).toBe(1);
  for (const label of Object.keys(overflow)) expect(overflow[label], `${label} controls overflow`).toBe(0);
});

test('Cleanup opens from the Operations row, between the member list and the toolbox, and the toolbox stays put', async ({ page }) => {
  const { panel, toolbox } = await segmentation(page);
  const closed = (await toolbox.boundingBox())!;
  await openOperation(panel, 'Cleanup');
  // The drawer names no target (R6): the member is named once outside the list, by the chip.
  await expect(panel.getByTestId('sheet-target')).toHaveCount(0);
  await expect(panel.getByTestId('editing-chip')).toContainText('Segment 1');

  const section = (await panel.getByTestId('operations-section').boundingBox())!;
  const member = (await panel.locator('[data-testid^="member-row-"]').first().boundingBox())!;
  const open = (await toolbox.boundingBox())!;
  expect(member.y).toBeLessThan(section.y);
  expect(section.y + section.height).toBeLessThanOrEqual(open.y + 1);
  // Opening an operation takes room from the list, never from the toolbox.
  expect(Math.round(open.height)).toBe(Math.round(closed.height));
  expect(Math.round(open.y)).toBe(Math.round(closed.y));
});

test('the drawer\'s height is dragged from its band\'s top edge; the list gives way, the toolbox stays put', async ({ page }) => {
  const { panel, toolbox } = await segmentation(page);
  await openOperation(panel, 'Cleanup');
  const drawer = panel.getByTestId('operations-section');
  const before = (await drawer.boundingBox())!;
  const tools = (await toolbox.boundingBox())!;
  const handle = (await panel.getByRole('separator', { name: 'Resize operation' }).boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 - 100, { steps: 8 });
  await page.mouse.up();
  const after = (await drawer.boundingBox())!;
  expect(after.height - before.height).toBeGreaterThan(90);
  expect(after.height - before.height).toBeLessThan(110);
  expect(Math.round((await toolbox.boundingBox())!.y)).toBe(Math.round(tools.y));
  // Collapsed it is the band alone; expanded again it keeps the dragged height.
  await panel.getByRole('button', { name: 'Collapse operation' }).click();
  expect((await drawer.boundingBox())!.height).toBeLessThan(40);
  await panel.getByRole('button', { name: 'Expand operation' }).click();
  expect(Math.round((await drawer.boundingBox())!.height)).toBe(Math.round(after.height));
});

test('an open operation stays on screen and usable while the tools change', async ({ page }) => {
  const { panel, toolbox } = await segmentation(page);
  await twoIslands(page);
  const before = await voxels(page);
  const sheet = await openOperation(panel, 'Cleanup', 'Keep largest');
  for (const label of ['Threshold', 'Circle', 'Region', 'Brush']) {
    await clickTool(toolbox, label);
    await expect(toolbox.getByTestId('toolbox-grid').getByRole('button', { name: toolFamily(label), exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(sheet).toBeVisible();
  }
  await sheet.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByTestId('mask-preview-bar')).toContainText('Keep largest');
  await page.keyboard.press('Enter');
  await expect.poll(() => voxels(page)).toBeLessThan(before);
});

test('collapsing an operation keeps it and its preview alive; X expands it again', async ({ page }) => {
  const { panel } = await segmentation(page);
  await twoIslands(page);
  const before = await voxels(page);
  const sheet = await openOperation(panel, 'Cleanup', 'Keep largest');
  await sheet.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByTestId('mask-preview-bar')).toBeVisible();

  await panel.getByRole('button', { name: 'Collapse operation' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(panel.getByTestId('operations-section')).toContainText('Preview pending');
  await expect(page.getByTestId('mask-preview-bar')).toBeVisible();

  await page.locator(VIEWPORT).click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('x');
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Commit' }).click();
  await expect.poll(() => voxels(page)).toBeLessThan(before);
});

test('painting under a pending preview discards it, and the operation says so', async ({ page }) => {
  const { panel, toolbox } = await segmentation(page);
  await twoIslands(page);
  const sheet = await openOperation(panel, 'Cleanup', 'Keep largest');
  await sheet.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByTestId('mask-preview-bar')).toBeVisible();

  await clickTool(toolbox, 'Brush');
  const beforeStroke = await voxels(page);
  await stroke(page, 0.3, 0.3, 0.1);
  await expect(page.getByTestId('mask-preview-bar')).toHaveCount(0);
  await expect(sheet.getByTestId('sheet-message')).toHaveText('Preview discarded: the segment changed');
  // The stroke landed and nothing stale was committed.
  expect(await voxels(page)).toBeGreaterThan(beforeStroke);
});

test('a Smart Brush stroke under a pending preview discards it too, and the operation says so', async ({ page }) => {
  // Smart Brush paints through a live (silent) preview of its own, which replaces the
  // operation's preview; its commit on release must not wipe the notice.
  const { panel, toolbox } = await segmentation(page);
  await twoIslands(page);
  const sheet = await openOperation(panel, 'Cleanup', 'Keep largest');
  await sheet.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByTestId('mask-preview-bar')).toBeVisible();

  await clickTool(toolbox, 'Smart Brush');
  await stroke(page, 0.3, 0.3, 0.1);
  await expect(page.getByTestId('mask-preview-bar')).toHaveCount(0);
  await expect(sheet.getByTestId('sheet-message')).toHaveText('Preview discarded: the segment changed');
});
