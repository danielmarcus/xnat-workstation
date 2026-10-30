/**
 * Interrupting a contour while it is being drawn (the bug review, T4 / T5): whatever the
 * boundary — Spline, Live Wire, Freehand — a drawing in progress must never be left live
 * behind the user's back:
 *
 *  - Escape discards it; the tool stays, and the viewport navigates again;
 *  - switching tool discards it, and the viewport navigates again;
 *  - Backspace drops a point (or is swallowed) — it never deletes the selection.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Locator, Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';
import { clickTool } from '../../helpers/toolbox';

type Hooks = {
  contourDrawing: () => boolean;
  inPlanePagePoint: (panelId: string, dx: number, dy: number) => { x: number; y: number } | null;
  viewportPlane: (panelId: string) => { axis: number; index: number } | null;
  activeSegmentVoxelCount: () => number;
  selectedIslandCount: () => number;
};
const PANEL = 'panel_0';
const h = <K extends keyof Hooks>(page: Page, k: K, ...a: Parameters<Hooks[K]>) =>
  page.evaluate(([key, args]) => ((window as unknown as { __XNAT_E2E__: Record<string, (...x: unknown[]) => unknown> }).__XNAT_E2E__[key as string])(...(args as unknown[])), [k, a] as const) as Promise<ReturnType<Hooks[K]>>;

async function pt(page: Page, dx: number, dy: number) {
  const p = await h(page, 'inPlanePagePoint', PANEL, dx, dy);
  if (!p) throw new Error('no point');
  return p;
}
const drawing = (page: Page) => h(page, 'contourDrawing');
const slice = async (page: Page) => (await h(page, 'viewportPlane', PANEL))?.index ?? -1;

async function setup(page: Page): Promise<{ panel: Locator; toolbox: Locator }> {
  await loadFixture(page, 'ct-body-512', PANEL);
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await expect(toolbox.getByRole('button', { name: 'Brush', exact: true })).toBeVisible({ timeout: 10_000 });
  return { panel, toolbox };
}

/** Start a Contour Fill boundary: three clicks (Spline, Live Wire) or a stroke held down (Freehand). */
async function startBoundary(page: Page, toolbox: Locator, boundary: 'Spline' | 'Live Wire') {
  await clickTool(toolbox, 'Contour Fill');
  await toolbox.getByRole('group', { name: 'Boundary' }).getByRole('button', { name: boundary }).click();
  for (const [dx, dy] of [[-10, -10], [10, -10], [10, 10]] as const) {
    const p = await pt(page, dx, dy);
    await page.mouse.click(p.x, p.y);
  }
  await expect.poll(() => drawing(page), { timeout: 5_000 }).toBe(true);
}

async function navigates(page: Page) {
  const before = await slice(page);
  await page.locator(`[data-testid="unified-viewport-element:${PANEL}"]`).hover();
  await page.mouse.wheel(0, 120);
  await expect.poll(() => slice(page), { timeout: 5_000 }).not.toBe(before);
}

for (const boundary of ['Spline', 'Live Wire'] as const) {
  test(`Escape discards a ${boundary} boundary being drawn; the tool stays and the viewport navigates`, async ({ page }) => {
    const { toolbox } = await setup(page);
    await startBoundary(page, toolbox, boundary);
    await page.keyboard.press('Escape');
    await expect.poll(() => drawing(page)).toBe(false);
    await expect(toolbox.getByRole('button', { name: 'Contour', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await navigates(page);
    expect(await h(page, 'activeSegmentVoxelCount')).toBe(0);
  });

  test(`switching tool discards a ${boundary} boundary being drawn; the viewport navigates`, async ({ page }) => {
    const { toolbox } = await setup(page);
    await startBoundary(page, toolbox, boundary);
    await clickTool(toolbox, 'Brush');
    await expect.poll(() => drawing(page)).toBe(false);
    await navigates(page);
  });
}

test('Backspace while drawing a Spline drops a point — it never deletes the selected island', async ({ page }) => {
  const { toolbox } = await setup(page);
  // An island of the segment, selected with the Select tool.
  await clickTool(toolbox, 'Rectangle');
  const a = await pt(page, 25, 25), b = await pt(page, 40, 40);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();
  await expect.poll(() => h(page, 'activeSegmentVoxelCount')).toBeGreaterThan(0);
  const painted = await h(page, 'activeSegmentVoxelCount');
  await clickTool(toolbox, 'Select');
  const c = await pt(page, 32, 32);
  await page.mouse.click(c.x, c.y);
  await expect.poll(() => h(page, 'selectedIslandCount'), { message: 'the island is selected — Delete WOULD erase it' }).toBe(1);
  // Draw, then Backspace.
  await startBoundary(page, toolbox, 'Spline');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);
  expect(await h(page, 'activeSegmentVoxelCount'), 'the selected island survives').toBe(painted);
  expect(await drawing(page), 'still drawing, one point fewer').toBe(true);
  await page.keyboard.press('Escape');
});
