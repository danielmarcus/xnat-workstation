/**
 * Two user-reported bugs:
 *  (a) Deleting a measurement removed its row but left it DRAWN on the viewport —
 *      annotationService.removeAnnotation mutated state but never repainted, so the
 *      SVG overlay lingered. The fix repaints; this asserts the SVG element is gone.
 *  (b) The "+" (Add member) on a Measurement container was confusing and did nothing
 *      useful — it's removed for SR (measurements are authored by drawing).
 *
 * Real display surface: Cornerstone draws annotations into the viewport's `.svg-layer`
 * tagged `data-annotation-uid`. Delete must remove them from there, not just the panel.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../helpers/local-fixture';

interface E2EHooks {
  setMultiviewportEnabled: (v: boolean) => void;
  setActiveUnifiedTool: (toolName: string) => void;
  getMeasurementCount: () => number;
  clearAllContainers: () => void;
}
type Win = { __XNAT_E2E__: E2EHooks };

const cleanSlate = async (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers());
test.beforeEach(({ page }) => cleanSlate(page));
test.afterEach(({ page }) => cleanSlate(page));

const svgAnnotations = (page: Page) =>
  page.locator('[data-testid="unified-viewport-element:panel_0"] .svg-layer [data-annotation-uid]');

test('deleting a measurement removes it from the viewport display, and SR containers have no "+"', async ({ page }) => {
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setMultiviewportEnabled(true));
  await loadFixture(page, 'ct-axial-300', 'panel_0');

  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  }
  await expect(panel).toBeVisible({ timeout: 15_000 });

  // Draw a Length → it's painted on the viewport SVG layer.
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setActiveUnifiedTool('Length'));
  const canvas = page.locator('[data-testid="unified-viewport-element:panel_0"] canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const cy = box!.y + box!.height / 2;
  await page.mouse.move(box!.x + box!.width * 0.35, cy);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.65, cy, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getMeasurementCount()), { timeout: 15_000 })
    .toBe(1);
  await expect(svgAnnotations(page).first()).toBeVisible({ timeout: 10_000 });

  // (b) The Measurement container row has NO "+" Add-member button.
  const srRow = panel.locator('[data-testid^="container-row-sr:"]');
  await expect(srRow).toBeVisible();
  await expect(srRow.getByLabel('Add member')).toHaveCount(0);

  // (a) Delete the measurement via the real row control → it leaves the SVG display.
  await panel.locator('[data-testid^="member-row-"]').first().getByLabel('Delete member').click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getMeasurementCount()), { timeout: 10_000 })
    .toBe(0);
  await expect(svgAnnotations(page)).toHaveCount(0, { timeout: 10_000 });
});
