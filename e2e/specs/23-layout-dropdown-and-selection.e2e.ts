/**
 * P1 regression guard — the REAL layout dropdown drives the unified grid, and
 * viewport selection works through it (offline, flag on).
 *
 * This drives the actual toolbar dropdown (NOT the setLayoutPreset e2e hook,
 * which spec 22 used and which masked the real bug): the dropdown wrote the old
 * viewerStore.layout while the unified grid read useUnifiedLayoutStore.preset, so
 * selecting "2 x 2" did nothing and you were stuck single-panel — which also made
 * viewport selection un-testable. Here we click the real dropdown, assert the
 * grid actually becomes 2x2, then click panel_1 and assert it becomes active.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { ensureFixture, enterLocalViewer } from '../helpers/local-fixture';

interface E2EHooks {
  setMultiviewportEnabled: (v: boolean) => void;
  getActiveViewportId: () => string | null;
}
type Win = { __XNAT_E2E__: E2EHooks };

const activeViewport = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getActiveViewportId());

test('the layout dropdown switches the unified grid to 2x2 and selection works (flag on)', async ({ page }) => {
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setMultiviewportEnabled(true));
  await enterLocalViewer(page);

  const files = ensureFixture('ct-axial-300');
  await page.locator('[data-testid="local-import-input"]').setInputFiles(files);

  // Single panel to start; panel_1 should not exist yet.
  await expect(page.locator('[data-testid="unified-viewport-element:panel_0"] canvas'))
    .toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-testid="unified-viewport:panel_1"]')).toHaveCount(0);

  // Drive the REAL dropdown: open the layout picker, choose "2 x 2".
  await page.locator('[title^="Viewport layout"]').click();
  await page.getByRole('button', { name: '2 x 2' }).click();

  // The unified grid must now render 4 GENERIC panels — i.e. the dropdown reached
  // the unified grid. (2×2 is an independent-panel grid, not MPR; panels 1–3 are
  // empty until a scan is loaded into them, so we assert the panel ELEMENTS, not
  // a canvas in panel_1.)
  for (const pid of ['panel_0', 'panel_1', 'panel_2', 'panel_3']) {
    await expect(page.locator(`[data-testid="unified-viewport:${pid}"]`)).toHaveCount(1, { timeout: 30_000 });
  }

  // And selection through the real layout works: click panel_1 → active.
  await expect.poll(() => activeViewport(page), { timeout: 10_000 }).toBe('panel_0');
  await page.locator('[data-testid="unified-viewport:panel_1"]').click({ position: { x: 20, y: 20 } });
  await expect.poll(() => activeViewport(page), { timeout: 10_000 }).toBe('panel_1');
  await expect(page.locator('[data-testid="unified-viewport:panel_1"]')).toHaveAttribute('data-active', 'true');
});
