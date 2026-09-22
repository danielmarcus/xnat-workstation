/**
 * Signal 13 on an OBLIQUELY-acquired series, through the real UI path: panel → New
 * Structure → Freehand → two contours on non-adjacent slices → the gap fills AND the
 * interpolated contour actually RENDERS on the skipped slice.
 *
 * Regression guard for two bugs that only surface on oblique data (axial fixtures cannot
 * catch either, which is why the interpolation specs on `ct-axial-300` stayed green while
 * the feature was broken for real scans):
 *
 *   1. Generation. Cornerstone's InterpolationManager pairs a segment's contours by an
 *      EXACT (`===`, component-wise) match of `metadata.viewPlaneNormal`. On axial the
 *      normal is exactly [0,0,±1]; on oblique the per-slice camera normal drifts by ~1e-8,
 *      defeating the match, so each contour gets its own interpolationUID and NO in-between
 *      contours are generated. installInterpolationOrientationFix() (init.ts) fixes this.
 *
 *   2. Rendering. An interpolated contour is copied from an adjacent drawn contour and
 *      keeps that neighbour's `metadata.planeRestriction.point`; Cornerstone's per-slice
 *      display filter reads that point, so the contour is shown on the neighbour slice
 *      (hidden behind the drawn contour) and hidden on the gap slice it belongs to — the
 *      contour exists in the data but the skipped slice looks blank. acceptAnnotation now
 *      drops that stale planeRestriction (dropInterpolatedPlaneRestriction).
 *
 * The count assertion covers (1); the SVG-path assertion on the gap slice covers (2) — a
 * count-only check passed while the user saw nothing, so this asserts what actually paints.
 */
import { test } from '../../fixtures/electron-app';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

const SEL = '[data-testid="unified-viewport-element:panel_0"]';

type Win = { __XNAT_E2E__: {
  scrollActiveViewport: (d: number) => void;
  getActiveContourSnapshot: (panelId?: string, segmentationId?: string) => { total: number; sliceIndices: number[] };
}; };

async function drawLoop(page: Page, box: { x: number; y: number; width: number; height: number }) {
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const r = Math.min(box.width, box.height) * 0.3, N = 32;
  await page.mouse.move(cx + r, cy);
  await page.mouse.down();
  for (let i = 1; i <= N; i++) {
    const a = (i / N) * 2 * Math.PI;
    await page.mouse.move(cx + r * Math.cos(a), cy + r * Math.sin(a), { steps: 2 });
  }
  await page.mouse.move(cx + r, cy, { steps: 2 });
  await page.mouse.up();
  await page.waitForTimeout(1200);
}

/** Count the annotation SVG paths currently painted in the viewport overlay. */
function countRenderedPaths(page: Page): Promise<number> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? el.querySelectorAll('svg path').length : 0;
  }, SEL);
}

test('Freehand on an oblique series interpolates AND renders on the skipped slice', async ({ page }) => {
  await loadFixture(page, 'ct-oblique', 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });

  await panel.getByRole('button', { name: 'New Structure (RTSTRUCT)' }).click();
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await expect(toolbox).toBeVisible({ timeout: 10_000 });
  await toolbox.getByRole('button', { name: 'Freehand', exact: true }).click();

  const box = (await page.locator(`${SEL} canvas`).boundingBox())!;
  await drawLoop(page, box);                              // contour on slice A
  const a = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getActiveContourSnapshot('panel_0'));
  expect(a.total, 'the first contour should exist on exactly one slice').toBe(1);

  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.scrollActiveViewport(2)); // skip one slice
  await page.waitForTimeout(700);
  await drawLoop(page, box);                              // contour on slice A+2
  const b = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getActiveContourSnapshot('panel_0'));

  // (1) generation: the gap between the two drawn slices is filled with contours.
  expect(
    b.total,
    `two contours two slices apart on an oblique series should fill the gap, got ${b.total} on ${JSON.stringify(b.sliceIndices)}`,
  ).toBeGreaterThan(2);

  // (2) rendering: scroll back onto the skipped middle slice; the interpolated contour
  // must actually be painted there (one SVG path), not merely exist in the data.
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.scrollActiveViewport(-1));
  await page.waitForTimeout(700);
  const painted = await countRenderedPaths(page);
  expect(painted, 'the interpolated contour should be painted (an SVG path) on the skipped slice').toBeGreaterThan(0);
});
