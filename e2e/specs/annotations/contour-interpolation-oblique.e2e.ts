/**
 * Signal 13 on an OBLIQUELY-acquired series, through the real UI path: panel → New
 * Structure → Freehand → two contours on non-adjacent slices → the gap fills.
 *
 * Regression guard. Cornerstone's InterpolationManager pairs a segment's contours by an
 * EXACT (`===`, component-wise) match of `metadata.viewPlaneNormal`. On axial the normal
 * is exactly [0,0,±1] so pairing always works — which is why the existing interpolation
 * specs (all on `ct-axial-300`) passed while interpolation was in fact broken for every
 * oblique series a user actually loads: there the per-slice camera normal drifts by
 * ~1e-8, defeating the `===` match, so each contour gets its own interpolationUID and NO
 * in-between contours are ever generated. installInterpolationOrientationFix() (init.ts)
 * canonicalizes the orientation of each completed contour to a coplanar sibling's so the
 * match succeeds. This spec drives the buttons on the `ct-oblique` fixture; before the
 * fix it fails with exactly the two drawn contours and an empty gap.
 */
import { test } from '../../fixtures/electron-app';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

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

test('Freehand on an oblique series interpolates between non-adjacent slices', async ({ page }) => {
  await loadFixture(page, 'ct-oblique', 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });

  await panel.getByRole('button', { name: 'New Structure (RTSTRUCT)' }).click();
  await panel.getByLabel('Rename container').press('Enter');
  await panel.getByLabel('Rename member').press('Enter');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await expect(toolbox).toBeVisible({ timeout: 10_000 });
  await toolbox.getByRole('button', { name: 'Freehand', exact: true }).click();

  const box = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;
  await drawLoop(page, box);
  const a = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getActiveContourSnapshot('panel_0'));
  expect(a.total, 'the first contour should exist on exactly one slice').toBe(1);

  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.scrollActiveViewport(3));
  await page.waitForTimeout(700);
  await drawLoop(page, box);
  const b = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getActiveContourSnapshot('panel_0'));
  expect(
    b.total,
    `two contours three slices apart on an oblique series should fill the gap, got ${b.total} on ${JSON.stringify(b.sliceIndices)}`,
  ).toBeGreaterThan(2);
});
