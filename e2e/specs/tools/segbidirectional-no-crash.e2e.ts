/**
 * Bug (user-reported): after using the "Segment bidirectional" measure tool, the
 * brush cursor circle stopped displaying (drawing still worked).
 *
 * Root cause: Cornerstone's SegmentBidirectionalTool.renderAnnotation reads the
 * segment colour via getSegmentIndexColor and calls `.slice` on it WITHOUT a null
 * check. For our multi-layer-group SEGs the group id has no colour LUT, so the
 * colour is null and the tool throws "Cannot read properties of null (reading
 * 'slice')". That uncaught throw aborts the whole annotation render pass
 * (_renderFlaggedViewports) — which also drops the brush cursor drawn later in the
 * same pass. The annotation re-throws every frame, so the cursor stays gone.
 *
 * That diagnosis was close but not exact: the free-draw path sets NO segmentationId at
 * all, so the colour lookup receives `undefined` and would fail on a plain segmentation
 * too. The tool is only meant to be entered through its static `hydrate` with the segment
 * named — it is an action on a segment, not a drawing mode.
 *
 * The original fix was to disable the button. That has been replaced by implementing the
 * tool properly (see tools/segment-bidirectional), so this spec no longer asserts the
 * workaround. What it keeps is the REPORTED symptom, which is the thing that must never
 * come back: after using the measurement, the brush cursor still renders.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

interface E2EHooks {
  setActiveUnifiedTool: (t: string) => void;
  getActiveUnifiedTool: () => string | null;
  setUnifiedBrushSize: (n: number) => void;
}
type Win = { __XNAT_E2E__: E2EHooks };
const setTool = (page: Page, t: string) => page.evaluate((tn) => (window as unknown as Win).__XNAT_E2E__.setActiveUnifiedTool(tn), t);
const activeTool = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getActiveUnifiedTool());
const cursorCircles = (page: Page) => page.evaluate(() => document.querySelectorAll('[data-testid="unified-viewport-element:panel_0"] svg circle').length);

test('using Segment Bidirectional leaves the brush cursor working', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));

  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await panel.getByLabel('Rename container').press('Enter');
  if (await panel.getByLabel('Rename member').isVisible({ timeout: 5_000 }).catch(() => false)) await panel.getByLabel('Rename member').press('Enter');

  const toolbox = panel.locator('[data-testid="context-toolbox"]');

  // Paint a real segment blob.
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setUnifiedBrushSize(40));
  await setTool(page, 'Brush');
  const box = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx - 30, cy); await page.mouse.down();
  await page.mouse.move(cx, cy, { steps: 4 }); await page.mouse.move(cx + 30, cy, { steps: 4 }); await page.mouse.up();
  await page.waitForTimeout(300);

  // Run the measurement for real, through the toolbox button.
  await toolbox.getByRole('button', { name: 'Seg Bidir.', exact: true }).click();
  await page.waitForTimeout(2500);
  // It is an action, so the brush remains the active tool throughout.
  expect(await activeTool(page)).toBe('Brush');

  // Back to the brush: the cursor still renders and nothing threw in the render loop.
  await setTool(page, 'Brush');
  await page.mouse.move(cx - 10, cy - 10); await page.mouse.move(cx, cy, { steps: 3 });
  await page.waitForTimeout(300);

  expect(errors).toEqual([]);
  await expect.poll(() => cursorCircles(page), { timeout: 5_000 }).toBeGreaterThan(0);
});
