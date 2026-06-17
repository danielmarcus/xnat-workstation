/**
 * Bug (user-reported): existing structure contours could be grabbed and dragged even
 * while a measurement tool was in use. Root cause: every handle-based annotation tool
 * (measurement + contour-segmentation) was left in Cornerstone PASSIVE mode, and
 * Passive = existing annotations stay editable. The fix keeps idle handle tools in
 * ENABLED mode (rendered, view-only) so an annotation is only editable when its own
 * tool is active.
 *
 * The Cornerstone tool MODE is exactly what governs editability (Passive = grabbable,
 * Enabled = view-only), so asserting the mode through the real setActiveTool path
 * verifies the fix at the layer where the bug lived.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../helpers/local-fixture';

interface E2EHooks {
  setMultiviewportEnabled: (v: boolean) => void;
  setActiveUnifiedTool: (toolName: string) => void;
  getUnifiedToolMode: (csToolName: string) => string | null;
}
type Win = { __XNAT_E2E__: E2EHooks };

const mode = (page: Page, csTool: string) =>
  page.evaluate((t) => (window as unknown as Win).__XNAT_E2E__.getUnifiedToolMode(t), csTool);

test('handle-based annotations are editable only when their own tool is active', async ({ page }) => {
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setMultiviewportEnabled(true));
  await loadFixture(page, 'ct-axial-300', 'panel_0');

  // A measurement tool active → the contour-segmentation (structure) tools are view-only
  // (Enabled), NOT Passive — so structure contours can't be grabbed/dragged.
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setActiveUnifiedTool('Length'));
  await expect.poll(() => mode(page, 'Length'), { timeout: 10_000 }).toBe('Active');
  expect(await mode(page, 'PlanarFreehandContourSegmentationTool')).toBe('Enabled');
  expect(await mode(page, 'SplineContourSegmentationTool')).toBe('Enabled');

  // Switch to a structure (contour) tool → it becomes editable (Active) and the
  // measurement tool goes view-only (Enabled).
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setActiveUnifiedTool('FreehandContour'));
  await expect.poll(() => mode(page, 'PlanarFreehandContourSegmentationTool'), { timeout: 10_000 }).toBe('Active');
  expect(await mode(page, 'Length')).toBe('Enabled');
});
