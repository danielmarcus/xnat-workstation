/**
 * SR-C — the side-panel toolbox is the measurement-tool path (the toolbar's
 * "Measure" dropdown was removed; frozen §10 puts measurement tools in the
 * kind-adaptive side-panel toolbox). This proves removal stranded nothing: create
 * a Measurement container, pick Length FROM THE TOOLBOX (real click, not the e2e
 * tool hook, not the old toolbar dropdown), draw, and the measurement registers as
 * a member.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../helpers/local-fixture';

interface E2EHooks {
  getMeasurementCount: () => number;
  clearAllContainers: () => void;
}
type Win = { __XNAT_E2E__: E2EHooks };

// Full clean slate before AND after — a drawn measurement marks its SR container
// dirty (SR-A), so clean up so it doesn't leak into downstream specs' counts.
const cleanSlate = async (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers());
test.beforeEach(({ page }) => cleanSlate(page));
test.afterEach(({ page }) => cleanSlate(page));

test('SR-C: a measurement is created via the side-panel toolbox (no toolbar dropdown)', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');

  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  }
  await expect(panel).toBeVisible({ timeout: 15_000 });

  // The toolbar no longer carries a measurement-tool dropdown.
  await expect(page.locator('[data-testid="annotation-tool-dropdown"]')).toHaveCount(0);

  // Create + name a Measurement container → it becomes active → the toolbox adapts.
  await panel.getByRole('button', { name: 'New Measurement (SR)' }).click();
  await expect(panel.getByLabel('Rename container')).toBeVisible({ timeout: 15_000 });
  await panel.getByLabel('Rename container').press('Enter');

  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await expect(toolbox).toBeVisible({ timeout: 10_000 });
  await expect(toolbox.getByText('Measurement tools')).toBeVisible();

  // Activate Length FROM THE TOOLBOX (the replacement for the removed toolbar dropdown).
  await toolbox.getByLabel('Length').click();

  // Draw a length on the canvas (real gesture).
  const canvas = page.locator('[data-testid="unified-viewport-element:panel_0"] canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const cy = box!.y + box!.height / 2;
  await page.mouse.move(box!.x + box!.width * 0.35, cy);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.65, cy, { steps: 6 });
  await page.mouse.up();

  // The measurement registered via the toolbox-selected tool.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getMeasurementCount()), { timeout: 15_000 })
    .toBe(1);
  await expect(panel.locator('[data-testid^="member-row-"]')).toHaveCount(1);
});
