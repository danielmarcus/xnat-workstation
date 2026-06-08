/**
 * P1.5 — layout presets on the unified path (offline, flag on).
 *
 * The unified grid renders one Viewport per preset panel. The `mpr-2x2` preset
 * lays out four volume viewports (axial · sagittal · coronal · axial). Because
 * every panel reformats the SAME scan, they share ONE ref-counted ImageVolume
 * (P1.1) — so an MPR-2×2 of a single CT loads the volume once, held by all four
 * panels (refCount === 4), not four independent volumes.
 *
 * (Crosshair sync + per-plane pixel content is verified later in P1.6/P1.7;
 * here we verify the layout mounts four orthographic viewports over one shared
 * volume.)
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { ensureFixture, enterLocalViewer } from '../helpers/local-fixture';

interface E2EHooks {
  setMultiviewportEnabled: (v: boolean) => void;
  setLayoutPreset: (preset: 'single' | 'mpr-2x2') => void;
  getViewportType: (panelId: string) => string | null;
  getSharedVolumeRefCount: (scanId: string, frameOfReferenceUID: string) => number;
}
type WinWithHooks = { __XNAT_E2E__: E2EHooks };

const setEnabled = (page: Page, v: boolean) =>
  page.evaluate((on) => (window as unknown as WinWithHooks).__XNAT_E2E__.setMultiviewportEnabled(on), v);
const setPreset = (page: Page, preset: 'single' | 'mpr-2x2') =>
  page.evaluate((p) => (window as unknown as WinWithHooks).__XNAT_E2E__.setLayoutPreset(p), preset);
const viewportType = (page: Page, panelId: string) =>
  page.evaluate((p) => (window as unknown as WinWithHooks).__XNAT_E2E__.getViewportType(p), panelId);
const sharedRefCount = (page: Page, scanId: string, frameOfReferenceUID: string) =>
  page.evaluate(
    ([s, f]) => (window as unknown as WinWithHooks).__XNAT_E2E__.getSharedVolumeRefCount(s, f),
    [scanId, frameOfReferenceUID] as const,
  );

const MPR_PANEL_IDS = ['panel_0', 'panel_1', 'panel_2', 'panel_3'];

test('mpr-2x2 preset renders 4 volume viewports sharing ONE volume (flag on)', async ({ page }) => {
  // Enable the unified path BEFORE the viewer mounts.
  await setEnabled(page, true);
  await enterLocalViewer(page);

  // Load the 16-slice CT through the app's real local-import path.
  const files = ensureFixture('ct-axial-300');
  await page.locator('[data-testid="local-import-input"]').setInputFiles(files);

  // Single (default) preset: one volume viewport, refCount 1.
  await expect(page.locator('[data-testid="unified-viewport-element:panel_0"] canvas'))
    .toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => sharedRefCount(page, 'local:scan', ''), {
      timeout: 20_000,
      message: 'single preset should hold the shared volume once',
    })
    .toBe(1);

  // Switch to MPR-2×2.
  await setPreset(page, 'mpr-2x2');

  // All four panels mount an orthographic (volume) viewport + canvas.
  for (const panelId of MPR_PANEL_IDS) {
    await expect(page.locator(`[data-testid="unified-viewport-element:${panelId}"] canvas`))
      .toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() => viewportType(page, panelId), {
        timeout: 20_000,
        message: `${panelId} should be a volume (orthographic) viewport`,
      })
      .toBe('orthographic');
  }

  // The four panels share ONE volume (one load, held four times) — not four volumes.
  await expect
    .poll(() => sharedRefCount(page, 'local:scan', ''), {
      timeout: 20_000,
      message: 'mpr-2x2 should hold ONE shared volume with refCount 4',
    })
    .toBe(4);
});
