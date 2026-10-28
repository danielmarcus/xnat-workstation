/**
 * The Smart-tab tools (SegWorks parity branch 4, C3) on the anatomy phantom — air −1000,
 * soft-tissue body +40 (r 50 mm), lesion +70 (r 8 mm at x = +25 mm), bone core +1000
 * (r 14 mm), 1 mm pixels. Every gesture is a real click or drag on the canvas; points are
 * placed in world millimetres relative to the slice centre and projected to the page.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Locator, Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';
import { clickTool } from '../../helpers/toolbox';
import { openOperation, setSlider } from '../../helpers/operations';

type Win = {
  __XNAT_E2E__: {
    clearAllContainers: () => void;
    memberVoxelCount: (i: number) => number;
    activeSegmentMinSourceValue: () => number | null;
    activeSegmentMaxSourceValue: () => number | null;
    getPanelFocalPoint: (panelId: string) => [number, number, number] | null;
    worldToPanelPagePoint: (panelId: string, world: [number, number, number]) => { x: number; y: number } | null;
    setComputeThrottle: (ms: number) => void;
  };
};
const voxels = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.memberVoxelCount(1));
const range = (page: Page) => page.evaluate(() => {
  const h = (window as unknown as Win).__XNAT_E2E__;
  return { min: h.activeSegmentMinSourceValue(), max: h.activeSegmentMaxSourceValue() };
});

/** Page point of (dx, dy) mm from the centre of the slice on screen. */
async function at(page: Page, dx: number, dy: number): Promise<{ x: number; y: number }> {
  return page.evaluate(([dx, dy]) => {
    const h = (window as unknown as Win).__XNAT_E2E__;
    const f = h.getPanelFocalPoint('panel_0')!;
    return h.worldToPanelPagePoint('panel_0', [f[0] + dx, f[1] + dy, f[2]])!;
  }, [dx, dy] as const);
}

async function drag(page: Page, path: Array<[number, number]>, shift = false) {
  const pts = [];
  for (const [dx, dy] of path) pts.push(await at(page, dx, dy));
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(p.x, p.y, { steps: 6 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
}

async function click(page: Page, dx: number, dy: number) {
  const p = await at(page, dx, dy);
  await page.mouse.click(p.x, p.y);
}

test.beforeEach(({ page }) => page.evaluate(() => {
  const h = (window as unknown as Win).__XNAT_E2E__;
  h.clearAllContainers();
  h.setComputeThrottle(0);
}));

async function smartTool(page: Page, label: string): Promise<Locator> {
  await loadFixture(page, 'ct-axial-anatomy', 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await clickTool(toolbox, label);
  return toolbox;
}

test('Level Trace: a click on the lesion previews just the lesion; ⏎ adds it as one undo step', async ({ page }) => {
  const toolbox = await smartTool(page, 'Level Trace');
  await expect(toolbox.getByTestId('smart-tool-controls')).toHaveAttribute('data-tool', 'levelTrace');
  await toolbox.getByRole('group', { name: 'Band' }).getByRole('button', { name: 'CT (HU)' }).click();
  await toolbox.getByRole('slider', { name: 'HU tolerance' }).fill('20');
  await click(page, 25, 0);
  await expect(page.getByTestId('mask-preview-bar')).toContainText('Level Trace');
  expect(await voxels(page), 'a preview writes nothing').toBe(0);
  await page.keyboard.press('Enter');
  await expect.poll(() => voxels(page)).toBeGreaterThan(150); // π·8² ≈ 201 on the centre slice
  expect(await voxels(page)).toBeLessThan(260);
  expect(await range(page)).toEqual({ min: 70, max: 70 });
  await page.keyboard.press('Control+z');
  await expect.poll(() => voxels(page)).toBe(0);
});

test('Smart Brush: a stroke along the bone stays in soft tissue, one undo per stroke', async ({ page }) => {
  await smartTool(page, 'Smart Brush');
  // x = −19 mm: the 6 mm brush overlaps the bone core (r 14) but must not paint it.
  await drag(page, [[-19, -12], [-19, 0], [-19, 12]]);
  await expect.poll(() => voxels(page)).toBeGreaterThan(100);
  const r = await range(page);
  expect(r.max, 'nothing painted on bone').toBeLessThanOrEqual(70);
  expect(r.min).toBeGreaterThanOrEqual(40);
  await page.keyboard.press('Control+z');
  await expect.poll(() => voxels(page)).toBe(0);
});

test('ROI limit confines Level Trace, shows on the image, and clears', async ({ page }) => {
  const toolbox = await smartTool(page, 'ROI limit');
  await drag(page, [[-40, -20], [-25, 20]]);
  const overlay = page.locator('[data-testid="unified-viewport-element:panel_0"] [data-testid="semi-auto-overlay"]');
  await expect(overlay).toHaveAttribute('data-marks', '1');
  await expect(toolbox.getByTestId('roi-limit-controls')).toContainText('Drawn');

  await clickTool(toolbox, 'Level Trace');
  await expect(toolbox.getByTestId('roi-limit-chip')).toBeVisible();
  await click(page, -32, 0); // soft tissue: unbounded, it would take the whole body
  await expect(page.getByTestId('mask-preview-bar')).toContainText('Level Trace');
  await page.keyboard.press('Enter');
  await expect.poll(() => voxels(page)).toBeGreaterThan(400);
  expect(await voxels(page), 'inside the 16 × 41 mm rectangle').toBeLessThanOrEqual(16 * 41);

  await toolbox.getByTestId('roi-limit-chip').getByRole('button', { name: 'Clear' }).click();
  await expect(overlay).toHaveAttribute('data-marks', '0');
  await page.keyboard.press('Control+z');
  await expect.poll(() => voxels(page)).toBe(0);
  await click(page, -32, 0);
  await expect(page.getByTestId('mask-preview-bar')).toContainText('Level Trace');
  await page.keyboard.press('Enter');
  await expect.poll(() => voxels(page), 'without the limit the body is taken').toBeGreaterThan(16 * 41);
});

/**
 * Random Walker is a Seeded segmentation method (annotation-panel-modes, 2026-10-28): the
 * operation's seed painter lays the active segment's seeds (drag) and Background's (⇧-drag),
 * and Run solves the slice on screen.
 */
async function seededWalker(page: Page): Promise<Locator> {
  const toolbox = await smartTool(page, 'Brush');
  const sheet = await openOperation(page.locator('[data-testid="annotations-side-panel"]'), 'Seeded segmentation');
  await sheet.getByLabel('Method').selectOption('randomWalker');
  await expect(sheet.getByTestId('walker-domain')).toBeVisible();
  // The lesion is only 30 HU above the tissue, against a bone-dominated σ: raise β.
  await setSlider(sheet.getByRole('slider', { name: 'Edge (β)' }), 2000);
  await setSlider(sheet.getByRole('slider', { name: 'Seed brush' }), 2);
  await sheet.getByRole('button', { name: 'Paint seeds' }).click();
  await expect(toolbox.getByTestId('toolbox-grid').locator('[aria-pressed="true"]'), 'painting seeds is no tool').toHaveCount(0);
  await drag(page, [[22, 0], [28, 0]]);
  await drag(page, [[25, -14], [39, 0], [25, 14], [11, 0], [25, -14]], true);
  await expect(sheet.getByTestId('seed-count-1')).toHaveText('1');
  await expect(sheet.getByTestId('seed-count-0')).toHaveText('1');
  return sheet;
}

test('Random Walker (a Seeded method): segment and ⇧ Background seeds, Run previews the lesion', async ({ page }) => {
  const sheet = await seededWalker(page);
  await expect(page.getByTestId('mask-preview-bar')).toHaveCount(0);
  expect(await voxels(page), 'seeds paint nothing').toBe(0);

  await sheet.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByTestId('mask-preview-bar')).toContainText('Random Walker');
  await page.keyboard.press('Enter');
  await expect.poll(() => voxels(page)).toBeGreaterThan(150);
  expect(await voxels(page)).toBeLessThan(260);
  expect((await range(page)).min, 'the lesion, not the tissue around it').toBe(70);

  await sheet.getByRole('button', { name: 'Clear seeds' }).click();
  await expect(sheet.getByTestId('seed-count-1')).toHaveText('0');
});

test('Random Walker without Background seeds says what it needs and runs nothing', async ({ page }) => {
  await smartTool(page, 'Brush');
  const sheet = await openOperation(page.locator('[data-testid="annotations-side-panel"]'), 'Seeded segmentation');
  await sheet.getByLabel('Method').selectOption('randomWalker');
  await sheet.getByRole('button', { name: 'Paint seeds' }).click();
  await drag(page, [[22, 0], [28, 0]]);
  await sheet.getByRole('button', { name: 'Run' }).click();
  await expect(sheet.getByTestId('sheet-message')).toContainText('Background');
  await expect(page.getByTestId('mask-preview-bar')).toHaveCount(0);
});

test('a locked segment: Level Trace previews read-only, Smart Brush paints nothing', async ({ page }) => {
  const toolbox = await smartTool(page, 'Level Trace');
  await page.locator('[data-testid="annotations-side-panel"]').getByRole('button', { name: 'Toggle lock' }).first().click();
  await click(page, 25, 0);
  await expect(toolbox.getByTestId('smart-tool-message')).toContainText('locked');
  await page.keyboard.press('Enter');
  expect(await voxels(page)).toBe(0);
  await page.keyboard.press('Escape');

  await clickTool(toolbox, 'Smart Brush');
  await drag(page, [[-30, -5], [-30, 5]]);
  await page.waitForTimeout(200);
  expect(await voxels(page)).toBe(0);
});

test('ROI limit confines Cleanup: Clear erases only inside the rectangle', async ({ page }) => {
  const toolbox = await smartTool(page, 'Level Trace');
  await toolbox.getByRole('group', { name: 'Band' }).getByRole('button', { name: 'CT (HU)' }).click();
  await toolbox.getByRole('slider', { name: 'HU tolerance' }).fill('20');
  await click(page, 25, 0);
  await expect(page.getByTestId('mask-preview-bar')).toContainText('Level Trace');
  await page.keyboard.press('Enter');
  await expect.poll(() => voxels(page)).toBeGreaterThan(150);
  const lesion = await voxels(page);

  await clickTool(toolbox, 'ROI limit');
  await drag(page, [[10, -15], [25, 15]]); // the lesion's left half
  const sheet = await openOperation(page.locator('[data-testid="annotations-side-panel"]'), 'Cleanup', 'Clear');
  await sheet.getByRole('button', { name: 'Commit' }).click();
  await expect.poll(() => voxels(page)).toBeLessThan(lesion);
  const left = await voxels(page);
  expect(left, 'the right half survives').toBeGreaterThan(lesion * 0.3);
  expect(left).toBeLessThan(lesion * 0.6);
});

test('Random Walker solves in the worker: progress shows while it runs, ⎋ cancels and leaves nothing', async ({ page }) => {
  const controls = await seededWalker(page);
  await controls.getByRole('button', { name: 'Paint seeds' }).click(); // ⎋ must reach the solve, not the painter
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setComputeThrottle(40));
  await controls.getByRole('button', { name: 'Run' }).click();
  const running = page.getByTestId('compute-progress-bar');
  await expect(running).toContainText('Random Walker');
  await expect(controls.getByRole('button', { name: 'Cancel run' })).toBeVisible();
  const bar = running.getByRole('progressbar');
  await expect.poll(async () => Number(await bar.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(running).toHaveCount(0);
  await page.waitForTimeout(300);
  await expect(page.getByTestId('mask-preview-bar')).toHaveCount(0);
  expect(await voxels(page)).toBe(0);
  await expect(controls.getByRole('button', { name: 'Run' })).toBeEnabled();

  // Run again unthrottled: it completes, so the cancelled worker was replaced.
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setComputeThrottle(0));
  await controls.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByTestId('mask-preview-bar')).toContainText('Random Walker');
});

test('Random Walker: the progress bar’s Cancel button stops the solve', async ({ page }) => {
  const controls = await seededWalker(page);
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setComputeThrottle(40));
  await controls.getByRole('button', { name: 'Run' }).click();
  const running = page.getByTestId('compute-progress-bar');
  await running.getByRole('button', { name: /Cancel/ }).click();
  await expect(running).toHaveCount(0);
  await page.waitForTimeout(300);
  await expect(page.getByTestId('mask-preview-bar')).toHaveCount(0);
  expect(await voxels(page)).toBe(0);
});

test('Level Trace intensity guard: typed in, it keeps the trace inside its range', async ({ page }) => {
  const toolbox = await smartTool(page, 'Level Trace');
  await toolbox.getByRole('group', { name: 'Band' }).getByRole('button', { name: 'CT (HU)' }).click();
  await toolbox.getByRole('button', { name: /Advanced/ }).click(); // the guard is an Advanced setting
  // ±100 HU from the lesion (+70) reaches the tissue (+40): unguarded, the body is taken.
  const guard = toolbox.getByTestId('intensity-guard');
  await guard.getByRole('checkbox').check();
  await guard.getByLabel('Guard minimum').fill('60');
  await guard.getByLabel('Guard maximum').fill('80');
  await click(page, 25, 0);
  await expect(page.getByTestId('mask-preview-bar')).toContainText('Level Trace');
  await page.keyboard.press('Enter');
  await expect.poll(() => voxels(page)).toBeGreaterThan(150);
  expect(await voxels(page)).toBeLessThan(260);
  expect(await range(page)).toEqual({ min: 70, max: 70 });
});

test('Level Trace intensity guard: read from the ROI limit', async ({ page }) => {
  const toolbox = await smartTool(page, 'ROI limit');
  await drag(page, [[22, -3], [28, 3]]); // inside the lesion
  await clickTool(toolbox, 'Level Trace');
  await toolbox.getByRole('group', { name: 'Band' }).getByRole('button', { name: 'CT (HU)' }).click();
  await toolbox.getByRole('button', { name: /Advanced/ }).click(); // the guard is an Advanced setting
  const guard = toolbox.getByTestId('intensity-guard');
  await guard.getByRole('button', { name: 'From ROI' }).click();
  await expect(guard.getByLabel('Guard minimum')).toHaveValue('70');
  await expect(guard.getByLabel('Guard maximum')).toHaveValue('70');
  await toolbox.getByTestId('roi-limit-chip').getByRole('button', { name: 'Clear' }).click();
  await expect(guard.getByRole('button', { name: 'From ROI' })).toBeDisabled();
  await click(page, 25, 0);
  await expect(page.getByTestId('mask-preview-bar')).toContainText('Level Trace');
  await page.keyboard.press('Enter');
  await expect.poll(() => voxels(page)).toBeGreaterThan(150);
  expect(await voxels(page), 'the whole lesion, not just the ROI').toBeLessThan(260);
  expect(await range(page)).toEqual({ min: 70, max: 70 });
});
