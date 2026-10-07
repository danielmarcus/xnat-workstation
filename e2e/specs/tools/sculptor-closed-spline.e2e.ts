/**
 * A closed spline structure contour is freehand, and the Sculptor reshapes it directly.
 *
 * On Cornerstone v5 every finished contour-segmentation stroke goes through the
 * contour union (`addContourStroke`), which recreates it as a
 * PlanarFreehandContourSegmentationTool annotation — even when there is nothing to
 * union with. So the spline is a spline only while it is being drawn. That is the
 * accepted behaviour (it replaced the 4.x "Convert & Sculpt" dialog, which could no
 * longer fire). This drives the real path: New Structure → Spline from the toolbox →
 * click the points → close → Sculptor → drag.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

type Shape = { toolName: string; polyline: string };
type Win = { __XNAT_E2E__: { getContourShapes: () => Shape[] } };

const contourShapes = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getContourShapes());
const contourToolNames = async (page: Page) => (await contourShapes(page)).map((s) => s.toolName);

test('a closed spline becomes freehand, and the Sculptor reshapes it with no dialog', async ({ page }) => {
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
  // While open it is still a spline.
  expect(await contourToolNames(page)).toEqual(['SplineContourSegmentationTool']);

  // Clicking the first point again closes it — and the union recreates it as freehand.
  await page.mouse.click(pts[0].x, pts[0].y);
  await expect
    .poll(() => contourToolNames(page), { timeout: 5_000 })
    .toEqual(['PlanarFreehandContourSegmentationTool']);

  await toolbox.getByRole('button', { name: 'Sculptor', exact: true }).click();
  const before = (await contourShapes(page))[0].polyline;
  const start = { x: (cx + pts[1].x) / 2, y: (cy + pts[1].y) / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(pts[1].x + (pts[1].x - cx) * 0.3, pts[1].y + (pts[1].y - cy) * 0.3, { steps: 12 });
  await page.mouse.up();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect
    .poll(async () => (await contourShapes(page))[0].polyline, { timeout: 5_000 })
    .not.toBe(before);
  expect(await contourToolNames(page)).toEqual(['PlanarFreehandContourSegmentationTool']);
});
