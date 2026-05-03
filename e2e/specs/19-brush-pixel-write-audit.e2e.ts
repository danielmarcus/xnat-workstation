/**
 * Empirical audit of "Bug 2" / "Bug 1" from the Phase 2 cliff-edge notes.
 *
 * Documented suspicion (PHASES.md):
 *   "nonZeroPixels=0 on exportToDicomSeg after a real brush stroke. Brush
 *    events fire but no labelmap pixels get written."
 *   "after a real brush stroke, hasUnsavedChanges does not get set."
 *
 * Both were attributed to a Cornerstone capability gap and parked. After
 * G7 flag-on / flag-off both passed (which themselves drive a real brush
 * stroke and verify a labelmap memo lands on the undo stack), the
 * "no pixels written" diagnosis became dubious. This spec verifies the
 * end-to-end pipeline:
 *
 *   1. Add a SEG via the production "Add segmentation" dialog.
 *   2. Activate Brush; paint a real pointer-event stroke on the canvas.
 *   3. Assert `hasUnsavedChanges === true` after the stroke.
 *   4. Assert `getDirtyState.perSegmentationDirty` includes our seg id.
 *   5. Export the SEG via `exportSegmentationToBase64`. Decode the
 *      base64 → DICOM dataset; assert the PixelData byte length is
 *      non-zero AND the byte sum is non-zero (some painted voxels
 *      survived the export pipeline).
 *
 * Runs both flag-off (legacy stack mode) and flag-on (volume mode) so
 * any per-flag regression surfaces.
 */
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { test as electronTest } from '../fixtures/electron-app';
import { FIXTURE_NAMES } from '../helpers/local-dicom-fixtures';
import { loadFixtureScan } from '../helpers/fixture-load';
import { CanvasInteractor } from '../helpers/canvas-interaction';
import { Buffer } from 'buffer';
import dcmjs from 'dcmjs';

function panelCanvas(page: Page, panelId: string): Locator {
  return page.locator(
    `[data-testid="cornerstone-viewport-canvas:${panelId}"] canvas, [data-testid="volume-viewport-canvas:${panelId}"] canvas`,
  ).first();
}

async function openSegmentationPanel(page: Page) {
  const panel = page.locator('[data-testid="segmentation-panel"]');
  if (await panel.isVisible().catch(() => false)) return;
  const annotationToolsTrigger = page.locator('button[title="Annotation tools"]');
  if (await annotationToolsTrigger.isVisible().catch(() => false)) {
    await annotationToolsTrigger.click();
  }
  const segmentationToggle = page.locator(
    'button[title="Show segmentation panel"], button[title="Hide segmentation panel"]',
  ).first();
  await segmentationToggle.waitFor({ state: 'visible', timeout: 10_000 });
  await segmentationToggle.click();
  await panel.waitFor({ state: 'visible', timeout: 10_000 });
}

async function paintAndExport(page: Page, multiViewportEnabled: boolean): Promise<{
  hasUnsavedChanges: boolean;
  dirtyIds: string[];
  pixelDataBytes: number;
  pixelDataNonZeroBytes: number;
  segmentationId: string | null;
}> {
  const result = await loadFixtureScan(page, FIXTURE_NAMES.CT_AXIAL_300, {
    panelId: 'panel_0',
    multiViewportEnabled,
  });
  expect(result, 'fixture must be present').not.toBeNull();
  await panelCanvas(page, 'panel_0').waitFor({ state: 'visible', timeout: 30_000 });

  await openSegmentationPanel(page);

  const segPanel = page.locator('[data-testid="segmentation-panel"]');
  const segLabel = `Bug2 ${multiViewportEnabled ? 'flag-on' : 'flag-off'}`;
  await page.locator('[data-testid="add-segmentation-btn"]').click();
  const nameInput = segPanel.locator('input.bg-zinc-800');
  await expect(nameInput).toBeVisible({ timeout: 5_000 });
  await nameInput.fill(segLabel);
  await page.locator('button', { hasText: 'Create' }).click();
  await expect(nameInput).toBeHidden({ timeout: 5_000 });

  const segmentationId = await page.evaluate(
    (label: string) => window.__XNAT_E2E__?.getSegmentationIdByLabel?.(label) ?? null,
    segLabel,
  );
  expect(segmentationId, 'segmentation id should resolve from label').toBeTruthy();

  await page.evaluate((segId: string) => {
    window.__XNAT_E2E__?.activateSegmentation?.('panel_0', segId, 1);
  }, segmentationId!);
  await page.waitForTimeout(500);

  // Click the row first so the matching Brush button becomes active.
  const segRow = segPanel.locator('div.cursor-pointer', { hasText: segLabel }).first();
  await expect(segRow).toBeVisible({ timeout: 10_000 });
  await segRow.click();
  await page.waitForTimeout(300);

  const brushBtn = segPanel.locator('button', { hasText: 'Brush' }).first();
  await expect(brushBtn).toBeVisible({ timeout: 10_000 });
  await expect(brushBtn).toBeEnabled({ timeout: 10_000 });
  await brushBtn.click();
  await page.waitForTimeout(300);

  // Real pointer-event stroke on the canvas.
  const interactor = new CanvasInteractor(page, panelCanvas(page, 'panel_0'));
  await interactor.paintStroke([
    { x: 0.40, y: 0.40 },
    { x: 0.45, y: 0.42 },
    { x: 0.50, y: 0.45 },
    { x: 0.55, y: 0.47 },
    { x: 0.60, y: 0.50 },
  ]);
  await page.waitForTimeout(500);

  const dirtyState = await page.evaluate(() => window.__XNAT_E2E__!.getDirtyState());

  // Export the SEG and inspect PixelData.
  const base64 = await page.evaluate(
    (sid: string) => window.__XNAT_E2E__?.exportSegmentationToBase64?.(sid) ?? null,
    segmentationId!,
  );

  let pixelDataBytes = 0;
  let pixelDataNonZeroBytes = 0;
  if (base64) {
    const buffer = Buffer.from(base64, 'base64');
    const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    const dm = dcmjs.data.DicomMessage.readFile(ab);
    const ds = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dm.dict) as {
      PixelData?: ArrayBuffer | Uint8Array | unknown[];
    };
    const px = ds.PixelData;
    let bytes: Uint8Array | null = null;
    if (px instanceof ArrayBuffer) {
      bytes = new Uint8Array(px);
    } else if (px instanceof Uint8Array) {
      bytes = px;
    } else if (Array.isArray(px) && px[0] instanceof ArrayBuffer) {
      bytes = new Uint8Array(px[0] as ArrayBuffer);
    }
    if (bytes) {
      pixelDataBytes = bytes.byteLength;
      for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] !== 0) pixelDataNonZeroBytes += 1;
      }
    }
  }

  return {
    hasUnsavedChanges: dirtyState.globalDirty,
    dirtyIds: dirtyState.perSegmentationDirty,
    pixelDataBytes,
    pixelDataNonZeroBytes,
    segmentationId,
  };
}

electronTest.describe('Brush pixel-write audit (Bug 2 / Bug 1 from PHASES.md cliff-edge)', () => {
  electronTest.beforeEach(async ({ page }) => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__XNAT_E2E__, undefined, { timeout: 30_000 });
    await page.evaluate(() => {
      window.__XNAT_E2E__?.setMultiViewportEnabled(false);
    });
  });

  electronTest.afterEach(async ({ page }) => {
    await page.evaluate(() => {
      window.__XNAT_E2E__?.markAllSegmentationsClean?.();
      window.__XNAT_E2E__?.setLayout?.('1x1' as const);
      window.__XNAT_E2E__?.setMultiViewportEnabled(false);
    });
  });

  electronTest('flag-off: brush stroke writes labelmap pixels AND sets the dirty flag', async ({ page }) => {
    const result = await paintAndExport(page, false);
    expect(
      result.hasUnsavedChanges,
      'global hasUnsavedChanges should be true after a brush stroke (Bug 1 surface)',
    ).toBe(true);
    expect(
      result.dirtyIds,
      'per-segmentation dirty list must include the painted seg',
    ).toContain(result.segmentationId);
    expect(
      result.pixelDataBytes,
      'exported PixelData must be non-empty',
    ).toBeGreaterThan(0);
    expect(
      result.pixelDataNonZeroBytes,
      'exported PixelData must contain non-zero voxels (Bug 2 surface)',
    ).toBeGreaterThan(0);
  });

  electronTest('flag-on: brush stroke writes labelmap pixels AND sets the dirty flag', async ({ page }) => {
    await page.evaluate(() => window.__XNAT_E2E__?.setMultiViewportEnabled(true));
    const result = await paintAndExport(page, true);
    expect(result.hasUnsavedChanges, 'flag-on: global dirty must be true').toBe(true);
    expect(result.dirtyIds).toContain(result.segmentationId);
    expect(result.pixelDataBytes, 'flag-on: PixelData must be non-empty').toBeGreaterThan(0);
    expect(result.pixelDataNonZeroBytes, 'flag-on: PixelData must contain non-zero voxels').toBeGreaterThan(0);
  });
});
