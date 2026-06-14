/**
 * Transport TR5 (SR write) — a drawn measurement serializes to a conformant DICOM-SR.
 *
 * SEG and RTSTRUCT save to XNAT were live-verified (signal 14); SR was the missing third
 * modality. srExport.exportMeasurementsToDicomSr serializes measurement annotations into a
 * TID-1500 Measurement Report via @cornerstonejs/adapters (same adapter family as SEG/RT),
 * then finalizes through serializeDerivedDicomDataset — which validates Modality === 'SR'
 * and round-trips the bytes through the dcmjs write+parse, so a returned base64 is, by
 * construction, a conformant SR. (Live XNAT upload/reload is the CNDA-gated step, verified
 * the same way SEG/RTSTRUCT were.)
 *
 * Real path: draw a Length measurement with real mouse events, then serialize. RED before
 * srExport existed (no SR serializer); GREEN once it produces a valid SR.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../helpers/local-fixture';

interface E2EHooks {
  setMultiviewportEnabled: (v: boolean) => void;
  setActiveUnifiedTool: (toolName: string) => void;
  getMeasurementCount: () => number;
  exportSrBase64: () => Promise<string | null>;
}
type Win = { __XNAT_E2E__: E2EHooks };

test('a drawn Length measurement serializes to a conformant DICOM-SR (SR write)', async ({ page }) => {
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setMultiviewportEnabled(true));
  await loadFixture(page, 'ct-axial-300', 'panel_0');

  // Draw a Length on the axial panel via a real gesture.
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setActiveUnifiedTool('Length'));
  const canvas = page.locator('[data-testid="unified-viewport-element:panel_0"] canvas');
  const box = (await canvas.boundingBox())!;
  expect(box).not.toBeNull();
  const cy = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.35, cy);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, cy, { steps: 6 });
  await page.mouse.up();

  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getMeasurementCount()), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(1);

  // Serialize to DICOM-SR — a non-null base64 means the adapter produced an SR that passed
  // the Modality==='SR' + required-field validation and round-tripped through dcmjs.
  const base64 = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.exportSrBase64());
  expect(base64, 'measurements should serialize to a conformant DICOM-SR').toBeTruthy();
  expect((base64 as string).length).toBeGreaterThan(100);
});
