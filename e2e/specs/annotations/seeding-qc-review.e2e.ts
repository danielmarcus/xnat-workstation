/**
 * Regressions for the solver / 3D QC review (docs/bug-review-2026-10.md S3, S4, S6, S10 —
 * GH #92, #93, #94, #100). Every gesture is a real click or drag; the hooks only observe
 * (the seed raster a run solved with, grid-read counters, the built QC surfaces) or slow the
 * compute worker down so two jobs can overlap.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Locator, Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';
import { clickTool } from '../../helpers/toolbox';
import { openOperation, setSlider } from '../../helpers/operations';

type Raster = { spacing: [number, number, number]; classes: Record<number, { voxels: number; extentMm: [number, number, number] }> };
type Win = {
  __XNAT_E2E__: {
    clearAllContainers: () => void;
    clearSeeds: () => void;
    setComputeThrottle: (ms: number) => void;
    startRandomWalker: (viewportId: string) => void;
    setLayoutPreset: (p: 'single' | 'mpr-2x2') => void;
    memberVoxelCount: (i: number) => number;
    inPlanePagePoint: (panelId: string, dx: number, dy: number) => { x: number; y: number } | null;
    lastSeedRaster: () => Raster | null;
    solverGridReads: () => number;
    qc3dGridReads: () => number;
    qc3dComponents: () => Array<{ segmentIndex: number; componentId: number }>;
  };
};
const reads = (page: Page, which: 'solverGridReads' | 'qc3dGridReads') => page.evaluate((k) => (window as unknown as Win).__XNAT_E2E__[k](), which);
const raster = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.lastSeedRaster());
const voxels = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.memberVoxelCount(1));
const throttle = (page: Page, ms: number) => page.evaluate((m) => (window as unknown as Win).__XNAT_E2E__.setComputeThrottle(m), ms);
const built = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.qc3dComponents().length);

test.beforeEach(({ page }) => page.evaluate(() => {
  const w = (window as unknown as Win).__XNAT_E2E__;
  w.clearAllContainers();
  w.clearSeeds();
  w.setComputeThrottle(0);
}));

/** Page point (dx, dy) mm from the centre of what `panelId` shows, along its screen axes. */
async function at(page: Page, panelId: string, dx: number, dy: number) {
  const p = await page.evaluate(([id, x, y]) => (window as unknown as Win).__XNAT_E2E__.inPlanePagePoint(id, x, y), [panelId, dx, dy] as const);
  expect(p, `a point on ${panelId}`).not.toBeNull();
  return p!;
}

async function drag(page: Page, panelId: string, path: Array<[number, number]>, shift = false, steps = 6) {
  const pts = [];
  for (const [dx, dy] of path) pts.push(await at(page, panelId, dx, dy));
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(p.x, p.y, { steps });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
}

async function newSegmentation(page: Page): Promise<{ panel: Locator; toolbox: Locator }> {
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await expect(toolbox.getByRole('button', { name: 'Brush', exact: true })).toBeVisible({ timeout: 10_000 });
  return { panel, toolbox };
}

/** ct-body-512 (0.7 mm pixels, 2.5 mm slices) in the MPR 2×2, with a Segmentation. */
async function mprBody(page: Page) {
  await loadFixture(page, 'ct-body-512', 'panel_0');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setLayoutPreset('mpr-2x2'));
  await expect(page.locator('[data-testid="unified-viewport:panel_1"] canvas').first()).toBeVisible({ timeout: 30_000 });
  return newSegmentation(page);
}

/** Make a viewport active with a click in its corner (no tool that paints may be on). */
async function activate(page: Page, panelId: string) {
  await page.locator(`[data-testid="unified-viewport:${panelId}"]`).click({ position: { x: 12, y: 12 } });
  await expect(page.locator(`[data-testid="unified-viewport:${panelId}"]`)).toHaveAttribute('data-active', 'true');
}

// ─── S3 (#92): brushes are round in mm, not in voxels ───────────────────────

test('S3: a seed painted on the sagittal view of thick-slice CT is round in mm', async ({ page }) => {
  const { panel } = await mprBody(page);
  const sheet = await openOperation(panel, 'Seeded segmentation');
  await activate(page, 'panel_1');
  await sheet.getByRole('button', { name: 'Paint seeds' }).click();
  await drag(page, 'panel_1', [[0, 0], [0.5, 0]]); // a dab of the lesion
  await drag(page, 'panel_1', [[40, 0], [40.5, 0]], true); // and of the Background
  await expect(sheet.getByTestId('seed-count-1')).toHaveText('1');
  await sheet.getByRole('button', { name: 'Run' }).click();
  await expect.poll(() => raster(page)).not.toBeNull();
  const r = (await raster(page))!;
  const fg = r.classes[1];
  const voxel = Math.max(r.spacing[0], r.spacing[1]);
  expect(Math.abs(fg.extentMm[0] - fg.extentMm[1]), `seed ${fg.extentMm[0]} × ${fg.extentMm[1]} mm (spacing ${r.spacing})`).toBeLessThanOrEqual(voxel);
});

test('S3: a Random Walker seed on the sagittal view is round in mm', async ({ page }) => {
  const { panel } = await mprBody(page);
  // Random Walker is a Seeded segmentation method (annotation-panel-modes, 2026-10-28).
  const sheet = await openOperation(panel, 'Seeded segmentation');
  await sheet.getByLabel('Method').selectOption('randomWalker');
  await setSlider(sheet.getByRole('slider', { name: 'Seed brush' }), 16);
  await activate(page, 'panel_1');
  await sheet.getByRole('button', { name: 'Paint seeds' }).click();
  await drag(page, 'panel_1', [[0, 0], [0.5, 0]]);
  await drag(page, 'panel_1', [[40, 0], [40.5, 0]], true);
  await expect(sheet.getByTestId('seed-count-1')).toHaveText('1');
  await expect(sheet.getByTestId('seed-count-0')).toHaveText('1');
  await sheet.getByRole('button', { name: 'Run' }).click();
  await expect.poll(() => raster(page)).not.toBeNull();
  const r = (await raster(page))!;
  const fg = r.classes[1];
  expect(Math.abs(fg.extentMm[0] - fg.extentMm[1]), `seed ${fg.extentMm[0]} × ${fg.extentMm[1]} mm (spacing ${r.spacing})`).toBeLessThanOrEqual(Math.max(r.spacing[0], r.spacing[1]));
});

// ─── S4 (#93): seeds painted in another orientation ─────────────────────────

test('S4: seeds painted on sagittal and run from axial are the seeds painted — not a few voxels', async ({ page }) => {
  const { panel } = await mprBody(page);
  const sheet = await openOperation(panel, 'Seeded segmentation');
  await activate(page, 'panel_1');
  await sheet.getByRole('button', { name: 'Paint seeds' }).click();
  await drag(page, 'panel_1', [[-5, -8], [5, 8]]); // inside the lesion, across slices
  await drag(page, 'panel_1', [[30, -20], [30, 20]], true); // Background, across slices
  await expect(sheet.getByTestId('seed-count-0')).toHaveText('1');
  await sheet.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByTestId('mask-preview-bar')).toContainText('Fast GrowCut', { timeout: 30_000 });
  const painted = (await raster(page))!;
  await page.getByTestId('mask-preview-bar').getByRole('button', { name: /Discard/ }).click();
  await expect(page.getByTestId('mask-preview-bar')).toHaveCount(0);

  await sheet.getByRole('button', { name: 'Paint seeds' }).click(); // painting off: the click only activates
  await activate(page, 'panel_0');
  await sheet.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByTestId('mask-preview-bar')).toContainText('Fast GrowCut', { timeout: 30_000 });
  const fromAxial = (await raster(page))!;
  for (const cls of [1, 2]) {
    expect(fromAxial.classes[cls]?.voxels ?? 0, `class ${cls}: the axial run's seeds`).toBe(painted.classes[cls].voxels);
  }
});

// ─── S6 (#94): QC builds and solves share the compute worker ────────────────

/** ct-axial-anatomy: a segment with the lesion (Level Trace) and a separate stray dab (Brush). */
async function segmentWithStray(page: Page) {
  await loadFixture(page, 'ct-axial-anatomy', 'panel_0');
  const { panel, toolbox } = await newSegmentation(page);
  await clickTool(toolbox, 'Level Trace');
  await toolbox.getByRole('group', { name: 'Band' }).getByRole('button', { name: 'CT (HU)' }).click();
  await toolbox.getByRole('slider', { name: 'HU tolerance' }).fill('20');
  const p = await at(page, 'panel_0', 25, 0);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId('mask-preview-bar')).toContainText('Level Trace');
  await page.keyboard.press('Enter');
  await expect.poll(() => voxels(page)).toBeGreaterThan(150);
  const lesion = await voxels(page);
  await clickTool(toolbox, 'Brush');
  const q = await at(page, 'panel_0', -30, 30);
  await page.mouse.click(q.x, q.y);
  await expect.poll(() => voxels(page)).toBeGreaterThan(lesion);
  return { panel, toolbox };
}

/**
 * Random Walker seeds on the bone core, which the segment does not have yet, painted with the
 * Seeded segmentation operation's painter (Random Walker is one of its methods). The operation
 * is then closed: one operation is open at a time, so these tests open 3D QC next and start the
 * solve through `startRandomWalker` — no UI path overlaps a solve with a QC build any more, but
 * the two compute clients must still not disturb each other (#94).
 */
async function walkerSeeds(page: Page, panel: Locator): Promise<() => Promise<void>> {
  const sheet = await openOperation(panel, 'Seeded segmentation');
  await sheet.getByLabel('Method').selectOption('randomWalker');
  await setSlider(sheet.getByRole('slider', { name: 'Edge (β)' }), 2000);
  await setSlider(sheet.getByRole('slider', { name: 'Seed brush' }), 2);
  await sheet.getByRole('button', { name: 'Paint seeds' }).click();
  await drag(page, 'panel_0', [[-3, 0], [3, 0]]);
  await drag(page, 'panel_0', [[0, -20], [20, 0], [0, 20], [-20, 0], [0, -20]], true);
  await expect(sheet.getByTestId('seed-count-1')).toHaveText('1');
  await expect(sheet.getByTestId('seed-count-0')).toHaveText('1');
  await panel.getByRole('button', { name: 'Close operation' }).click();
  return () => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.startRandomWalker('panel_0'));
}

test('S6: a solve started during a QC build — both finish; the report is not an empty “0 stray”', async ({ page }) => {
  const { panel } = await segmentWithStray(page);
  const run = await walkerSeeds(page, panel);
  await throttle(page, 2500); // the QC build reads its throttle when it starts
  const sheet = await openOperation(panel, '3D QC');
  await expect(sheet).toContainText('Building');
  await throttle(page, 0);
  await run();
  await expect(page.getByTestId('mask-preview-bar')).toContainText('Random Walker', { timeout: 30_000 });
  await expect(sheet.getByTestId('qc3d-row')).toHaveCount(2, { timeout: 30_000 });
  await expect.poll(() => built(page), { timeout: 30_000 }).toBe(2);
});

test('S6: a QC rebuild during a solve does not cancel the solve', async ({ page }) => {
  const { panel } = await segmentWithStray(page);
  const run = await walkerSeeds(page, panel);
  const sheet = await openOperation(panel, '3D QC');
  await expect(sheet.getByTestId('qc3d-row')).toHaveCount(2, { timeout: 30_000 });
  await throttle(page, 60);
  await run();
  await expect(page.getByTestId('compute-progress-bar')).toContainText('Random Walker');
  await sheet.getByRole('button', { name: 'Rebuild' }).click();
  await expect(page.getByTestId('mask-preview-bar')).toContainText('Random Walker', { timeout: 60_000 });
  await expect(sheet.getByTestId('qc3d-row')).toHaveCount(2, { timeout: 30_000 });
});

test('S6: a setting changed during a build starts another; Done cancels that one — nothing is written back', async ({ page }) => {
  const { panel } = await segmentWithStray(page);
  const sheet = await openOperation(panel, '3D QC');
  await expect(sheet.getByTestId('qc3d-row')).toHaveCount(2, { timeout: 30_000 });
  await throttle(page, 1500);
  await sheet.getByRole('button', { name: 'Rebuild' }).click();
  await expect(sheet.getByTestId('qc3d-building')).toBeVisible();
  // A build setting rebuilds (debounced) — over the build still running.
  await sheet.getByRole('group', { name: 'Renderer' }).getByRole('button', { name: 'Voxels' }).click();
  await page.waitForTimeout(700);
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('[data-testid="unified-viewport-element:panel_qc3d"]')).toHaveCount(0);
  await page.waitForTimeout(9000); // well past when the build would have finished
  expect(await built(page), 'no surfaces came back after the sheet closed').toBe(0);
});

// ─── S10 (#100) ──────────────────────────────────────────────────────────────

test('S10.1: painting a seed stroke does not re-read the volume on every move', async ({ page }) => {
  const { panel } = await mprBody(page);
  const sheet = await openOperation(panel, 'Seeded segmentation');
  await sheet.getByRole('button', { name: 'Paint seeds' }).click();
  await drag(page, 'panel_0', [[-10, 0], [10, 0]]);
  const before = await reads(page, 'solverGridReads');
  await drag(page, 'panel_0', [[-10, 5], [10, 5], [10, 15]], false, 20);
  await expect(sheet.getByTestId('seed-count-1')).toHaveText('2');
  expect(await reads(page, 'solverGridReads') - before, 'grid reads during a 40-move stroke').toBeLessThanOrEqual(2);
});

test('S10.2: the QC report rows do not re-read the volume when one is selected', async ({ page }) => {
  const { panel } = await segmentWithStray(page);
  const sheet = await openOperation(panel, '3D QC');
  await expect(sheet.getByTestId('qc3d-row')).toHaveCount(2, { timeout: 30_000 });
  const before = await reads(page, 'qc3dGridReads');
  await sheet.getByTestId('qc3d-row').nth(1).click();
  await expect(sheet.getByTestId('qc3d-row').nth(1)).toHaveAttribute('aria-selected', 'true');
  await sheet.getByTestId('qc3d-row').nth(0).click();
  await expect(sheet.getByTestId('qc3d-row').nth(0)).toHaveAttribute('aria-selected', 'true');
  expect(await reads(page, 'qc3dGridReads') - before).toBe(0);
});

test('S10.3: an edit made while QC is building leaves the report out of date', async ({ page }) => {
  const { panel } = await segmentWithStray(page);
  await throttle(page, 2500);
  const sheet = await openOperation(panel, '3D QC');
  await expect(sheet).toContainText('Building');
  const p = await at(page, 'panel_0', -30, -30); // the Brush is still the tool
  await page.mouse.click(p.x, p.y);
  await expect(sheet.getByTestId('qc3d-row')).toHaveCount(2, { timeout: 30_000 });
  await expect(sheet.getByTestId('qc3d-stale')).toBeVisible();
});

test('S10.4: 3D QC opened from the sagittal view of an MPR shows the scan in its 2D view', async ({ page }) => {
  const { panel, toolbox } = await mprBody(page);
  await clickTool(toolbox, 'Rect');
  await drag(page, 'panel_0', [[-6, -6], [6, 6]]);
  await expect.poll(() => voxels(page)).toBeGreaterThan(0);
  await activate(page, 'panel_1'); // a click with Rect draws nothing
  const sheet = await openOperation(panel, '3D QC');
  await expect(sheet.getByTestId('qc3d-row')).toHaveCount(1, { timeout: 30_000 });
  const canvas = page.locator('[data-testid="unified-viewport-element:panel_1"] canvas').first();
  await expect(canvas).toBeVisible();
  const bright = async () => {
    const shot = await canvas.screenshot();
    return page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 120) n++;
      return n / (d.length / 4);
    }, shot.toString('base64'));
  };
  await expect.poll(bright, { timeout: 15_000, message: 'the 2D view shows the body' }).toBeGreaterThan(0.1);
});

test('S10.6: Delete component on an out-of-date report refuses with a reason and deletes nothing', async ({ page }) => {
  const { panel } = await segmentWithStray(page);
  const sheet = await openOperation(panel, '3D QC');
  await expect(sheet.getByTestId('qc3d-row')).toHaveCount(2, { timeout: 30_000 });
  const p = await at(page, 'panel_0', -30, -30); // an edit (the Brush is still the tool)
  await page.mouse.click(p.x, p.y);
  await expect(sheet.getByTestId('qc3d-stale')).toBeVisible();
  const before = await voxels(page);
  await sheet.getByTestId('qc3d-row').nth(1).click();
  await sheet.getByRole('button', { name: 'Delete component' }).click();
  await expect(sheet).toContainText(/out of date/i);
  await page.waitForTimeout(500);
  expect(await voxels(page)).toBe(before);
});
