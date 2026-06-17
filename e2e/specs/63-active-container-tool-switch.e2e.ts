/**
 * Two user-reported bugs about activating containers:
 *  (a) Moving from a measurement to a segmentation/structure didn't switch the tools
 *      to the active annotation type — there was no way to activate a container by
 *      clicking it, and activation didn't swap the drawing tool to the kind's default.
 *  (b) Clicking into a measurement container didn't activate it, so further drawn
 *      measurements weren't routed into it.
 *
 * Real affordances: click a container's name to activate it; assert the kind-adaptive
 * toolbox + the active drawing tool follow, and that drawing after activating a
 * Measurement container routes a measurement into it.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../helpers/local-fixture';

interface E2EHooks {
  setMultiviewportEnabled: (v: boolean) => void;
  getActiveUnifiedTool: () => string | null;
  getMeasurementCount: () => number;
  clearAllContainers: () => void;
}
type Win = { __XNAT_E2E__: E2EHooks };

const activeTool = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getActiveUnifiedTool());

const cleanSlate = async (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers());
test.beforeEach(({ page }) => cleanSlate(page));
test.afterEach(({ page }) => cleanSlate(page));

test('activating a container switches the toolbox + drawing tool to its kind; clicking a measurement container readies drawing into it', async ({ page }) => {
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setMultiviewportEnabled(true));
  await loadFixture(page, 'ct-axial-300', 'panel_0');

  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  }
  await expect(panel).toBeVisible({ timeout: 15_000 });

  // Create a Segmentation container (two-step create: name container → name member).
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await panel.getByLabel('Rename container').press('Enter');
  await expect(panel.getByLabel('Rename member')).toBeVisible({ timeout: 10_000 });
  await panel.getByLabel('Rename member').press('Enter');

  // Create a Measurement (SR) container → it becomes active and readies a measurement tool.
  await panel.getByRole('button', { name: 'New Measurement (SR)' }).click();
  await panel.getByLabel('Rename container').press('Enter');
  await expect(panel.locator('[data-testid^="container-row-sr:"]')).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => activeTool(page), { timeout: 10_000 }).toBe('Length');
  await expect(panel.getByText('Measurement tools')).toBeVisible();

  // (a) Activate the Segmentation container by clicking its name → tools switch to SEG.
  const segActivate = panel.locator('[data-testid^="container-activate-"]:not([data-testid^="container-activate-sr:"])').first();
  await segActivate.click();
  await expect(panel.getByText('Segmentation tools')).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => activeTool(page), { timeout: 10_000 }).not.toBe('Length'); // swapped off the measurement tool

  // Activate the Measurement container by clicking its name → tools switch back to SR.
  await panel.locator('[data-testid^="container-activate-sr:"]').first().click();
  await expect(panel.getByText('Measurement tools')).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => activeTool(page), { timeout: 10_000 }).toBe('Length');

  // (b) The Measurement container is now active for drawing — a drawn Length routes into it.
  const canvas = page.locator('[data-testid="unified-viewport-element:panel_0"] canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const cy = box!.y + box!.height / 2;
  await page.mouse.move(box!.x + box!.width * 0.35, cy);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.65, cy, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getMeasurementCount()), { timeout: 15_000 })
    .toBe(1);
});
