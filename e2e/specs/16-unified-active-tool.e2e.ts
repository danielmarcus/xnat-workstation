/**
 * P1.7a — active-tool control on the unified tool group (offline, flag on).
 *
 * The unified tool group registers the editing tools needed for signals 1/3/6/7
 * (Length, freehand contour segmentation, Brush) alongside nav. The default
 * Primary (left-click) tool is Window/Level (the native CrosshairsTool is
 * registered but DISABLED — it crashes in single/same-plane layouts; a
 * world-point crosshair replaces it).
 * `setActiveTool` swaps only the Primary (left-click) slot: the new tool goes
 * Active(Primary) and the prior primary is demoted to Passive — the fixed nav
 * bindings (Pan=middle, Zoom=right) are untouched.
 *
 * This is the foundation P1.7b/c will draw through; here we verify the modes flip
 * correctly without disturbing navigation.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { ensureFixture, enterLocalViewer } from '../helpers/local-fixture';

interface E2EHooks {
  setMultiviewportEnabled: (v: boolean) => void;
  setActiveUnifiedTool: (toolName: string) => void;
  getActiveUnifiedTool: () => string | null;
  getUnifiedToolMode: (csToolName: string) => string | null;
}
type WinWithHooks = { __XNAT_E2E__: E2EHooks };

const setEnabled = (page: Page, v: boolean) =>
  page.evaluate((on) => (window as unknown as WinWithHooks).__XNAT_E2E__.setMultiviewportEnabled(on), v);
const setTool = (page: Page, t: string) =>
  page.evaluate((tn) => (window as unknown as WinWithHooks).__XNAT_E2E__.setActiveUnifiedTool(tn), t);
const activeTool = (page: Page) =>
  page.evaluate(() => (window as unknown as WinWithHooks).__XNAT_E2E__.getActiveUnifiedTool());
const toolMode = (page: Page, cs: string) =>
  page.evaluate((c) => (window as unknown as WinWithHooks).__XNAT_E2E__.getUnifiedToolMode(c), cs);

// Cornerstone tool names (static .toolName values).
const CS = {
  crosshairs: 'Crosshairs',
  windowLevel: 'WindowLevel',
  length: 'Length',
  contour: 'PlanarFreehandContourSegmentationTool',
  pan: 'Pan',
  zoom: 'Zoom',
};

test('unified setActiveTool swaps the Primary slot, keeping nav (flag on)', async ({ page }) => {
  await setEnabled(page, true);
  await enterLocalViewer(page);

  const files = ensureFixture('ct-axial-300');
  await page.locator('[data-testid="local-import-input"]').setInputFiles(files);

  // Group exists once panel_0 joins; Window/Level is the default Primary tool,
  // and the native CrosshairsTool is registered but DISABLED (it would crash on
  // mouse-move in a single viewport).
  await expect(page.locator('[data-testid="unified-viewport-element:panel_0"] canvas'))
    .toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => toolMode(page, CS.windowLevel), { timeout: 20_000 })
    .toBe('Active');
  expect(await toolMode(page, CS.crosshairs)).toBe('Disabled');

  // Select the freehand contour tool → it takes Primary, the prior primary
  // (Window/Level) demotes to Passive, nav tools stay Active.
  await setTool(page, 'FreehandContour');
  expect(await activeTool(page)).toBe('FreehandContour');
  await expect.poll(() => toolMode(page, CS.contour), { timeout: 10_000 }).toBe('Active');
  expect(await toolMode(page, CS.windowLevel)).toBe('Passive');
  expect(await toolMode(page, CS.pan)).toBe('Active');
  expect(await toolMode(page, CS.zoom)).toBe('Active');

  // Switch to Length → Length takes Primary, the contour tool demotes to Passive.
  await setTool(page, 'Length');
  expect(await activeTool(page)).toBe('Length');
  await expect.poll(() => toolMode(page, CS.length), { timeout: 10_000 }).toBe('Active');
  expect(await toolMode(page, CS.contour)).toBe('Passive');
});

test('the full toolbox tool set is registered + activatable on the unified group (R3.8b)', async ({ page }) => {
  await setEnabled(page, true);
  await enterLocalViewer(page);
  const files = ensureFixture('ct-axial-300');
  await page.locator('[data-testid="local-import-input"]').setInputFiles(files);
  await expect(page.locator('[data-testid="unified-viewport-element:panel_0"] canvas'))
    .toBeVisible({ timeout: 30_000 });

  // A sampling across all three kinds — each must ACTIVATE (before R3.8b these were
  // unregistered, so setActiveTool warned + left the active tool unchanged).
  for (const t of ['Eraser', 'ThresholdBrush', 'Angle', 'EllipticalROI', 'CircleScissors', 'Sculptor', 'SplineContour', 'ArrowAnnotate']) {
    await setTool(page, t);
    await expect.poll(() => activeTool(page), { timeout: 10_000, message: `${t} should activate` }).toBe(t);
  }
});
