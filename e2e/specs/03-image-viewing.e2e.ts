/**
 * Image Viewing E2E Tests (local-fixture)
 *
 * Tests viewport interactions (scroll, W/L, pan, zoom, reset) on a
 * stack-mode viewport loaded from a local synthetic CT fixture. No
 * XNAT round-trip — keeps PHI out of failure artifacts.
 *
 * Stack-mode (multiViewport.enabled = false) is the path under test
 * here; the volume-mode equivalent lives in 07/08.
 */
import { test, expect } from '../fixtures/electron-app';
import { ViewerPage } from '../pages/viewer.page';
import { loadFixtureScan, FIXTURE_NAMES } from '../helpers/fixture-load';

test.describe('Image Viewing (local fixture)', () => {
  test.beforeEach(async ({ page }) => {
    const result = await loadFixtureScan(page, FIXTURE_NAMES.CT_AXIAL_300, {
      multiViewportEnabled: false,
    });
    test.skip(
      result === null,
      `Fixture '${FIXTURE_NAMES.CT_AXIAL_300}' is not present locally — run 'git lfs pull'.`,
    );
  });

  test('image loads in viewport', async ({ page }) => {
    const viewer = new ViewerPage(page);
    await viewer.waitForImageLoaded();

    await expect(viewer.viewportCanvas).toBeVisible();
    await expect(viewer.viewportError).toBeHidden();
  });

  test('scroll changes slice', async ({ page }) => {
    const viewer = new ViewerPage(page);
    await viewer.waitForImageLoaded();

    const initialText = await viewer.getImageIndexText();

    await viewer.canvas.scroll(300);
    await page.waitForTimeout(500);

    const afterText = await viewer.getImageIndexText();
    expect(afterText).not.toBe(initialText);
  });

  test('window/level tool changes rendering', async ({ page }) => {
    const viewer = new ViewerPage(page);
    await viewer.waitForImageLoaded();

    const initialWL = await viewer.getWindowLevelText();

    await viewer.selectWindowLevel();
    await viewer.canvas.clickDrag({ x: 0.5, y: 0.3 }, { x: 0.7, y: 0.7 });
    await page.waitForTimeout(500);

    const afterWL = await viewer.getWindowLevelText();
    expect(afterWL).not.toBe(initialWL);
  });

  test('pan tool works without error', async ({ page }) => {
    const viewer = new ViewerPage(page);
    await viewer.waitForImageLoaded();

    await viewer.selectPan();
    await viewer.canvas.clickDrag({ x: 0.3, y: 0.3 }, { x: 0.6, y: 0.6 });

    await expect(viewer.viewportError).toBeHidden();
  });

  test('zoom tool works without error', async ({ page }) => {
    const viewer = new ViewerPage(page);
    await viewer.waitForImageLoaded();

    await viewer.selectZoom();
    await viewer.canvas.clickDrag({ x: 0.5, y: 0.3 }, { x: 0.5, y: 0.6 });

    await expect(viewer.viewportError).toBeHidden();
  });

  test('reset changes viewport state back', async ({ page }) => {
    const viewer = new ViewerPage(page);
    await viewer.waitForImageLoaded();

    // Change W/L
    await viewer.selectWindowLevel();
    await viewer.canvas.clickDrag({ x: 0.5, y: 0.3 }, { x: 0.8, y: 0.8 });
    await page.waitForTimeout(300);

    const changedWL = await viewer.getWindowLevelText();

    // Reset
    await viewer.resetViewport();
    await page.waitForTimeout(300);

    const afterReset = await viewer.getWindowLevelText();

    // Reset should change the W/L values (back toward defaults)
    expect(afterReset).not.toBe(changedWL);

    // No error should occur
    await expect(viewer.viewportError).toBeHidden();
  });
});
