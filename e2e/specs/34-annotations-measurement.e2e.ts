/**
 * Annotations panel — measurement (SR) container (Rebuild Phase 3 / signal 32).
 *
 * A drawn measurement is a first-class container in the panel: activate a
 * measurement tool, draw a Length on the canvas, and the panel shows a Measurement
 * (SR) container whose member row carries the tool name + the formatted value.
 * Drives the real tool + a real draw gesture.
 *
 * (The explicit "New Measurement (SR)" create-empty-set button is deferred per the
 * D7.1 measurement skeleton; this verifies the draw → panel-member path, which is
 * the core of signal 32.)
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../helpers/local-fixture';

interface E2EHooks {
  setActiveUnifiedTool: (toolName: string) => void;
  getMeasurementCount: () => number;
  clearAllContainers: () => void;
}
type Win = { __XNAT_E2E__: E2EHooks };

// Full clean slate (segmentations + measurements, cs + stores) before AND after —
// the worker-scoped app is shared, and a drawn measurement now marks its SR
// container dirty (SR-A), which would otherwise leak into downstream specs' counts.
const cleanSlate = async (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers());
test.beforeEach(({ page }) => cleanSlate(page));
test.afterEach(({ page }) => cleanSlate(page));

test('a drawn Length measurement appears as a member of the Measurement (SR) container', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  // Open idempotently — the toggle may already be open from a prior spec in the worker.
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  }
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(panel.getByText('No annotations yet')).toBeVisible();

  // Activate the Length tool + draw a length on the canvas (real gesture).
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setActiveUnifiedTool('Length'));
  const canvas = page.locator('[data-testid="unified-viewport-element:panel_0"] canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const cy = box!.y + box!.height / 2;
  await page.mouse.move(box!.x + box!.width * 0.35, cy);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.65, cy, { steps: 6 });
  await page.mouse.up();

  // The measurement registered…
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getMeasurementCount()), { timeout: 15_000 })
    .toBeGreaterThan(0);

  // …and the panel now shows a Measurement (SR) container with a member row.
  await expect(panel.getByText('No annotations yet')).toHaveCount(0);
  await expect(panel.getByText('Measurements')).toBeVisible({ timeout: 10_000 });
  await expect(panel.locator('[data-testid^="member-row-"]')).toHaveCount(1);
  // The member carries its formatted value (metricOf → displayText, signal 32).
  await expect(panel.getByText(/\d/).first()).toBeVisible();

  // SR-A: drawing a measurement marks the SR container DIRTY, so the per-container
  // Save icon enables (it was permanently disabled before — the dirty flag was
  // never wired for SR, only for SEG). This is the real draw→dirty→save-enabled path.
  const saveBtn = panel.getByLabel('Save container');
  await expect(saveBtn).toBeEnabled({ timeout: 10_000 });
  await expect(panel.locator('[data-testid="dirty-dot"]')).toBeVisible();
});
