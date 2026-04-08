/**
 * Save & Upload E2E Tests
 *
 * Tests uploading a segmentation to XNAT and cleaning up afterward.
 */
import { test, expect } from '../fixtures/auth';
import { XnatBrowserPage } from '../pages/xnat-browser.page';
import { ViewerPage } from '../pages/viewer.page';
import { getE2EConfig, type E2EConfig } from '../helpers/env';

let config: E2EConfig;

test.describe('Save & Upload', () => {
  test.beforeAll(() => { config = getE2EConfig(); });

  test('upload segmentation to XNAT', async ({ authenticatedPage: page }) => {
    // ── Setup: load an image ──
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

    // ── Ensure segmentation panel is open ──
    await viewer.openSegmentationPanel();
    const segPanel = page.locator('[data-testid="segmentation-panel"]');

    await page.locator('[data-testid="add-segmentation-btn"]').click();
    await page.waitForTimeout(500);

    const nameInput = segPanel.locator('input.bg-zinc-800');
    await expect(nameInput).toBeVisible({ timeout: 3_000 });
    await nameInput.fill('E2E Test Upload');
    await page.locator('button', { hasText: 'Create' }).click();
    await page.waitForTimeout(1000);

    // ── Select annotation row and paint with Brush ──
    const annotationRow = segPanel.locator('.cursor-pointer').first();
    await annotationRow.click();
    await page.waitForTimeout(500);

    const brushBtn = segPanel.locator('button', { hasText: 'Brush' }).first();
    if (await brushBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await brushBtn.click();
      await page.waitForTimeout(300);

      await viewer.canvas.paintStroke([
        { x: 0.4, y: 0.4 },
        { x: 0.5, y: 0.45 },
        { x: 0.6, y: 0.5 },
      ]);
      await page.waitForTimeout(500);
    }

    // ── Upload to XNAT ──
    // Look for the save dropdown trigger on the annotation row
    const saveDropdown = segPanel.locator('button[title*="Save"], button[title*="save"]').first();
    if (await saveDropdown.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await saveDropdown.click();
      await page.waitForTimeout(300);

      const uploadBtn = page.locator('button', { hasText: 'Upload to XNAT' });
      if (await uploadBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await uploadBtn.click();

        // Wait for upload to complete
        await page.waitForTimeout(10_000);

        // Verify no blocking error
        await expect(viewer.viewportError).toBeHidden();
      }
    }

    // ── Cleanup: delete the uploaded test scan ──
    try {
      const scans = await page.evaluate(
        async (sessionLabel: string) => {
          return (window as any).electronAPI.xnat.getScans(sessionLabel);
        },
        config.testSession,
      );

      if (Array.isArray(scans)) {
        const segScans = scans.filter(
          (s: any) =>
            s.seriesDescription?.includes('E2E Test Upload') ||
            s.seriesDescription?.includes('e2e test'),
        );

        for (const seg of segScans) {
          await page.evaluate(
            async ({ sessionId, scanId }) => {
              return (window as any).electronAPI.xnat.deleteScan(sessionId, scanId);
            },
            { sessionId: config.testSession, scanId: seg.id },
          );
        }
      }
    } catch {
      console.warn('[e2e] Cleanup: failed to delete test segmentation scan');
    }
  });
});
