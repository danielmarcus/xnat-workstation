/**
 * 3D QC (SegWorks parity branch 7, D9) on the anatomy phantom: Process › 3D QC switches to
 * the “2D + 3D QC” layout, builds a surface per component and reports them; the user's
 * layout comes back when the sheet closes. Every step is a real click or drag.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Locator, Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';
import { clickTool } from '../../helpers/toolbox';

type Win = {
  __XNAT_E2E__: {
    clearAllContainers: () => void;
    memberVoxelCount: (i: number) => number;
    getPanelFocalPoint: (panelId: string) => [number, number, number] | null;
    worldToPanelPagePoint: (panelId: string, world: [number, number, number]) => { x: number; y: number } | null;
    qc3dComponents: () => Array<{ segmentIndex: number; componentId: number; visible: boolean; triangles: number; vertices: number; checksum: number }>;
    getPanelFocalPoint3d?: never;
    getPanelParallelScale: (panelId: string) => number | null;
  };
};
const hooks = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.qc3dComponents());
const voxels = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.memberVoxelCount(1));
const VIEW_3D = '[data-testid="unified-viewport-element:panel_qc3d"]';

async function at(page: Page, dx: number, dy: number) {
  return page.evaluate(([dx, dy]) => {
    const h = (window as unknown as Win).__XNAT_E2E__;
    const f = h.getPanelFocalPoint('panel_0')!;
    return h.worldToPanelPagePoint('panel_0', [f[0] + dx, f[1] + dy, f[2]])!;
  }, [dx, dy] as const);
}

/**
 * Coloured pixels in the 3D view — the surfaces. The overlay text drawn over the canvas is
 * white/grey, so saturation (max − min channel) separates the two.
 */
async function litPixels(page: Page): Promise<number> {
  return (await pixelStats(page)).lit;
}

async function pixelStats(page: Page): Promise<{ lit: number; sum: number; amber: number }> {
  const shot = await page.locator(`${VIEW_3D} canvas`).first().screenshot();
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let lit = 0, sum = 0, amber = 0;
    for (let i = 0; i < d.length; i += 4) {
      const t = d[i] + d[i + 1] + d[i + 2];
      const sat = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
      if (sat <= 40) continue;
      lit++;
      sum += t;
      if (d[i] > 150 && d[i + 1] > 100 && d[i + 2] < 90) amber++;
    }
    return { lit, sum, amber };
  }, shot.toString('base64'));
}

test.beforeEach(({ page }) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers()));

/** A segment with the lesion (Level Trace) and a small separate dab (Brush) — main + stray. */
async function segmentWithStray(page: Page): Promise<{ panel: Locator; toolbox: Locator }> {
  await loadFixture(page, 'ct-axial-anatomy', 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await clickTool(toolbox, 'Level Trace');
  await toolbox.getByRole('group', { name: 'Band' }).getByRole('button', { name: 'CT (HU)' }).click();
  await toolbox.getByRole('slider', { name: 'HU tolerance' }).fill('20');
  const p = await at(page, 25, 0);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId('mask-preview-bar')).toContainText('Level Trace');
  await page.keyboard.press('Enter');
  await expect.poll(() => voxels(page)).toBeGreaterThan(150);
  const lesion = await voxels(page);
  await clickTool(toolbox, 'Brush');
  const q = await at(page, -30, -30);
  await page.mouse.click(q.x, q.y);
  await expect.poll(() => voxels(page)).toBeGreaterThan(lesion);
  return { panel, toolbox };
}

async function openQc(toolbox: Locator, panel: Locator): Promise<Locator> {
  await toolbox.getByRole('tab', { name: 'Process' }).click();
  await toolbox.getByRole('button', { name: '3D QC', exact: true }).click();
  const sheet = panel.getByTestId('qc3d-sheet');
  await expect(sheet).toBeVisible();
  return sheet;
}

test('3D QC: the 2D + 3D layout opens, surfaces are built and reported, and the layout comes back', async ({ page }) => {
  const { panel, toolbox } = await segmentWithStray(page);
  const sheet = await openQc(toolbox, panel);
  await expect(page.locator(VIEW_3D)).toBeVisible();
  await expect.poll(async () => (await hooks(page)).length, { timeout: 30_000 }).toBe(2);
  await expect(sheet.getByTestId('qc3d-row')).toHaveCount(2);
  await expect(sheet.getByTestId('qc3d-row').first()).toHaveAttribute('data-band', 'main');
  await expect(sheet.getByTestId('qc3d-row').nth(1)).toHaveAttribute('data-band', 'stray');
  await expect.poll(() => litPixels(page), { timeout: 10_000 }).toBeGreaterThan(200);
  if (process.env.QC_SHOT) await page.locator('[data-testid="unified-viewport-grid"]').screenshot({ path: process.env.QC_SHOT });

  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator(VIEW_3D)).toHaveCount(0);
  await expect(page.locator('[data-testid="unified-viewport-element:panel_0"]')).toBeVisible();
});

async function builtQc(page: Page, n = 2) {
  const { panel, toolbox } = await segmentWithStray(page);
  const sheet = await openQc(toolbox, panel);
  await expect.poll(async () => (await hooks(page)).length, { timeout: 30_000 }).toBe(n);
  await expect.poll(() => litPixels(page), { timeout: 10_000 }).toBeGreaterThan(200);
  return { panel, toolbox, sheet };
}

test('3D QC display: hide largest, label visibility, stray highlight and brightness change the 3D view', async ({ page }) => {
  const { sheet } = await builtQc(page);
  const all = await pixelStats(page);
  expect(all.amber, 'the stray is highlighted').toBeGreaterThan(20);

  await sheet.getByRole('checkbox', { name: 'Hide largest' }).check();
  await expect.poll(async () => (await hooks(page)).filter((c) => c.visible).length).toBe(1);
  await expect.poll(async () => (await pixelStats(page)).lit).toBeLessThan(all.lit);
  await sheet.getByRole('checkbox', { name: 'Hide largest' }).uncheck();

  await sheet.getByRole('checkbox', { name: 'Highlight strays' }).uncheck();
  await expect.poll(async () => (await pixelStats(page)).amber).toBeLessThan(5);
  await sheet.getByRole('checkbox', { name: 'Highlight strays' }).check();

  await sheet.getByRole('button', { name: 'Hide all' }).click();
  await expect.poll(async () => (await hooks(page)).filter((c) => c.visible).length).toBe(0);
  await expect.poll(() => litPixels(page)).toBeLessThan(20);
  await sheet.getByTestId('qc3d-label').first().getByRole('checkbox').check();
  await expect.poll(async () => (await hooks(page)).filter((c) => c.visible).length).toBe(2);

  const bright = (await pixelStats(page)).sum;
  await sheet.getByRole('slider', { name: 'Brightness' }).fill('0.2');
  await expect.poll(async () => (await pixelStats(page)).sum).toBeLessThan(bright * 0.8);
});

test('3D QC: an edit marks the surfaces out of date; Rebuild brings in the new component', async ({ page }) => {
  const { toolbox, sheet } = await builtQc(page);
  await expect(sheet.getByTestId('qc3d-stale')).toHaveCount(0);
  // Paint another separate dab on the 2D slice (the Brush is still the active tool).
  const p = await at(page, -30, 30);
  await page.mouse.click(p.x, p.y);
  await expect(sheet.getByTestId('qc3d-stale')).toBeVisible();
  expect(await hooks(page)).toHaveLength(2);
  await sheet.getByRole('button', { name: 'Rebuild' }).click();
  await expect.poll(async () => (await hooks(page)).length, { timeout: 30_000 }).toBe(3);
  await expect(sheet.getByTestId('qc3d-stale')).toHaveCount(0);
  await expect(sheet.getByTestId('qc3d-row')).toHaveCount(3);
  void toolbox;
});

test('3D QC: a build setting rebuilds — Voxels gives the blocky surface', async ({ page }) => {
  const { sheet } = await builtQc(page);
  // Surface Nets is dual to the voxel faces (one quad per face, and for a one-slice region
  // as many vertices as face corners), so compare where the vertices are.
  const smooth = (await hooks(page))[0].checksum;
  await sheet.getByRole('group', { name: 'Renderer' }).getByRole('button', { name: 'Voxels' }).click();
  await expect.poll(async () => (await hooks(page))[0]?.checksum, { timeout: 30_000 }).not.toBe(smooth);
});

test('3D QC view: wheel zooms, ⇧-drag pans, auto-rotate turns the camera', async ({ page }) => {
  await builtQc(page);
  const view = page.locator(VIEW_3D);
  const box = (await view.boundingBox())!;
  const scale = () => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPanelParallelScale('panel_qc3d'));
  const focal = () => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPanelFocalPoint('panel_qc3d'));
  const s0 = await scale();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -300);
  await expect.poll(scale).not.toBe(s0);

  const f0 = await focal();
  await page.keyboard.down('Shift');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect.poll(focal).not.toEqual(f0);

  const sheet = page.getByTestId('qc3d-sheet');
  const before = await pixelStats(page);
  await sheet.getByRole('checkbox', { name: 'Auto-rotate' }).check();
  await page.waitForTimeout(800);
  const turning = await pixelStats(page);
  expect(turning.sum).not.toBe(before.sum);
  await sheet.getByRole('checkbox', { name: 'Auto-rotate' }).uncheck();
  await page.waitForTimeout(200);
  const a = (await pixelStats(page)).sum;
  await page.waitForTimeout(400);
  expect((await pixelStats(page)).sum, 'stopped').toBe(a);
});

test('3D QC view: Reset view undoes a zoom; Expand 3D fills the viewport area and Shrink returns it', async ({ page }) => {
  const { sheet } = await builtQc(page);
  const view = page.locator(VIEW_3D);
  const scale = () => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPanelParallelScale('panel_qc3d'));
  const s0 = await scale();
  const box = (await view.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -300);
  await expect.poll(scale).not.toBe(s0);
  await sheet.getByRole('button', { name: 'Reset view' }).click();
  await expect.poll(async () => Math.abs((await scale())! - s0!)).toBeLessThan(0.01);

  const grid = (await page.locator('[data-testid="unified-viewport-grid"]').boundingBox())!;
  await sheet.getByRole('button', { name: 'Expand 3D' }).click();
  await expect.poll(async () => (await view.boundingBox())!.width).toBeGreaterThan(grid.width * 0.95);
  await expect(page.locator('[data-testid="unified-viewport-element:panel_0"]')).toHaveCount(1); // still mounted
  await expect.poll(() => litPixels(page)).toBeGreaterThan(200);
  await sheet.getByRole('button', { name: 'Shrink 3D' }).click();
  await expect.poll(async () => (await view.boundingBox())!.width).toBeLessThan(grid.width * 0.6);
});
