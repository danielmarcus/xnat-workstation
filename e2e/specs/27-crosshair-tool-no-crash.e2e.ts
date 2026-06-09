/**
 * P1.9 / B3 — the Crosshairs tool routes to Window/Level on the Cornerstone slot
 * and does NOT crash on mouse-move in a single viewport (offline, flag on).
 *
 * Regression guard for the original P1 crash: the default tool was the native
 * CrosshairsTool, whose mouseMoveCallback threw with < 2 non-parallel planes — so
 * moving the mouse in a single viewport crashed the renderer. The world-point
 * crosshair replaces it: ToolName.Crosshairs maps to W/L on the Cornerstone Primary
 * slot (native crosshairs stays disabled), and a left CLICK sets a shared world
 * point via our own handler. This drives the REAL toolbar button + the crash
 * gesture and asserts the app survives.
 *
 * NOTE: the click-to-set world point + reticle pixel-position are DPR-sensitive
 * (canvasToWorld) and unreliable headless — verified by unit tests
 * (unifiedCrosshair.test / ViewportReticle.test) + on real data, not here.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { ensureFixture, enterLocalViewer } from '../helpers/local-fixture';

interface E2EHooks {
  setMultiviewportEnabled: (v: boolean) => void;
  getUnifiedToolsWithPrimary: () => string[];
}
type Win = { __XNAT_E2E__: E2EHooks };

const primaryTools = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getUnifiedToolsWithPrimary());

test('Crosshairs tool routes to W/L and survives mouse-move in a single viewport (flag on)', async ({ page }) => {
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setMultiviewportEnabled(true));
  await enterLocalViewer(page);

  const files = ensureFixture('ct-axial-300');
  await page.locator('[data-testid="local-import-input"]').setInputFiles(files);
  const canvas = page.locator('[data-testid="unified-viewport-element:panel_0"] canvas');
  await expect(canvas).toBeVisible({ timeout: 30_000 });

  // Select a different primary first, then the real "Cross" button. Selecting
  // Crosshairs must land the Cornerstone Primary slot on Window/Level (NOT the
  // native CrosshairsTool), so a drag still does W/L.
  await page.getByRole('button', { name: 'Pan' }).click();
  await expect.poll(() => primaryTools(page), { timeout: 10_000 }).toEqual(['Pan']);
  await page.getByRole('button', { name: 'Cross' }).click();
  await expect.poll(() => primaryTools(page), { timeout: 10_000 }).toEqual(['WindowLevel']);

  // The crash gesture: hover + press + move + release over the viewport. The native
  // CrosshairsTool used to throw here in a single viewport.
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no viewport bounding box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 12, cy + 12);
  await page.mouse.up();
  // A short hover-move with no button (pure mouseMove — the exact crash path).
  await page.mouse.move(cx + 30, cy - 20);
  await page.mouse.move(cx - 25, cy + 15);

  // No crash: the viewport canvas is still alive and the Primary slot is unchanged.
  await expect(canvas).toBeVisible();
  await expect.poll(() => primaryTools(page), { timeout: 10_000 }).toEqual(['WindowLevel']);
});
