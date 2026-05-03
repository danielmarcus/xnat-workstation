/**
 * Phase 5.6 — §C3 Contour Fill (LabelmapEditWithContour) acceptance.
 *
 * Requirements §C3:
 *   "Contour Fill: the user draws a freehand or polygon contour and the
 *    tool rasterizes the enclosed region into the active segment as
 *    voxels."
 *
 * The Phase 5.2 fix wires `segmentationService.ensureContourRepresentation`
 * into `toolService.setActiveTool` for `LabelmapEditWithContour`, so the
 * underlying Cornerstone tool finds a Contour representation already
 * attached to the labelmap segmentation when its rasterization runs.
 *
 * This spec drives the production Add seg → Contour Fill → freehand
 * stroke that closes (mouse-up returns near start) → assert non-zero
 * labelmap voxels via `exportSegmentationToBase64`. If the rasterizer
 * silently no-ops (the pre-Phase-5.2 failure mode), this spec fails.
 *
 * Runs flag-off + flag-on so any regression on either path surfaces.
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
    `[data-testid="stack-viewport-canvas:${panelId}"] canvas, [data-testid="volume-viewport-canvas:${panelId}"] canvas`,
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

function countNonZeroBytes(base64: string): { totalBytes: number; nonZero: number } {
  const buf = Buffer.from(base64, 'base64');
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const ds = dcmjs.data.DicomMetaDictionary.naturalizeDataset(
    dcmjs.data.DicomMessage.readFile(ab).dict,
  ) as { PixelData?: ArrayBuffer | Uint8Array | unknown[] };
  const px = ds.PixelData;
  let bytes: Uint8Array | null = null;
  if (px instanceof ArrayBuffer) bytes = new Uint8Array(px);
  else if (px instanceof Uint8Array) bytes = px;
  else if (Array.isArray(px) && px[0] instanceof ArrayBuffer) bytes = new Uint8Array(px[0] as ArrayBuffer);
  if (!bytes) return { totalBytes: 0, nonZero: 0 };
  let nz = 0;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] !== 0) nz += 1;
  return { totalBytes: bytes.byteLength, nonZero: nz };
}

async function activateContourFillAndDraw(
  page: Page,
  multiViewportEnabled: boolean,
): Promise<{ segmentationId: string; nonZero: number; totalBytes: number }> {
  const result = await loadFixtureScan(page, FIXTURE_NAMES.CT_AXIAL_300, {
    panelId: 'panel_0',
    multiViewportEnabled,
  });
  expect(result, 'fixture must be present').not.toBeNull();
  await panelCanvas(page, 'panel_0').waitFor({ state: 'visible', timeout: 30_000 });

  await openSegmentationPanel(page);

  const segPanel = page.locator('[data-testid="segmentation-panel"]');
  const segLabel = `Contour Fill ${multiViewportEnabled ? 'flag-on' : 'flag-off'}`;
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
  expect(segmentationId, 'seg id must resolve').toBeTruthy();

  await page.evaluate((sid: string) => {
    window.__XNAT_E2E__?.activateSegmentation?.('panel_0', sid, 1);
  }, segmentationId!);
  await page.waitForTimeout(300);

  const segRow = segPanel.locator('div.cursor-pointer', { hasText: segLabel }).first();
  await expect(segRow).toBeVisible({ timeout: 10_000 });
  await segRow.click();
  await page.waitForTimeout(200);

  // Activate Contour Fill (LabelmapEditWithContour). The Phase 5.2 fix
  // calls ensureContourRepresentation as part of this path so the
  // rasterizer has a Contour rep to bind to.
  const contourFillBtn = segPanel.locator('button', { hasText: 'Contour Fill' }).first();
  await expect(contourFillBtn).toBeVisible({ timeout: 10_000 });
  await expect(contourFillBtn).toBeEnabled({ timeout: 10_000 });
  await contourFillBtn.click();
  await page.waitForTimeout(500);

  // Draw a closed freehand polygon. The polyline should approximately
  // close at the end (the underlying PlanarFreehandContourSegmentationTool
  // auto-closes on mouse-up for short distances).
  const interactor = new CanvasInteractor(page, panelCanvas(page, 'panel_0'));
  await interactor.paintStroke([
    { x: 0.40, y: 0.40 },
    { x: 0.55, y: 0.40 },
    { x: 0.60, y: 0.50 },
    { x: 0.55, y: 0.60 },
    { x: 0.40, y: 0.60 },
    { x: 0.35, y: 0.50 },
    { x: 0.40, y: 0.40 },
  ]);
  await page.waitForTimeout(800);

  const base64 = await page.evaluate(
    (sid: string) => window.__XNAT_E2E__?.exportSegmentationToBase64?.(sid) ?? null,
    segmentationId!,
  );
  expect(base64, 'export must succeed').toBeTruthy();
  const { totalBytes, nonZero } = countNonZeroBytes(base64!);

  return { segmentationId: segmentationId!, totalBytes, nonZero };
}

electronTest.describe('§C3 Contour Fill (LabelmapEditWithContour) — Phase 5.2 fix', () => {
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

  electronTest('flag-off: Contour Fill rasterizes the enclosed region into the active segment', async ({ page }) => {
    const { totalBytes, nonZero } = await activateContourFillAndDraw(page, false);
    expect(totalBytes, 'PixelData must be non-empty').toBeGreaterThan(0);
    expect(
      nonZero,
      'Contour Fill must rasterize voxels inside the closed contour into the active segment',
    ).toBeGreaterThan(0);
  });

  electronTest('flag-on: Contour Fill rasterizes the enclosed region into the active segment', async ({ page }) => {
    await page.evaluate(() => window.__XNAT_E2E__?.setMultiViewportEnabled(true));
    const { totalBytes, nonZero } = await activateContourFillAndDraw(page, true);
    expect(totalBytes, 'flag-on PixelData must be non-empty').toBeGreaterThan(0);
    expect(
      nonZero,
      'flag-on Contour Fill must rasterize voxels inside the closed contour into the active segment',
    ).toBeGreaterThan(0);
  });
});
