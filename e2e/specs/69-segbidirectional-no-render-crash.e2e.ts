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
 * Fix: the tool is incompatible with the group SEG model, so it's not activatable
 * on the unified path (removed from UNIFIED_TOOL_MAP) and shown disabled in the
 * toolbox — it can no longer create the crashing annotation.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../helpers/local-fixture';

interface E2EHooks {
  setActiveUnifiedTool: (t: string) => void;
  getActiveUnifiedTool: () => string | null;
  setUnifiedBrushSize: (n: number) => void;
}
type Win = { __XNAT_E2E__: E2EHooks };
const setTool = (page: Page, t: string) => page.evaluate((tn) => (window as unknown as Win).__XNAT_E2E__.setActiveUnifiedTool(tn), t);
const activeTool = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getActiveUnifiedTool());
const cursorCircles = (page: Page) => page.evaluate(() => document.querySelectorAll('[data-testid="unified-viewport-element:panel_0"] svg circle').length);

test('SegmentBidirectional is not activatable and never crashes the brush cursor', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));

  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await panel.getByLabel('Rename container').press('Enter');
  if (await panel.getByLabel('Rename member').isVisible({ timeout: 5_000 }).catch(() => false)) await panel.getByLabel('Rename member').press('Enter');

  // The toolbox shows "Bidir." but disabled (it crashes with group SEGs).
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await expect(toolbox.getByRole('button', { name: 'Bidir.' })).toBeDisabled();

  // Paint a real segment blob.
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setUnifiedBrushSize(40));
  await setTool(page, 'Brush');
  const box = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx - 30, cy); await page.mouse.down();
  await page.mouse.move(cx, cy, { steps: 4 }); await page.mouse.move(cx + 30, cy, { steps: 4 }); await page.mouse.up();
  await page.waitForTimeout(300);

  // Attempting to activate SegmentBidirectional is a no-op (not on the unified path),
  // so no crashing annotation is ever created.
  await setTool(page, 'SegmentBidirectional');
  expect(await activeTool(page)).not.toBe('SegmentBidirectional');
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(400);

  // Back to the brush: the cursor still renders and nothing threw in the render loop.
  await setTool(page, 'Brush');
  await page.mouse.move(cx - 10, cy - 10); await page.mouse.move(cx, cy, { steps: 3 });
  await page.waitForTimeout(300);

  expect(errors).toEqual([]);
  await expect.poll(() => cursorCircles(page), { timeout: 5_000 }).toBeGreaterThan(0);
});
