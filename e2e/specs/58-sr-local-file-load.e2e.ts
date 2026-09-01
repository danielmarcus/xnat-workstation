/**
 * SR-D (production route) — a saved DICOM-SR file loads as Measurements through the
 * REAL local-file import path (App.loadLocalFiles), not a test hook. This is the
 * data-path proof: dropping an SR file routes it to annotationService by SOP Class
 * UID (the SR family) and reconstructs its measurements onto the loaded images —
 * exactly what the XNAT-scan reload does, minus the CNDA download leg.
 *
 * Draw a Length → serialize to an SR (exportSrBase64) → clear everything → feed that
 * SR back through the actual file input (setInputFiles, the genuine affordance) → the
 * measurement reappears as a Measurement-container member.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../helpers/local-fixture';

interface E2EHooks {
  setActiveUnifiedTool: (toolName: string) => void;
  getMeasurementCount: () => number;
  clearAllContainers: () => void;
  exportSrBase64: () => Promise<string | null>;
}
type Win = { __XNAT_E2E__: E2EHooks };

const cleanSlate = async (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers());
test.beforeEach(({ page }) => cleanSlate(page));
test.afterEach(({ page }) => cleanSlate(page));

test('SR-D: a DICOM-SR file loads as Measurements via the real file-import route', async ({ page }) => {
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

  // Serialize to a DICOM-SR (the saved file).
  const srBase64 = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.exportSrBase64());
  expect(srBase64).toBeTruthy();

  // Clear everything (the image stack stays loaded) → no measurements.
  await cleanSlate(page);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getMeasurementCount()))
    .toBe(0);
  await expect(panel.locator('[data-testid^="member-row-"]')).toHaveCount(0);

  // Feed the SR back through the REAL file input → App.loadLocalFiles routes it by
  // SOP Class UID to the SR importer. No test hook involved.
  const buffer = Buffer.from(srBase64 as string, 'base64');
  await page.locator('[data-testid="local-import-input"]').setInputFiles({
    name: 'roundtrip-measurements.dcm',
    mimeType: 'application/dicom',
    buffer,
  });

  // The measurement reappears as a Measurement-container member.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getMeasurementCount()), { timeout: 15_000 })
    .toBe(1);
  await expect(panel.locator('[data-testid^="member-row-"]')).toHaveCount(1);
  // The container is labeled from the file name (minus .dcm).
  await expect(panel.getByText('roundtrip-measurements')).toBeVisible({ timeout: 10_000 });
});
