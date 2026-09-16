/**
 * A contour is drawn where the cursor is, in a zoomed viewport, WHILE it is being drawn.
 *
 * Reported: "when I scale one viewport and then draw annotations in it or the other
 * viewport, the annotation does appear in both but not at the right place during drawing.
 * Once complete, the contour snaps into the right location on both."
 *
 * The in-progress render and the committed render disagree, which means one of them is
 * using a transform the other is not — the committed geometry is world-space and correct,
 * so the preview is the one that is wrong. Every existing contour spec draws at the
 * default zoom, where a stale or unscaled transform is indistinguishable from a correct
 * one, so none of them can see this.
 *
 * Asserted by diffing the viewport against a pre-draw baseline: where the drawn pixels are
 * mid-drag versus after mouse-up. Comparing CENTROIDS rather than exact pixels keeps this
 * independent of stroke width, colour and anti-aliasing, all design choices that may change.
 *
 * ⚠ THESE DO NOT REPRODUCE THE REPORT. Both readings of "scale one viewport" were tried —
 * zooming the camera and resizing the viewport element — at the harness's DPR of 2, and in
 * both the in-progress contour lands exactly where the finished one does, in both
 * viewports. Screenshots of each viewport confirm it by eye. They are kept because the
 * property is worth holding and nothing else asserted it, NOT as evidence the bug is
 * fixed; it is not diagnosed. Something about the real setup differs — the tool used, how
 * the scaling is done, the layout, or a timing window a scripted drag does not hit.
 *
 * Two earlier versions of these specs were worse than useless and are worth not repeating:
 * the first screenshotted the inner canvas, which omits the SVG layer every contour is
 * drawn on; the second counted coloured pixels absolutely, which measures the viewport's
 * own chrome and returned byte-identical numbers before and after. Both "passed".
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadSameSeriesTwice } from '../../helpers/local-fixture';
import { captureViewport, changedRegion } from '../../helpers/canvas-pixels';

type Win = { __XNAT_E2E__: {
  setActiveUnifiedTool: (t: string) => void;
  zoomViewportBy: (viewportId: string, factor: number) => void;
  resetUnifiedSegmentations: () => void;
}; };

const focus = (page: Page, vp: string) =>
  page.locator(`[data-testid="unified-viewport:${vp}"]`).click({ position: { x: 20, y: 20 } });

/** Drive a loop but stop BEFORE mouse-up, so the in-progress preview is on screen. */
async function beginLoop(page: Page, viewportId: string) {
  const box = (await page.locator(`[data-testid="unified-viewport-element:${viewportId}"] canvas`).boundingBox())!;
  const cx = box.x + box.width * 0.5;
  const cy = box.y + box.height * 0.5;
  const r = Math.min(box.width, box.height) * 0.25;
  await page.mouse.move(cx + r, cy);
  await page.mouse.down();
  for (let i = 1; i <= 24; i++) {
    const a = (i / 24) * 2 * Math.PI;
    await page.mouse.move(cx + r * Math.cos(a), cy + r * Math.sin(a), { steps: 2 });
  }
  await page.mouse.move(cx + r, cy, { steps: 2 });
  await page.waitForTimeout(400);
}

test('an in-progress contour is drawn in the same place it lands, in a zoomed viewport', async ({ page }) => {
  await loadSameSeriesTwice(page, 'ct-axial-300', 'slice');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());

  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  }
  await expect(panel).toBeVisible({ timeout: 15_000 });

  // Zoom ONE viewport, so the two disagree about scale — the reported setup.
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.zoomViewportBy('panel_0', 1.8));
  await page.waitForTimeout(500);

  await focus(page, 'panel_0');
  await panel.getByRole('button', { name: 'New Structure (RTSTRUCT)' }).click();
  await panel.getByLabel('Rename container').press('Enter');
  const memberRename = panel.getByLabel('Rename member');
  if (await memberRename.count()) await memberRename.press('Enter');

  // Baseline BEFORE any stroke, so the diff isolates the contour from the viewport's own
  // coloured chrome (active border, orientation markers, scale bar, readouts).
  const base0 = await captureViewport(page, 'panel_0');
  const base1 = await captureViewport(page, 'panel_1');

  await beginLoop(page, 'panel_0');
  const duringDrawn = await changedRegion(page, base0, await captureViewport(page, 'panel_0'));
  const duringOther = await changedRegion(page, base1, await captureViewport(page, 'panel_1'));

  await page.mouse.up();
  await page.waitForTimeout(900);
  const afterDrawn = await changedRegion(page, base0, await captureViewport(page, 'panel_0'));
  const afterOther = await changedRegion(page, base1, await captureViewport(page, 'panel_1'));

  expect(duringDrawn.centroid, 'the in-progress contour must be visible while drawing').not.toBeNull();
  expect(afterDrawn.centroid, 'the finished contour must be visible').not.toBeNull();

  // Tolerance is generous: the preview and the committed contour differ in stroke weight
  // and in whether handles are shown, which moves a centroid slightly. A transform error
  // moves it far more than this.
  const TOL = 0.06;
  expect(
    Math.hypot(duringDrawn.centroid!.x - afterDrawn.centroid!.x, duringDrawn.centroid!.y - afterDrawn.centroid!.y),
    'the contour must not jump on mouse-up in the viewport being drawn in',
  ).toBeLessThan(TOL);

  if (duringOther.centroid && afterOther.centroid) {
    expect(
      Math.hypot(duringOther.centroid.x - afterOther.centroid.x, duringOther.centroid.y - afterOther.centroid.y),
      'the contour must not jump on mouse-up in the other viewport either',
    ).toBeLessThan(TOL);
  }
});

/**
 * The same question after the viewport has been RESIZED rather than zoomed.
 *
 * "Scale one viewport" has two readings and they exercise different machinery: zooming
 * changes the camera, resizing changes the canvas element. This app drives viewport layout
 * from a ResizeObserver, so a resize is the one that can leave a stale canvas size behind —
 * which would put the in-progress preview in the wrong place until the next full render
 * corrects it on mouse-up. Dragging the annotations panel's handle resizes both viewports,
 * so it is the affordance a user actually has.
 */
test('an in-progress contour is drawn in the same place it lands, after resizing the viewports', async ({ page }) => {
  await loadSameSeriesTwice(page, 'ct-axial-300', 'slice');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());

  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  }
  await expect(panel).toBeVisible({ timeout: 15_000 });

  await focus(page, 'panel_0');
  await panel.getByRole('button', { name: 'New Structure (RTSTRUCT)' }).click();
  await panel.getByLabel('Rename container').press('Enter');
  const memberRename = panel.getByLabel('Rename member');
  if (await memberRename.count()) await memberRename.press('Enter');

  // Widen the side panel, which narrows both viewports, and draw WITHOUT any other
  // interaction in between — no click, no scroll, nothing that would force a re-render.
  const root = page.locator('[data-testid="annotations-panel-root"]');
  const handle = page.locator('[data-testid="annotations-panel-resize-handle"]');
  const hb = (await handle.boundingBox())!;
  const rb = (await root.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(rb.x + rb.width - 560, hb.y + hb.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const base0 = await captureViewport(page, 'panel_0');
  const base1 = await captureViewport(page, 'panel_1');

  await beginLoop(page, 'panel_0');
  const during = await changedRegion(page, base0, await captureViewport(page, 'panel_0'));
  const duringOther = await changedRegion(page, base1, await captureViewport(page, 'panel_1'));
  await page.mouse.up();
  await page.waitForTimeout(900);
  const after = await changedRegion(page, base0, await captureViewport(page, 'panel_0'));
  const afterOther = await changedRegion(page, base1, await captureViewport(page, 'panel_1'));

  expect(during.centroid, 'the in-progress contour must be visible while drawing').not.toBeNull();
  expect(after.centroid, 'the finished contour must be visible').not.toBeNull();

  const TOL = 0.06;
  expect(
    Math.hypot(during.centroid!.x - after.centroid!.x, during.centroid!.y - after.centroid!.y),
    'the contour must not jump on mouse-up after a viewport resize',
  ).toBeLessThan(TOL);

  if (duringOther.centroid && afterOther.centroid) {
    expect(
      Math.hypot(duringOther.centroid.x - afterOther.centroid.x, duringOther.centroid.y - afterOther.centroid.y),
      'nor in the other viewport',
    ).toBeLessThan(TOL);
  }
});
