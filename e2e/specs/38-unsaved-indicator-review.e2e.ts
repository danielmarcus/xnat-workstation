/**
 * In-panel unsaved indicator + review-&-save dialog (Change 1a, visual acceptance).
 * Replaces the below-toolbar banner: unsaved annotations surface as a count on the
 * panel header; clicking it opens a dialog listing them; Save persists via the
 * (mock) transport and the indicator clears. Drives the REAL affordances end-to-end.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../helpers/local-fixture';

interface E2EHooks {
  setMultiviewportEnabled: (v: boolean) => void;
  setActiveUnifiedTool: (toolName: string) => void;
  setUnifiedBrushSize: (size: number) => void;
  installMockXnatTransport: () => void;
  createUnifiedLabelmapSegmentation: (label?: string) => Promise<{ segmentationId: string; segmentIndex: number }>;
}
type Win = { __XNAT_E2E__: E2EHooks };

async function brush(page: Page) {
  const box = await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox();
  expect(box).not.toBeNull();
  const cx = box!.x + box!.width / 2;
  const cy = box!.y + box!.height / 2;
  await page.mouse.move(cx - 20, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 20, cy + 20, { steps: 4 });
  await page.mouse.up();
}

test('Change 1a: unsaved annotations show a panel indicator → review dialog → Save clears it', async ({ page }) => {
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setMultiviewportEnabled(true));
  await loadFixture(page, 'ct-axial-300', 'panel_0');

  await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.installMockXnatTransport());

  // No unsaved work yet → the indicator is disabled with no count.
  const indicator = panel.locator('[data-testid="unsaved-indicator"]');
  await expect(indicator).toBeDisabled();
  await expect(panel.locator('[data-testid="unsaved-count"]')).toHaveCount(0);

  // Create a Segmentation (volume-ready) and paint it → it becomes unsaved (dirty).
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.createUnifiedLabelmapSegmentation('Lesion'));
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setUnifiedBrushSize(25));
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setActiveUnifiedTool('Brush'));
  await brush(page);

  // The in-panel indicator lights up with the unsaved count.
  await expect(panel.locator('[data-testid="unsaved-count"]')).toHaveText('1', { timeout: 10_000 });
  await expect(indicator).toBeEnabled();

  // Click it → the review dialog lists the unsaved container.
  await indicator.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Unsaved annotations')).toBeVisible();
  await expect(dialog.getByText('This session')).toBeVisible();

  // Save all → persists via the mock transport → the dirty marker clears.
  await dialog.getByRole('button', { name: 'Save all' }).click();
  await expect(dialog.getByText(/All annotations saved/)).toBeVisible({ timeout: 10_000 });

  // Close → the panel indicator is back to "nothing unsaved".
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(panel.locator('[data-testid="unsaved-count"]')).toHaveCount(0);
  await expect(indicator).toBeDisabled();
});
