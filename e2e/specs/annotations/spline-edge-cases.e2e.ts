/**
 * Spline and Structure edge cases (#99, ledger T12), each through the real affordance:
 *
 *  1. A double-click closes a spline anywhere; with "No crossing" on, a double-click whose
 *     closed curve would cross itself is refused like a crossing closing click — it used to
 *     close the spline, then the render-time guard reverted it to the last good OPEN curve
 *     and the drawing ended with an open, truncated contour.
 *  2. A spline in hand is a preview: it neither marks its container unsaved nor schedules
 *     an autosave. Only its commit does.
 *  3. A spline keeps the shape it was made with: Density, Tension and the ROI active
 *     spline's edge pull are read from the annotation, not from the global settings at
 *     every render (changing Options reshaped a held spline).
 *  4. Fit ROI zooms and centres in the plane on screen; it does not move to the slice the
 *     ROI limit was drawn on.
 *
 * (5, the RTSTRUCT plane, is in transport/rtstruct-load.)
 *
 * ct-axial-anatomy: bone core +1000 HU (sphere r 14 mm) in +40 HU tissue, 1 mm pixels.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Locator, Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';
import { clickTool } from '../../helpers/toolbox';
import { setSlider } from '../../helpers/operations';

type Shape = { toolName: string; polyline: string; closed: boolean; handles: number };
type Win = {
  __XNAT_E2E__: {
    clearAllContainers: () => void;
    resetContourToolSettings: () => void;
    getContourShapes: () => Shape[];
    contourDrawing: () => boolean;
    installMockXnatTransport: () => void;
    getActiveContourSnapshot: (panelId?: string) => { currentSliceIndex: number | null };
    getPanelParallelScale: (panelId: string) => number | null;
    getPanelFocalPoint: (panelId: string) => [number, number, number] | null;
    worldToPanelPagePoint: (panelId: string, world: [number, number, number]) => { x: number; y: number } | null;
  };
};

const BONE_R = Math.sqrt(14 * 14 - 1.5 * 1.5);
const RING = [0, 45, 90, 135, 180, 225, 270, 315];
const SPLINE = 'SplineContourSegmentationTool';
const COMMITTED = 'PlanarFreehandContourSegmentationTool';

test.beforeEach(({ page }) => page.evaluate(() => {
  const h = (window as unknown as Win).__XNAT_E2E__;
  h.clearAllContainers();
  h.resetContourToolSettings();
}));

const shapes = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getContourShapes());
const splines = async (page: Page) => (await shapes(page)).filter((s) => s.toolName === SPLINE);
const sliceIndex = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getActiveContourSnapshot('panel_0').currentSliceIndex);
const button = (toolbox: Locator, name: string) => toolbox.getByRole('button', { name, exact: true });

/** Page point of (dx, dy) mm from the centre of the slice on screen. */
async function at(page: Page, dx: number, dy: number): Promise<{ x: number; y: number }> {
  return page.evaluate(([dx, dy]) => {
    const h = (window as unknown as Win).__XNAT_E2E__;
    const f = h.getPanelFocalPoint('panel_0')!;
    return h.worldToPanelPagePoint('panel_0', [f[0] + dx, f[1] + dy, f[2]])!;
  }, [dx, dy] as const);
}

async function click(page: Page, dx: number, dy: number) {
  const p = await at(page, dx, dy);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(150);
}

async function panelOf(page: Page) {
  await loadFixture(page, 'ct-axial-anatomy', 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  return panel;
}

async function structureSpline(panel: Locator) {
  await panel.getByRole('button', { name: 'New Structure (RTSTRUCT)' }).click();
  await panel.page().keyboard.press('Escape');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await expect(toolbox.getByRole('button', { name: 'Spline', exact: true })).toBeVisible({ timeout: 10_000 });
  await clickTool(toolbox, 'Spline');
  return toolbox;
}

/** A ROI limit drawn with the Segmentation toolbox's tool (corners in mm from the centre). */
async function drawRoi(page: Page, panel: Locator, roi: [[number, number], [number, number]]) {
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await clickTool(toolbox, 'ROI limit');
  const a = await at(page, roi[0][0], roi[0][1]), b = await at(page, roi[1][0], roi[1][1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  await expect(toolbox.getByTestId('roi-limit-controls')).toContainText('Drawn');
}

async function ringAndClose(page: Page, r: number) {
  for (const d of RING) await click(page, r * Math.cos((d * Math.PI) / 180), r * Math.sin((d * Math.PI) / 180));
  await click(page, r, 0);
}

async function stepSlice(page: Page, key: 'ArrowUp' | 'ArrowDown') {
  const from = (await sliceIndex(page)) ?? 0;
  await page.keyboard.press(key);
  await expect.poll(() => sliceIndex(page)).toBe(from + (key === 'ArrowDown' ? 1 : -1));
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

/** A render of the viewport, as moving the pointer over it causes. */
async function rerender(page: Page) {
  const p = await at(page, 25, 25);
  await page.mouse.move(p.x, p.y);
  await page.mouse.move(p.x + 3, p.y + 3);
  await page.waitForTimeout(300);
}

test('1 · No crossing: a double-click whose closed curve would cross is refused, and drawing goes on', async ({ page }) => {
  const toolbox = await structureSpline(await panelOf(page));
  await toolbox.getByRole('button', { name: /Options/ }).click();
  await toolbox.getByLabel('Prevent self-intersection').check();
  // An open curve that does not cross; closing it from (15, 5) cuts back across B→C.
  for (const [x, y] of [[-15, 0], [0, -20], [0, 20], [15, 20]] as const) await click(page, x, y);
  await page.waitForTimeout(800);
  expect((await splines(page)).map((s) => s.handles)).toEqual([4]);

  const e = await at(page, 15, 5);
  await page.mouse.dblclick(e.x, e.y);
  await page.waitForTimeout(800);
  const after = await shapes(page);
  expect(after.filter((s) => s.toolName === COMMITTED), 'nothing is committed').toHaveLength(0);
  expect(after.filter((s) => s.toolName === SPLINE).map((s) => [s.handles, s.closed]), 'the spline is unchanged and still open').toEqual([[4, false]]);
  expect(await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.contourDrawing()), 'still drawing').toBe(true);
  // ...so the drawing can still be finished: Undo point acts on the spline being drawn.
  await button(toolbox, 'Undo point').click();
  await expect.poll(async () => (await splines(page)).map((s) => s.handles)).toEqual([3]);
});

test('2 · a spline in hand does not mark its container unsaved', async ({ page }) => {
  const panel = await panelOf(page);
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.installMockXnatTransport());
  const toolbox = await structureSpline(panel);
  await ringAndClose(page, BONE_R);
  await expect.poll(async () => (await shapes(page)).filter((s) => s.toolName === COMMITTED).length, { timeout: 5_000 }).toBe(1);
  // Save, so the container is clean.
  await expect(panel.locator('[data-testid="unsaved-count"]')).toHaveText('1', { timeout: 10_000 });
  await panel.locator('[data-testid="unsaved-indicator"]').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Save all' }).click();
  await expect(dialog.getByText(/All annotations saved/)).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(panel.locator('[data-testid="unsaved-count"]')).toHaveCount(0, { timeout: 10_000 });

  await stepSlice(page, 'ArrowDown');
  await button(toolbox, 'Copy nearby').click();
  await expect.poll(async () => (await splines(page)).filter((s) => s.closed).length).toBe(1);
  await rerender(page);
  await page.waitForTimeout(1000);
  await expect(panel.locator('[data-testid="unsaved-count"]'), 'holding a spline is not an edit').toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await expect(panel.locator('[data-testid="unsaved-count"]'), 'discarding it leaves the container clean').toHaveCount(0);
});

test('3 · a held spline keeps its shape when Density, Tension or the algorithm change', async ({ page }) => {
  const panel = await panelOf(page);
  await drawRoi(page, panel, [[-25, -25], [25, 25]]);
  const toolbox = await structureSpline(panel);
  await toolbox.getByLabel('Spline algorithm').selectOption('localCR');
  await ringAndClose(page, BONE_R - 3);
  await expect.poll(async () => (await shapes(page)).filter((s) => s.toolName === COMMITTED).length, { timeout: 5_000 }).toBe(1);
  await stepSlice(page, 'ArrowDown');
  await button(toolbox, 'Copy nearby').click();
  await expect.poll(async () => (await splines(page)).filter((s) => s.closed).length).toBe(1);
  await rerender(page);
  const held = async () => (await splines(page)).filter((s) => s.closed)[0].polyline;
  const before = await held();

  await toolbox.getByRole('button', { name: /Options/ }).click();
  await setSlider(toolbox.getByLabel('Density'), 64);
  await rerender(page);
  expect(await held(), 'Density').toBe(before);
  await setSlider(toolbox.getByLabel('Tension'), 0.9);
  await rerender(page);
  expect(await held(), 'Tension').toBe(before);
  // The ROI active spline pulls ITS curves onto edges; this one was made as local Catmull-Rom+.
  await toolbox.getByLabel('Spline algorithm').selectOption('roiActiveSpline');
  await rerender(page);
  expect(await held(), 'algorithm').toBe(before);
});

test('4 · Fit ROI zooms to the ROI limit on the slice on screen — it does not move to the ROI\'s slice', async ({ page }) => {
  const panel = await panelOf(page);
  await drawRoi(page, panel, [[10, 10], [30, 30]]);
  const toolbox = await structureSpline(panel);
  await stepSlice(page, 'ArrowDown');
  await stepSlice(page, 'ArrowDown');
  const slice = await sliceIndex(page);
  const f0 = (await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPanelFocalPoint('panel_0')))!;
  const before = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPanelParallelScale('panel_0'));
  await toolbox.getByRole('group', { name: 'Edit' }).getByRole('button', { name: 'Local ROI' }).click();
  await button(toolbox, 'Fit ROI').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPanelParallelScale('panel_0'))).toBeLessThan(before! / 2);
  await page.waitForTimeout(300);
  expect(await sliceIndex(page), 'the slice on screen').toBe(slice);
  const f1 = (await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPanelFocalPoint('panel_0')))!;
  expect(Math.abs(f1[2] - f0[2]), 'the focal plane').toBeLessThan(0.01);
  expect(Math.hypot(f1[0] - (f0[0] + 20), f1[1] - (f0[1] + 20)), 'centred on the ROI').toBeLessThan(1);
});
