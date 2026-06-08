/**
 * P1.9 / B2 — generic grid layouts render the right panel count, and each panel
 * holds an INDEPENDENT scan (multi-scan), via the real toolbar dropdown (flag on).
 *
 * Before this, only single + 2×2 (mapped to MPR) reached the unified grid; the
 * other layouts collapsed to a single panel (spec I2 says "preserve"). Now the
 * Layout dropdown drives a generic rows×cols grid of independent panels. Drives
 * the REAL dropdown + the REAL import (which targets the active panel).
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { ensureFixture, enterLocalViewer } from '../helpers/local-fixture';

interface E2EHooks { setMultiviewportEnabled: (v: boolean) => void; }
type Win = { __XNAT_E2E__: E2EHooks };

const chooseLayout = async (page: Page, name: string) => {
  await page.locator('[title^="Viewport layout"]').click();
  await page.getByRole('button', { name }).click();
};
const panel = (page: Page, pid: string) => page.locator(`[data-testid="unified-viewport:${pid}"]`);

test('layout dropdown drives generic grids + each panel holds its own scan (flag on)', async ({ page }) => {
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setMultiviewportEnabled(true));
  await enterLocalViewer(page);
  const files = ensureFixture('ct-axial-300');
  await page.locator('[data-testid="local-import-input"]').setInputFiles(files);
  await expect(panel(page, 'panel_0').locator('canvas')).toBeVisible({ timeout: 30_000 });

  // 1×2 → exactly 2 panels (was: collapsed to 1).
  await chooseLayout(page, '1 x 2');
  await expect(panel(page, 'panel_1')).toHaveCount(1, { timeout: 20_000 });
  await expect(panel(page, 'panel_2')).toHaveCount(0);

  // 2×2 → 4 panels.
  await chooseLayout(page, '2 x 2');
  for (const pid of ['panel_0', 'panel_1', 'panel_2', 'panel_3']) {
    await expect(panel(page, pid)).toHaveCount(1, { timeout: 20_000 });
  }

  // Multi-scan: panel_0 already has scan A; select panel_1 and load a DIFFERENT
  // scan into IT (import targets the active panel) → two panels, each with its own
  // canvas (independent — not a shared MPR volume). A different fixture is used so
  // the file <input> change actually fires (re-setting identical files is a no-op).
  await expect(panel(page, 'panel_0').locator('canvas')).toBeVisible();
  await panel(page, 'panel_1').click({ position: { x: 20, y: 20 } });
  const filesB = ensureFixture('ct-axial-anatomy');
  await page.locator('[data-testid="local-import-input"]').setInputFiles(filesB);
  await expect(panel(page, 'panel_1').locator('canvas')).toBeVisible({ timeout: 30_000 });
  await expect(panel(page, 'panel_0').locator('canvas')).toBeVisible();

  // Back to 1×1 → single panel.
  await chooseLayout(page, '1 x 1');
  await expect(panel(page, 'panel_1')).toHaveCount(0, { timeout: 20_000 });
});
