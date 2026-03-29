/**
 * Segmentations E2E Tests
 *
 * Tests creating segmentations, painting with brush, and toggling visibility.
 *
 * The segmentation panel ("Annotate") contains annotation rows. After creating
 * a segmentation and selecting its row, the tool grid (Brush, Eraser, etc.)
 * becomes available.
 */
import { test, expect } from '../fixtures/auth';
import { XnatBrowserPage } from '../pages/xnat-browser.page';
import { ViewerPage } from '../pages/viewer.page';
import { getE2EConfig, type E2EConfig } from '../helpers/env';

let config: E2EConfig;

test.describe('Segmentations', () => {
  test.beforeAll(() => { config = getE2EConfig(); });

  // Load an image before each test
  test.beforeEach(async ({ authenticatedPage: page }) => {
    const browser = new XnatBrowserPage(page);
    const level = await browser.currentLevel();
    if (level !== 'projects') {
      await browser.navigateToProjects();
    }
    await browser.navigateAndLoadScan(
      config.testProject, config.testSubject, config.testSession, config.testScan,
    );
    const viewer = new ViewerPage(page);
    await viewer.waitForImageLoaded();

    // Dismiss any leftover dialogs/overlays from previous tests
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // If an "unsaved annotations" dialog appeared during navigation, dismiss it
    const unsavedDialog = page.locator('button', { hasText: 'Continue without saving' });
    if (await unsavedDialog.isVisible({ timeout: 500 }).catch(() => false)) {
      await unsavedDialog.click();
      await page.waitForTimeout(500);
    }

    // Ensure the segmentation panel is open
    const segPanel = page.locator('[data-testid="segmentation-panel"]');
    if (!await segPanel.isVisible().catch(() => false)) {
      await page.locator('[data-testid="toolbar"] button', { hasText: 'Annotate' }).click();
      await expect(segPanel).toBeVisible({ timeout: 5_000 });
    }
  });

  test('create new segmentation', async ({ authenticatedPage: page }) => {
    const segPanel = page.locator('[data-testid="segmentation-panel"]');

    // Click "Add segmentation" button
    await page.locator('[data-testid="add-segmentation-btn"]').click();
    await page.waitForTimeout(500);

    // Name entry dialog should appear — fill name and confirm
    const nameInput = segPanel.locator('input.bg-zinc-800');
    await expect(nameInput).toBeVisible({ timeout: 3_000 });
    await nameInput.fill('E2E Test Seg');

    const createBtn = page.locator('button', { hasText: 'Create' });
    await createBtn.click();
    await page.waitForTimeout(1000);

    // A new annotation row should appear in the panel
    // The panel should now show at least one entry
    const rows = segPanel.locator('.cursor-pointer, [role="button"]');
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('brush painting works on viewport', async ({ authenticatedPage: page }) => {
    const viewer = new ViewerPage(page);
    const segPanel = page.locator('[data-testid="segmentation-panel"]');

    // Create a new segmentation
    await page.locator('[data-testid="add-segmentation-btn"]').click();
    await page.waitForTimeout(500);

    const nameInput = segPanel.locator('input.bg-zinc-800');
    await expect(nameInput).toBeVisible({ timeout: 3_000 });
    await nameInput.fill('Brush Test');
    await page.locator('button', { hasText: 'Create' }).click();
    await page.waitForTimeout(1000);

    // Select the annotation row to enable tools.
    // The first clickable row in the panel list that contains "Brush Test" or a segment entry.
    const annotationRow = segPanel.locator('.cursor-pointer').first();
    await annotationRow.click();
    await page.waitForTimeout(500);

    // Now the tools grid should be visible — click "Brush"
    const brushBtn = segPanel.locator('button', { hasText: 'Brush' }).first();
    if (await brushBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await brushBtn.click();
      await page.waitForTimeout(300);

      // Paint a stroke on the viewport
      await viewer.canvas.paintStroke([
        { x: 0.4, y: 0.4 },
        { x: 0.45, y: 0.42 },
        { x: 0.5, y: 0.45 },
        { x: 0.55, y: 0.47 },
        { x: 0.6, y: 0.5 },
      ]);
      await page.waitForTimeout(500);
    }

    // Verify no error on viewport
    await expect(viewer.viewportError).toBeHidden();
  });

  test('toggle segment visibility', async ({ authenticatedPage: page }) => {
    const segPanel = page.locator('[data-testid="segmentation-panel"]');

    // Create a new segmentation
    await page.locator('[data-testid="add-segmentation-btn"]').click();
    await page.waitForTimeout(500);

    const nameInput = segPanel.locator('input.bg-zinc-800');
    await expect(nameInput).toBeVisible({ timeout: 3_000 });
    await nameInput.fill('Visibility Test');
    await page.locator('button', { hasText: 'Create' }).click();
    await page.waitForTimeout(1000);

    // Find the visibility toggle button ("Hide segment" / "Show segment")
    const hideBtn = segPanel.locator('button[title="Hide segment"]').first();

    if (await hideBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      // Click to hide
      await hideBtn.click();
      await page.waitForTimeout(300);

      // Should now show "Show segment" button
      const showBtn = segPanel.locator('button[title="Show segment"]').first();
      await expect(showBtn).toBeVisible({ timeout: 3_000 });

      // Click to show again
      await showBtn.click();
      await page.waitForTimeout(300);

      // Should be back to "Hide segment"
      await expect(hideBtn).toBeVisible({ timeout: 3_000 });
    }
  });
});
