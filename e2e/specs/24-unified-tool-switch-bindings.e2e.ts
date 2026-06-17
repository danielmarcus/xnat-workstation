/**
 * P1 regression guard — switching the Primary tool leaves EXACTLY ONE tool on
 * the left button (offline, flag on).
 *
 * Bug: Pan/Zoom weren't demoted when switching away (they weren't in
 * PRIMARY_CAPABLE), so their Primary binding stuck and accumulated — selecting
 * Pan then Zoom left BOTH on left-click, so Zoom never took. This drives the
 * real toolbar buttons and asserts the binding invariant after each switch.
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

test('switching tools keeps exactly one tool on the Primary button (Pan -> Zoom) (flag on)', async ({ page }) => {
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setMultiviewportEnabled(true));
  await enterLocalViewer(page);

  const files = ensureFixture('ct-axial-300');
  await page.locator('[data-testid="local-import-input"]').setInputFiles(files);
  await expect(page.locator('[data-testid="unified-viewport-element:panel_0"] canvas'))
    .toBeVisible({ timeout: 30_000 });

  // Default: Window/Level holds the Primary button.
  await expect.poll(() => primaryTools(page), { timeout: 10_000 }).toEqual(['WindowLevel']);

  // Click the real Pan button → only Pan on Primary. (Locate by the button's
  // title — the visible label is the short "Pan", whose accessible name also
  // matches the "Show segmentation panel" toggle.)
  await page.locator('button[title="Pan (left-click drag)"]').click();
  await expect.poll(() => primaryTools(page), { timeout: 10_000 }).toEqual(['Pan']);

  // Click the real Zoom button → only Zoom on Primary (the bug left BOTH here).
  await page.locator('button[title="Zoom (left-click drag)"]').click();
  await expect.poll(() => primaryTools(page), { timeout: 10_000 }).toEqual(['Zoom']);

  // Back to W/L → only W/L. (By title — the short "W/L" label also appears on the
  // W/L-presets button.)
  await page.locator('button[title="Window/Level (left-click drag)"]').click();
  await expect.poll(() => primaryTools(page), { timeout: 10_000 }).toEqual(['WindowLevel']);
});
