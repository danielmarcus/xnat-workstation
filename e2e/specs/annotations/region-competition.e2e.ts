/**
 * Region competition — SegWorks' multiphase "Chan-Vese" (branch 5, G5; #136–151): starting from
 * the segmentation as it is, the selected labels (and Background) compete for voxels inside the
 * ROI limit, previewed, ⏎.
 *
 * ct-axial-anatomy (world = phantom coordinates): a lesion of +70 HU (sphere r 8 mm at
 * x = +25) in +40 HU tissue; the bone core (r 14 at the origin) is kept out of the ROI. 3 mm
 * slices; the one on screen is 1.5 mm off centre, so the lesion's disc there has r ≈ 7.86 mm
 * (≈ 194 voxels). Masks are drawn with Contour Fill (freehand).
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Locator, Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';
import { clickTool } from '../../helpers/toolbox';
import { openOperation } from '../../helpers/operations';

type Win = {
  __XNAT_E2E__: {
    clearAllContainers: () => void;
    memberSliceVoxelCount: (segmentIndex: number, panelId: string) => number;
    memberVoxelCount: (segmentIndex: number) => number;
    getPanelFocalPoint: (panelId: string) => [number, number, number] | null;
    worldToPanelPagePoint: (panelId: string, world: [number, number, number]) => { x: number; y: number } | null;
  };
};

const LESION_AREA = Math.PI * (64 - 1.5 * 1.5);

test.beforeEach(({ page }) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers()));

const onSlice = (page: Page, member = 1) => page.evaluate((m) => (window as unknown as Win).__XNAT_E2E__.memberSliceVoxelCount(m, 'panel_0'), member);
const total = (page: Page, member = 1) => page.evaluate((m) => (window as unknown as Win).__XNAT_E2E__.memberVoxelCount(m), member);

async function at(page: Page, dx: number, dy: number): Promise<{ x: number; y: number }> {
  return page.evaluate(([dx, dy]) => {
    const h = (window as unknown as Win).__XNAT_E2E__;
    const f = h.getPanelFocalPoint('panel_0')!;
    return h.worldToPanelPagePoint('panel_0', [f[0] + dx, f[1] + dy, f[2]])!;
  }, [dx, dy] as const);
}

async function drag(page: Page, path: Array<[number, number]>) {
  const pts = [];
  for (const [dx, dy] of path) pts.push(await at(page, dx, dy));
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(p.x, p.y, { steps: 3 });
  await page.mouse.up();
}

/** Fill a disc (Contour Fill, freehand) of radius r round (cx, cy). */
async function disc(page: Page, cx: number, cy: number, r: number) {
  await drag(page, Array.from({ length: 49 }, (_, k) => [cx + r * Math.cos((2 * Math.PI * k) / 48), cy + r * Math.sin((2 * Math.PI * k) / 48)] as [number, number]));
  await page.waitForTimeout(300);
}

async function open(page: Page, fixture = 'ct-axial-anatomy') {
  await loadFixture(page, fixture, 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await expect(toolbox.getByRole('button', { name: 'Contour Fill', exact: true })).toBeVisible({ timeout: 10_000 });
  await clickTool(toolbox, 'Contour Fill');
  return { panel, toolbox };
}

async function roiLimit(page: Page, toolbox: Locator, from: [number, number], to: [number, number]) {
  await clickTool(toolbox, 'ROI limit');
  await drag(page, [from, to]);
  await clickTool(toolbox, 'Contour Fill');
}

async function stepSlice(page: Page, key: 'ArrowUp' | 'ArrowDown') {
  const before = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPanelFocalPoint('panel_0')![2]);
  await page.locator('[data-testid="unified-viewport-element:panel_0"]').hover();
  await page.keyboard.press(key);
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPanelFocalPoint('panel_0')![2])).not.toBe(before);
}

async function run(page: Page, sheet: Locator) {
  await sheet.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByTestId('mask-preview-bar')).toContainText('Region competition', { timeout: 30_000 });
}

/**
 * A 3D loose mask on the five slices the default run covers (the slice on screen ± 2): on each,
 * the lesion's own radius there + 1.6 mm. (A mask on one slice alone, with empty slices round it,
 * is pulled to nothing by the through-slice smoothness — the model wants a 3D mask in 3D modes.)
 */
async function looseLesion3d(page: Page) {
  await stepSlice(page, 'ArrowUp');
  await stepSlice(page, 'ArrowUp');
  for (let k = 0; k < 5; k++) {
    if (k) await stepSlice(page, 'ArrowDown');
    const z = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPanelFocalPoint('panel_0')![2]);
    if (z * z < 64) await disc(page, 25, 0, Math.sqrt(64 - z * z) + 1.6);
  }
  await stepSlice(page, 'ArrowUp');
  await stepSlice(page, 'ArrowUp');
}

test('a mask drawn loose round the lesion is pulled onto it — previewed, ⏎, one undo step', async ({ page }) => {
  const { panel, toolbox } = await open(page);
  await looseLesion3d(page);
  const loose = await onSlice(page);
  expect(loose).toBeGreaterThan(LESION_AREA * 1.3);
  await roiLimit(page, toolbox, [15, -12], [37, 12]);
  const sheet = await openOperation(panel, 'Region competition');
  await run(page, sheet);
  expect(await onSlice(page), 'previewed, not written').toBe(loose);
  await page.keyboard.press('Enter');
  await expect.poll(() => onSlice(page)).not.toBe(loose);
  const fitted = await onSlice(page);
  expect(Math.abs(fitted - LESION_AREA), `fitted ${fitted}, lesion ≈ ${Math.round(LESION_AREA)}`).toBeLessThan(LESION_AREA * 0.15);
  await page.keyboard.press('Control+z');
  await expect.poll(() => onSlice(page)).toBe(loose);
});

test('"The slice on screen" changes that slice only; the next slice keeps its mask', async ({ page }) => {
  const { panel, toolbox } = await open(page);
  await disc(page, 25, 0, 9.5);
  await stepSlice(page, 'ArrowDown');
  await disc(page, 25, 0, 9.5);
  const nextBefore = await onSlice(page);
  await stepSlice(page, 'ArrowUp');
  const hereBefore = await onSlice(page);
  await roiLimit(page, toolbox, [15, -12], [37, 12]);
  const sheet = await openOperation(panel, 'Region competition');
  await sheet.getByLabel('Run on').selectOption('slice');
  await run(page, sheet);
  await page.keyboard.press('Enter');
  await expect.poll(() => onSlice(page)).not.toBe(hereBefore);
  await stepSlice(page, 'ArrowDown');
  expect(await onSlice(page)).toBe(nextBefore);
});

test('a member that is not selected keeps every voxel', async ({ page }) => {
  const { panel, toolbox } = await open(page);
  await disc(page, 25, 0, 9.5);
  await panel.getByRole('button', { name: 'Add member' }).first().click();
  await page.keyboard.press('Escape');
  await clickTool(toolbox, 'Contour Fill');
  await disc(page, 25, 10, 3); // Segment 2, straddling the lesion's edge
  const second = await total(page, 2);
  expect(second).toBeGreaterThan(10);
  await panel.locator('[data-testid^="member-row-"]', { hasText: 'Segment 1' }).first().click();
  const first = await total(page, 1);
  await roiLimit(page, toolbox, [15, -14], [37, 14]);
  const sheet = await openOperation(panel, 'Region competition');
  await expect(sheet.getByRole('group', { name: 'Labels' }).getByLabel('Segment 2')).not.toBeChecked();
  await run(page, sheet);
  await page.keyboard.press('Enter');
  await expect.poll(() => total(page, 1)).not.toBe(first);
  expect(await total(page, 2)).toBe(second);
});

test('without an ROI limit it says what it needs and runs nothing', async ({ page }) => {
  const { panel } = await open(page);
  await disc(page, 25, 0, 9.5);
  const sheet = await openOperation(panel, 'Region competition');
  await expect(sheet.getByTestId('region-estimate')).toContainText(/Draw an ROI limit/);
  await expect(sheet.getByRole('button', { name: 'Run' })).toBeDisabled();
});

test('on an oblique acquisition a loose mask is pulled onto the sphere (index space)', async ({ page }) => {
  // ct-oblique: a sphere (r 24 mm, 300 HU in −1000) on a ~30° tilted plane; r ≈ 23.95 mm on the slice shown.
  const { panel, toolbox } = await open(page, 'ct-oblique');
  const area = Math.PI * (24 * 24 - 1.5 * 1.5);
  await disc(page, 0, 0, 26.5);
  const loose = await onSlice(page);
  await roiLimit(page, toolbox, [-31, -31], [31, 31]);
  const sheet = await openOperation(panel, 'Region competition');
  await sheet.getByLabel('Run on').selectOption('slice');
  await run(page, sheet);
  await page.keyboard.press('Enter');
  await expect.poll(() => onSlice(page)).not.toBe(loose);
  expect(Math.abs((await onSlice(page)) - area)).toBeLessThan(Math.abs(loose - area) / 2);
});
