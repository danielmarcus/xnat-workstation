/**
 * P1 regression guard — click-to-select the active viewport (offline, flag on).
 *
 * The unified rewrite dropped the click→setActiveViewport wiring the deleted
 * CornerstoneViewport had, so clicking a panel never made it active (toolbar /
 * side-panel actions kept targeting panel_0). This drives the REAL affordance:
 * load a 2×2 layout, click panel_1's element, assert the store's active viewport
 * actually changed + the panel reflects data-active.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { ensureFixture, enterLocalViewer } from '../helpers/local-fixture';

interface E2EHooks {
  setLayoutPreset: (preset: 'single' | 'mpr-2x2') => void;
  getActiveViewportId: () => string | null;
}
type Win = { __XNAT_E2E__: E2EHooks };

const activeViewport = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getActiveViewportId());

test('clicking a panel makes it the active viewport (flag on)', async ({ page }) => {
  await enterLocalViewer(page);

  const files = ensureFixture('ct-axial-300');
  await page.locator('[data-testid="local-import-input"]').setInputFiles(files);

  // Go to a 2×2 layout so there are non-active panels to select.
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setLayoutPreset('mpr-2x2'));
  const panel1 = page.locator('[data-testid="unified-viewport:panel_1"]');
  await expect(panel1.locator('canvas')).toBeVisible({ timeout: 30_000 });

  // panel_0 is active by default.
  await expect.poll(() => activeViewport(page), { timeout: 10_000 }).toBe('panel_0');
  await expect(panel1).toHaveAttribute('data-active', 'false');

  // Click panel_1 → it becomes active.
  await panel1.click({ position: { x: 20, y: 20 } });

  await expect.poll(() => activeViewport(page), { timeout: 10_000 }).toBe('panel_1');
  await expect(panel1).toHaveAttribute('data-active', 'true');
});
