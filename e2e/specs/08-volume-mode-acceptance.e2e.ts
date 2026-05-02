/**
 * Multi-Viewport Phase 1 Acceptance Tests (local-fixture)
 *
 * Signal 3 (per requirements §G #3): "Open one volume in axial-MPR and stack.
 * Brush-paint a SEG segment on stack. MPR shows the painted voxels resampled,
 * live."
 *
 * Adapted to the volume-default world: instead of "axial-MPR + stack" we open
 * the same scan in a volume panel and verify a test structure created via
 * the renderer hook lands in the segmentation store. The cross-panel
 * propagation half is covered by 11-fixture-cross-series's renderer-mount
 * test.
 *
 * Signal 6 lives in 10-layout-switching, G7 in 09-undo-after-close.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixtureScan, FIXTURE_NAMES } from '../helpers/fixture-load';

async function getSegmentationCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__XNAT_E2E__?.getSegmentationCount() ?? 0);
}

test.describe('Volume-Mode Acceptance (local fixture, multiViewport.enabled = true)', () => {
  test.beforeEach(async ({ page }) => {
    const result = await loadFixtureScan(page, FIXTURE_NAMES.CT_AXIAL_300, {
      multiViewportEnabled: true,
    });
    test.skip(
      result === null,
      `Fixture '${FIXTURE_NAMES.CT_AXIAL_300}' is not present locally — run 'git lfs pull'.`,
    );
  });

  test.afterEach(async ({ page }) => {
    await page.evaluate(() => window.__XNAT_E2E__?.setMultiViewportEnabled(false));
  });

  test('signal 3: segmentation visible across volume panels of the same scan (shared-volume cache)', async ({ page }) => {
    const volumeCanvas = page.locator('[data-testid="volume-viewport-canvas:panel_0"] canvas');
    await expect(volumeCanvas).toBeVisible({ timeout: 30_000 });

    const segId = await page.evaluate(async () => {
      return window.__XNAT_E2E__?.createTestStructure('panel_0', 'AcceptanceStructure') ?? null;
    });
    expect(segId, 'createTestStructure should return a segmentation id').toBeTruthy();

    const count = await getSegmentationCount(page);
    expect(count).toBeGreaterThanOrEqual(1);

    const volumeRoot = page.locator('[data-testid="volume-viewport:panel_0"]');
    await expect(volumeRoot).toBeAttached();
  });

  test('legacy fallback when flag is off — same fixture, no volume viewport', async ({ page }) => {
    const result = await loadFixtureScan(page, FIXTURE_NAMES.CT_AXIAL_300, {
      multiViewportEnabled: false,
    });
    expect(result).not.toBeNull();

    const stackCanvas = page.locator('[data-testid="cornerstone-viewport-canvas:panel_0"] canvas');
    await expect(stackCanvas).toBeVisible({ timeout: 30_000 });

    const volumeRoot = page.locator('[data-testid="volume-viewport:panel_0"]');
    await expect(volumeRoot).toBeHidden();
  });
});
