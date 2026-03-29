/**
 * Image Viewing E2E Tests
 *
 * Tests loading images, viewport interactions (scroll, W/L, pan, zoom, reset).
 */
import { test, expect } from '../fixtures/auth';
import { XnatBrowserPage } from '../pages/xnat-browser.page';
import { ViewerPage } from '../pages/viewer.page';
import { getE2EConfig, type E2EConfig } from '../helpers/env';

let config: E2EConfig;

test.describe('Image Viewing', () => {
  test.beforeAll(() => { config = getE2EConfig(); });

  // Load an image before each test
  test.beforeEach(async ({ authenticatedPage: page }) => {
    const browser = new XnatBrowserPage(page);

    // Navigate back to projects if needed
    const level = await browser.currentLevel();
    if (level !== 'projects') {
      await browser.navigateToProjects();
    }

    await browser.navigateAndLoadScan(
      config.testProject,
      config.testSubject,
      config.testSession,
      config.testScan,
    );
  });

  test('image loads in viewport', async ({ authenticatedPage: page }) => {
    const viewer = new ViewerPage(page);
    await viewer.waitForImageLoaded();

    await expect(viewer.viewportCanvas).toBeVisible();
    await expect(viewer.viewportError).toBeHidden();
  });

  test('scroll changes slice', async ({ authenticatedPage: page }) => {
    const viewer = new ViewerPage(page);
    await viewer.waitForImageLoaded();

    const initialText = await viewer.getImageIndexText();

    await viewer.canvas.scroll(300);
    await page.waitForTimeout(500);

    const afterText = await viewer.getImageIndexText();
    expect(afterText).not.toBe(initialText);
  });

  test('window/level tool changes rendering', async ({ authenticatedPage: page }) => {
    const viewer = new ViewerPage(page);
    await viewer.waitForImageLoaded();

    const initialWL = await viewer.getWindowLevelText();

    await viewer.selectWindowLevel();
    await viewer.canvas.clickDrag({ x: 0.5, y: 0.3 }, { x: 0.7, y: 0.7 });
    await page.waitForTimeout(500);

    const afterWL = await viewer.getWindowLevelText();
    expect(afterWL).not.toBe(initialWL);
  });

  test('pan tool works without error', async ({ authenticatedPage: page }) => {
    const viewer = new ViewerPage(page);
    await viewer.waitForImageLoaded();

    await viewer.selectPan();
    await viewer.canvas.clickDrag({ x: 0.3, y: 0.3 }, { x: 0.6, y: 0.6 });

    await expect(viewer.viewportError).toBeHidden();
  });

  test('zoom tool works without error', async ({ authenticatedPage: page }) => {
    const viewer = new ViewerPage(page);
    await viewer.waitForImageLoaded();

    await viewer.selectZoom();
    await viewer.canvas.clickDrag({ x: 0.5, y: 0.3 }, { x: 0.5, y: 0.6 });

    await expect(viewer.viewportError).toBeHidden();
  });

  test('reset changes viewport state back', async ({ authenticatedPage: page }) => {
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
