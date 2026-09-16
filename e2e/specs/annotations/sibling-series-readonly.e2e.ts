/**
 * A container is read-only on a viewport showing a sibling series (A2b): a brush gesture
 * there adds nothing to it.
 *
 * Written against the report "I am able to draw in two viewports containing different
 * scans without switching between annotation", and it does assert that user-visible
 * property — but it is worth being precise about what it proves, because two layers
 * enforce this and only one of them is the one that looks responsible:
 *
 *  1. `attachLabelmapWithEligibility` attaches a same-FoR sibling series WITHOUT calling
 *     setActiveSegmentation, so the brush has no active segmentation to write into on
 *     that viewport. This is what actually stops the edit.
 *  2. useViewport's capture-phase pointerdown guard (evaluateDrawBlock →
 *     canDrawOnViewport) preempts the gesture and explains why in a console warning.
 *
 * Deleting layer 2 leaves this spec passing — checked, not assumed — so this is NOT a
 * test of the draw gate, and labelling it one would be false comfort. The gate's decision
 * is covered in unifiedSegEligibility.test.ts, including for containers imported from
 * XNAT, whose spatial identity used to be unresolvable.
 *
 * An earlier draft used DIFFERENT frames of reference. That was vacuous twice over: the
 * labelmap volume is not shared at all, so a stroke on the second viewport has nothing to
 * write into regardless of either layer.
 */
import { test, expect } from '../../fixtures/electron-app';
import { loadTwoSeries } from '../../helpers/local-fixture';

type Win = { __XNAT_E2E__: {
  setActiveUnifiedTool: (t: string) => void;
  setUnifiedBrushSize: (n: number) => void;
  getPaintedVoxelCount: () => number;
  resetUnifiedSegmentations: () => void;
}; };

async function strokeAcross(page: import('@playwright/test').Page, viewportId: string) {
  const box = (await page.locator(`[data-testid="unified-viewport-element:${viewportId}"] canvas`).boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.4, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(900);
}

const paintedCount = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelCount());

test('a brush gesture on a sibling-series viewport adds nothing to the container', async ({ page }) => {
  await loadTwoSeries(page, 'mr-t1-t2-sameexam', 't1-slice', 't2-slice');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());

  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  }
  await expect(panel).toBeVisible({ timeout: 15_000 });

  // Focus panel_0 and create there, so the container is native to panel_0 and there is a
  // real ACTIVE MEMBER — with no active container the guard fails open by design, for the
  // bare (Phase-1) brush flow.
  await page.locator('[data-testid="unified-viewport:panel_0"]').click({ position: { x: 20, y: 20 } });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await panel.getByLabel('Rename container').press('Enter');
  await panel.getByLabel('Rename member').press('Enter');

  await page.evaluate(() => {
    const h = (window as unknown as Win).__XNAT_E2E__;
    h.setUnifiedBrushSize(40);
    h.setActiveUnifiedTool('Brush');
  });

  await strokeAcross(page, 'panel_0');
  const afterNative = await paintedCount(page);
  expect(afterNative, 'drawing on its own viewport must paint').toBeGreaterThan(0);

  // Now the same gesture on the viewport holding the SIBLING series. The container
  // renders there (same frame of reference) but is read-only there, so nothing may be
  // added — this is the gesture the user was able to make.
  await page.locator('[data-testid="unified-viewport:panel_1"]').click({ position: { x: 20, y: 20 } });
  await strokeAcross(page, 'panel_1');
  expect(
    await paintedCount(page),
    'a gesture on a viewport showing a sibling series must paint nothing',
  ).toBe(afterNative);

  // ...and drawing still works when we come back, so the guard has not simply broken it.
  await page.locator('[data-testid="unified-viewport:panel_0"]').click({ position: { x: 20, y: 20 } });
  const box = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(900);
  expect(await paintedCount(page), 'its own viewport still accepts edits').toBeGreaterThan(afterNative);
});
