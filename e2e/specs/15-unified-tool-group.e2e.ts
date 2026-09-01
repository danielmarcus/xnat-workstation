/**
 * P1.6 — unified tool group + real CrosshairsTool (offline, flag on).
 *
 * Every unified Viewport (stack or volume) joins ONE Cornerstone tool group
 * (`xnatToolGroup_unified`) that registers the real CrosshairsTool — replacing
 * the old split (toolService primary group for stack + mprToolService group for
 * volume) and the custom crosshair geometry. In an MPR-2×2 of one shared volume
 * (P1.1/P1.5), all four panels live in that single group, so Cornerstone's
 * CrosshairsTool can draw reference lines + sync slices across them natively.
 *
 * Structural wiring is verified here (membership + tool registered); the visual
 * crosshair-sync signal (pixels across planes) is P1.7.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { ensureFixture, enterLocalViewer } from '../helpers/local-fixture';

interface E2EHooks {
  setLayoutPreset: (preset: 'single' | 'mpr-2x2') => void;
  getViewportToolGroupId: (panelId: string) => string | null;
  unifiedToolGroupHasCrosshairs: () => boolean;
  getUnifiedToolGroupViewportIds: () => string[];
}
type WinWithHooks = { __XNAT_E2E__: E2EHooks };

const UNIFIED_GROUP = 'xnatToolGroup_unified';

const setPreset = (page: Page, preset: 'single' | 'mpr-2x2') =>
  page.evaluate((p) => (window as unknown as WinWithHooks).__XNAT_E2E__.setLayoutPreset(p), preset);
const toolGroupId = (page: Page, panelId: string) =>
  page.evaluate((p) => (window as unknown as WinWithHooks).__XNAT_E2E__.getViewportToolGroupId(p), panelId);
const hasCrosshairs = (page: Page) =>
  page.evaluate(() => (window as unknown as WinWithHooks).__XNAT_E2E__.unifiedToolGroupHasCrosshairs());
const groupViewportIds = (page: Page) =>
  page.evaluate(() => (window as unknown as WinWithHooks).__XNAT_E2E__.getUnifiedToolGroupViewportIds());

const MPR_PANEL_IDS = ['panel_0', 'panel_1', 'panel_2', 'panel_3'];

test('unified viewports join one tool group with the real CrosshairsTool (flag on)', async ({ page }) => {
  await enterLocalViewer(page);

  const files = ensureFixture('ct-axial-300');
  await page.locator('[data-testid="local-import-input"]').setInputFiles(files);

  // Single preset: panel_0 joins the unified group, which has the real CrosshairsTool.
  await expect(page.locator('[data-testid="unified-viewport-element:panel_0"] canvas'))
    .toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => toolGroupId(page, 'panel_0'), {
      timeout: 20_000,
      message: 'panel_0 should belong to the unified tool group',
    })
    .toBe(UNIFIED_GROUP);
  await expect
    .poll(() => hasCrosshairs(page), {
      timeout: 10_000,
      message: 'unified tool group should register the real CrosshairsTool',
    })
    .toBe(true);

  // MPR-2×2: all four panels join the SAME unified group.
  await setPreset(page, 'mpr-2x2');
  for (const panelId of MPR_PANEL_IDS) {
    await expect(page.locator(`[data-testid="unified-viewport-element:${panelId}"] canvas`))
      .toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() => toolGroupId(page, panelId), {
        timeout: 20_000,
        message: `${panelId} should belong to the unified tool group`,
      })
      .toBe(UNIFIED_GROUP);
  }

  // The group holds exactly the four MPR panels.
  await expect
    .poll(async () => (await groupViewportIds(page)).slice().sort(), {
      timeout: 20_000,
      message: 'unified tool group should contain all four MPR panels',
    })
    .toEqual([...MPR_PANEL_IDS].sort());
});
