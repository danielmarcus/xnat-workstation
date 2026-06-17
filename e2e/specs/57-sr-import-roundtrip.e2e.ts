/**
 * SR-D — DICOM-SR import round-trip. A measurement set saved as a DICOM-SR reloads
 * into measurements (the create→save→reload round-trip). Verified offline against a
 * REAL loaded fixture (so the SOP-UID→imageId reconstruction is genuine): draw a
 * Length → serialize to SR (srExport) → clear everything → reconstruct from that SR
 * (srImport) → the measurement reappears. The CNDA upload/download legs are the
 * already-proven transport; this proves the SR serialize↔deserialize round-trip.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../helpers/local-fixture';

interface E2EHooks {
  setMultiviewportEnabled: (v: boolean) => void;
  setActiveUnifiedTool: (toolName: string) => void;
  getMeasurementCount: () => number;
  clearAllContainers: () => void;
  exportSrBase64: () => Promise<string | null>;
  importSrBase64: (base64: string) => number;
}
type Win = { __XNAT_E2E__: E2EHooks };

const cleanSlate = async (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers());
test.beforeEach(({ page }) => cleanSlate(page));
test.afterEach(({ page }) => cleanSlate(page));

test('SR-D: a measurement survives an SR export→import round-trip', async ({ page }) => {
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setMultiviewportEnabled(true));
  await loadFixture(page, 'ct-axial-300', 'panel_0');

  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  }
  await expect(panel).toBeVisible({ timeout: 15_000 });

  // Draw a Length (real gesture) → one measurement.
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setActiveUnifiedTool('Length'));
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

  // Serialize to a DICOM-SR (the save payload).
  const srBase64 = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.exportSrBase64());
  expect(srBase64).toBeTruthy();

  // Clear everything (simulate closing/reloading the session) → no measurements.
  await cleanSlate(page);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getMeasurementCount()))
    .toBe(0);
  await expect(panel.locator('[data-testid^="member-row-"]')).toHaveCount(0);

  // Reconstruct from the SR (the reload) → the measurement reappears.
  const added = await page.evaluate(
    (b64) => (window as unknown as Win).__XNAT_E2E__.importSrBase64(b64),
    srBase64 as string,
  );
  expect(added).toBe(1);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getMeasurementCount()), { timeout: 10_000 })
    .toBe(1);
  await expect(panel.getByText('Measurements')).toBeVisible({ timeout: 10_000 });
  await expect(panel.locator('[data-testid^="member-row-"]')).toHaveCount(1);
});
