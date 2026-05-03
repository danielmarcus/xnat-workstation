/**
 * Phase 5.6 — G21 positive case (requirements §G #21):
 *
 *   "Use the region-segment (smart brush) tool on a CT slice. Click a
 *    seed point inside a homogeneous region; the tool fills connected
 *    voxels within the intensity tolerance into the active segment."
 *
 * The negative case (lock blocks gesture) is pinned by
 * [`20-g21-region-segment-audit.e2e.ts`](./20-g21-region-segment-audit.e2e.ts).
 * The positive case requires CT data with realistic intensity statistics
 * — RegionSegmentTool → GrowCutBaseTool samples positive seeds in a
 * small circle around the click and computes a tolerance band from
 * `positiveSeedVariance × stddev`. On the binary `ct-axial-300` sphere
 * phantom this degenerates (zero stddev inside ⇒ empty grow; huge
 * stddev across the cliff ⇒ unbounded grow), so this spec uses the new
 * `ct-axial-anatomy` fixture (soft-tissue ellipsoid + bone insert with
 * Gaussian noise; smooth gradient transitions).
 *
 * Asserts:
 *   1. Click inside the soft-tissue blob writes a non-trivial,
 *      bounded number of voxels into the active segment.
 *   2. The exported PixelData is non-empty and contains non-zero bytes.
 *   3. The painted voxel count is small relative to the full slice
 *      area (i.e. the grow is bounded — no full-slice paint).
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

electronTest.describe('G21 positive: Region Segment fills connected voxels within intensity tolerance', () => {
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

  electronTest('Region Segment click in soft-tissue interior writes a bounded set of connected voxels', async ({ page }) => {
    const result = await loadFixtureScan(page, FIXTURE_NAMES.CT_AXIAL_ANATOMY, {
      panelId: 'panel_0',
      multiViewportEnabled: false,
    });
    expect(result, 'fixture must be present (run scripts/generate-synthetic-fixture-ct-anatomy.mjs if missing)').not.toBeNull();
    await panelCanvas(page, 'panel_0').waitFor({ state: 'visible', timeout: 30_000 });

    await openSegmentationPanel(page);

    const segPanel = page.locator('[data-testid="segmentation-panel"]');
    const segLabel = 'G21 Region Positive';
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

    // Activate Region Segment.
    const regionSegBtn = segPanel.locator('button', { hasText: 'Region Segment' }).first();
    await expect(regionSegBtn).toBeVisible({ timeout: 10_000 });
    await expect(regionSegBtn).toBeEnabled({ timeout: 10_000 });
    await regionSegBtn.click();
    await page.waitForTimeout(300);

    // Click well inside the soft-tissue ellipsoid. Fixture geometry centers
    // the blob at canvas-relative ≈(0.5, 0.5); offset slightly to the left
    // to stay clear of the bone insert (positioned at +18mm x / -8mm y in
    // world space ⇒ ≈(0.57, 0.47) in canvas coords). The click uses
    // mouse-down + drag + mouse-up because GrowCutBaseTool's pre/drag/end
    // handlers expect a drag gesture (dragCallback updates the radius
    // border, endCallback runs the grow). A zero-distance drag is
    // sufficient — the seed circle has a configured default radius.
    const interactor = new CanvasInteractor(page, panelCanvas(page, 'panel_0'));
    await interactor.paintStroke(
      [
        { x: 0.42, y: 0.50 },
        { x: 0.43, y: 0.50 },
      ],
      1,
    );

    // RegionSegment runs its grow asynchronously after mouse-up. Allow
    // generous time for the worker pool to complete on slower CI hosts.
    await page.waitForTimeout(2_500);

    const base64 = await page.evaluate(
      (sid: string) => window.__XNAT_E2E__?.exportSegmentationToBase64?.(sid) ?? null,
      segmentationId!,
    );
    expect(base64, 'export must succeed').toBeTruthy();
    const { totalBytes, nonZero } = countNonZeroBytes(base64!);

    expect(totalBytes, 'PixelData must be non-empty').toBeGreaterThan(0);
    expect(
      nonZero,
      'Region Segment must paint connected voxels in the active segment ' +
        '(the synthetic anatomy fixture provides realistic noise + smooth ' +
        'gradients so GrowCut produces a bounded non-empty grow).',
    ).toBeGreaterThan(0);

    // Bounded-grow check: the painted region must not span the entire
    // slice. Per fixture geometry the soft-tissue blob occupies ≈ 30%
    // of the slice area; a runaway grow would paint significantly more.
    // Use a generous upper bound (75% of total bytes) so noise / boundary
    // jitter don't false-fail; the failure mode we're guarding against
    // is the "GrowCut floods the entire image" pathology.
    expect(
      nonZero / totalBytes,
      'Region Segment grow must be bounded (no full-slice flood)',
    ).toBeLessThan(0.75);
  });
});
