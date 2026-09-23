/**
 * The Sculptor on a spline structure contour: it asks to convert the contour to
 * freehand, and converting it does.
 *
 * Cornerstone's SculptorTool only discovers PlanarFreehand annotations, so on a spline
 * or livewire contour it did nothing at all. The patch that fixed that lived on the
 * legacy `toolService`, whose tool group the app never creates. This drives the real
 * path: New Structure → Spline from the toolbox → click the points → Sculptor → press
 * on the contour → answer the dialog.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

type Shape = { toolName: string; polyline: string };
type Win = { __XNAT_E2E__: { getContourShapes: () => Shape[] } };

const contourShapes = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getContourShapes());
const contourToolNames = async (page: Page) => (await contourShapes(page)).map((s) => s.toolName);

async function drawSplineAndPickSculptor(page: Page) {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Structure (RTSTRUCT)' }).click();
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await expect(toolbox).toBeVisible({ timeout: 10_000 });
  await toolbox.getByRole('button', { name: 'Spline', exact: true }).click();

  const box = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const r = Math.min(box.width, box.height) * 0.25;
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * 2 * Math.PI;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });
  for (const p of pts) {
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(80);
  }
  // Clicking the first point again closes the spline.
  await page.mouse.click(pts[0].x, pts[0].y);
  await page.waitForTimeout(800);
  await expect.poll(() => contourToolNames(page)).toEqual(['SplineContourSegmentationTool']);

  await toolbox.getByRole('button', { name: 'Sculptor', exact: true }).click();
  // Press ON the contour (a control point lies on it).
  await page.mouse.move(pts[1].x, pts[1].y);
  await page.mouse.down();
  await page.mouse.up();
  return { cx, cy, pts };
}

test('sculpting a spline contour asks first, then converts it to freehand', async ({ page }) => {
  const { cx, cy, pts } = await drawSplineAndPickSculptor(page);

  const dialog = page.getByRole('button', { name: 'Convert & Sculpt' });
  await expect(dialog, 'the Sculptor should offer to convert the spline').toBeVisible({ timeout: 5_000 });
  await dialog.click();

  await expect
    .poll(() => contourToolNames(page), { timeout: 5_000 })
    .toEqual(['PlanarFreehandContourSegmentationTool']);

  // "Convert & Sculpt": the next drag from inside the contour pushes its boundary out.
  const before = (await contourShapes(page))[0].polyline;
  const start = { x: (cx + pts[1].x) / 2, y: (cy + pts[1].y) / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(pts[1].x + (pts[1].x - cx) * 0.3, pts[1].y + (pts[1].y - cy) * 0.3, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(async () => (await contourShapes(page))[0].polyline, { timeout: 5_000 })
    .not.toBe(before);
});

test('declining the conversion leaves the spline a spline', async ({ page }) => {
  await drawSplineAndPickSculptor(page);

  const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
  await expect(page.getByRole('button', { name: 'Convert & Sculpt' })).toBeVisible({ timeout: 5_000 });
  await cancel.click();

  await page.waitForTimeout(400);
  expect(await contourToolNames(page)).toEqual(['SplineContourSegmentationTool']);
});
