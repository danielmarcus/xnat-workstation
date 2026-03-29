/**
 * Annotations E2E Tests
 *
 * Tests creating, selecting, deleting, and clearing annotations
 * using measurement tools from the Measure dropdown.
 *
 * The annotation list panel is toggled with the 'O' hotkey.
 */
import { test, expect } from '../fixtures/auth';
import { XnatBrowserPage } from '../pages/xnat-browser.page';
import { ViewerPage } from '../pages/viewer.page';
import { getE2EConfig, type E2EConfig } from '../helpers/env';

let config: E2EConfig;

test.describe('Annotations', () => {
  test.beforeAll(() => { config = getE2EConfig(); });

  // Load an image before each test and ensure clean annotation state
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

    // Ensure the annotation list panel is open (toggle with 'O' hotkey)
    const annotationPanel = page.locator('[data-testid="annotation-panel"]');
    const isOpen = await annotationPanel.isVisible().catch(() => false);
    if (!isOpen) {
      await page.keyboard.press('o');
      await expect(annotationPanel).toBeVisible({ timeout: 3_000 });
    }

    // Clear any leftover annotations from previous tests
    const clearBtn = page.locator('button[title="Remove all annotations"]');
    if (await clearBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await clearBtn.click();
      await page.waitForTimeout(300);
    }
  });

  test('length measurement creates annotation', async ({ authenticatedPage: page }) => {
    const viewer = new ViewerPage(page);

    // Open the Measure dropdown and select Length
    await page.locator('button', { hasText: 'Measure' }).click();
    await page.locator('button', { hasText: 'Length' }).click();

    // Draw a line on the viewport
    await viewer.canvas.drawLine({ x: 0.3, y: 0.3 }, { x: 0.7, y: 0.7 });
    await page.waitForTimeout(1000);

    // Annotation panel should be visible and show 1 annotation
    const annotationPanel = page.locator('[data-testid="annotation-panel"]');
    await expect(annotationPanel).toBeVisible({ timeout: 5_000 });

    const count = page.locator('[data-testid="annotation-count"]');
    await expect(count).toHaveText('1');

    // The annotation list should contain a "Length" item
    await expect(annotationPanel.locator('li').first()).toContainText('Length');
  });

  test('elliptical ROI creates annotation with area', async ({ authenticatedPage: page }) => {
    const viewer = new ViewerPage(page);

    // Open Measure dropdown and select Ellipse ROI
    await page.locator('button', { hasText: 'Measure' }).click();
    await page.locator('button', { hasText: 'Ellipse ROI' }).click();

    // Draw an ellipse on the viewport
    await viewer.canvas.drawRect({ x: 0.3, y: 0.3 }, { x: 0.6, y: 0.6 });
    await page.waitForTimeout(1000);

    const annotationPanel = page.locator('[data-testid="annotation-panel"]');
    await expect(annotationPanel).toBeVisible({ timeout: 5_000 });

    const count = page.locator('[data-testid="annotation-count"]');
    await expect(count).toHaveText('1');

    await expect(annotationPanel.locator('li').first()).toContainText('Ellipse');
  });

  test('select annotation highlights it', async ({ authenticatedPage: page }) => {
    const viewer = new ViewerPage(page);

    // Create a Length annotation
    await page.locator('button', { hasText: 'Measure' }).click();
    await page.locator('button', { hasText: 'Length' }).click();
    await viewer.canvas.drawLine({ x: 0.3, y: 0.3 }, { x: 0.7, y: 0.7 });
    await page.waitForTimeout(1000);

    // Click the annotation in the list to select it
    const annotationItem = page.locator('[data-testid="annotation-panel"] li').first();
    await annotationItem.click();

    // Should have the selected style (blue background)
    await expect(annotationItem).toHaveClass(/bg-blue-900/);
  });

  test('delete annotation removes it', async ({ authenticatedPage: page }) => {
    const viewer = new ViewerPage(page);

    // Create a Length annotation
    await page.locator('button', { hasText: 'Measure' }).click();
    await page.locator('button', { hasText: 'Length' }).click();
    await viewer.canvas.drawLine({ x: 0.3, y: 0.3 }, { x: 0.7, y: 0.7 });
    await page.waitForTimeout(1000);

    // Hover over the annotation item to reveal the delete button
    const annotationItem = page.locator('[data-testid="annotation-panel"] li').first();
    await annotationItem.hover();

    // Click the delete button
    await annotationItem.locator('button[title="Delete annotation"]').click();
    await page.waitForTimeout(300);

    // Count should be 0
    const count = page.locator('[data-testid="annotation-count"]');
    await expect(count).toHaveText('0');
  });

  test('clear all removes all annotations', async ({ authenticatedPage: page }) => {
    const viewer = new ViewerPage(page);

    // Create two annotations
    await page.locator('button', { hasText: 'Measure' }).click();
    await page.locator('button', { hasText: 'Length' }).click();

    await viewer.canvas.drawLine({ x: 0.2, y: 0.2 }, { x: 0.5, y: 0.5 });
    await page.waitForTimeout(1000);
    await viewer.canvas.drawLine({ x: 0.5, y: 0.2 }, { x: 0.8, y: 0.5 });
    await page.waitForTimeout(1000);

    const count = page.locator('[data-testid="annotation-count"]');
    await expect(count).toHaveText('2');

    // Click "Clear" button
    await page.locator('button[title="Remove all annotations"]').click();
    await page.waitForTimeout(300);

    await expect(count).toHaveText('0');
  });
});
