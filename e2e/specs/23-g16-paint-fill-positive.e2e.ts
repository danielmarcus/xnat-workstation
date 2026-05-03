/**
 * Phase 5.6 — G16 positive case (requirements §G #16):
 *
 *   "3D paint-fill on axial appears resampled on sagittal MPR; one undo
 *    reverts the entire fill as one entry."
 *
 * Two parts the requirements bind together:
 *   (a) "Paint-fill flood writes voxels into the active segment when
 *        clicking inside an enclosed region."
 *   (b) "One undo reverts the entire fill as one entry" — the entire
 *       flood is a single memo, not one memo per voxel.
 *
 * The cross-MPR resampling third part follows from §C1 (voxel
 * coherence — sagittal/coronal viewports read the same 3D voxel grid
 * the axial fill wrote) and is already pinned by G1 + G3.
 *
 * The single-undo-batches-all-voxels invariant is unit-pinned by
 * [`SafePaintFillTool.test.ts`](../../src/renderer/lib/cornerstone/tools/SafePaintFillTool.test.ts)
 * "G16: a single fill records all voxel changes in one memo". This
 * spec drives the same invariant E2E through the production pipeline:
 *
 *   1. Add SEG, activate Brush.
 *   2. Brush a closed square boundary across four strokes (each side
 *      of the square is one stroke; corners overlap so the boundary
 *      is fully closed).
 *   3. Capture exported PixelData after the boundary — `boundaryNonZero`.
 *   4. Activate Paint Fill, click in the interior of the square.
 *   5. Capture exported PixelData after the fill — `afterFillNonZero`.
 *   6. Assert `afterFillNonZero > boundaryNonZero` — the fill flooded
 *      the enclosed interior (positive case).
 *   7. Press Ctrl+Z once.
 *   8. Capture exported PixelData after undo — `afterUndoNonZero`.
 *   9. Assert `afterUndoNonZero === boundaryNonZero` — single undo
 *      reverted ONLY the fill, not the four brush strokes.
 *
 * Uses the `ct-axial-anatomy` fixture for symmetry with the rest of
 * the Phase 5 spec set, though Paint Fill operates on labelmap voxel
 * values (intensity-blind) — `ct-axial-300` would also work.
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

function countNonZeroBytes(base64: string): number {
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
  if (!bytes) return 0;
  let nz = 0;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] !== 0) nz += 1;
  return nz;
}

async function exportNonZero(page: Page, segId: string): Promise<number> {
  const base64 = await page.evaluate(
    (sid: string) => window.__XNAT_E2E__?.exportSegmentationToBase64?.(sid) ?? null,
    segId,
  );
  expect(base64, 'export must succeed').toBeTruthy();
  return countNonZeroBytes(base64!);
}

electronTest.describe('G16 positive: Paint Fill floods enclosed interior; single undo reverts only the fill', () => {
  electronTest.beforeEach(async ({ page }) => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__XNAT_E2E__, undefined, { timeout: 30_000 });
  });

  electronTest.afterEach(async ({ page }) => {
    await page.evaluate(() => {
      window.__XNAT_E2E__?.markAllSegmentationsClean?.();
      window.__XNAT_E2E__?.setLayout?.('1x1' as const);
    });
  });

  electronTest('Paint Fill floods the enclosed interior; one Ctrl+Z reverts only the fill', async ({ page }) => {
    const result = await loadFixtureScan(page, FIXTURE_NAMES.CT_AXIAL_ANATOMY, {
      panelId: 'panel_0',
    });
    expect(result, 'fixture must be present').not.toBeNull();
    await panelCanvas(page, 'panel_0').waitFor({ state: 'visible', timeout: 30_000 });

    await openSegmentationPanel(page);

    const segPanel = page.locator('[data-testid="segmentation-panel"]');
    const segLabel = 'G16 Paint Fill';
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

    // Step 1: Brush. The default brush size (25 px on the 128 px CT
    // viewport at default zoom) produces a stroke ≈20% of canvas width
    // wide. Four short strokes that trace a square close a boundary
    // with an interior pocket of ≈10% canvas width — large enough for
    // a Paint Fill click to land inside without touching the boundary.
    const brushBtn = segPanel.locator('button', { hasText: 'Brush' }).first();
    await expect(brushBtn).toBeVisible({ timeout: 10_000 });
    await expect(brushBtn).toBeEnabled({ timeout: 10_000 });
    await brushBtn.click();
    await page.waitForTimeout(300);

    // Step 2: brush four sides of a square. Corners overlap so the
    // boundary is fully closed (no leak path for the flood).
    const interactor = new CanvasInteractor(page, panelCanvas(page, 'panel_0'));
    // Top edge
    await interactor.paintStroke(
      [
        { x: 0.35, y: 0.40 },
        { x: 0.65, y: 0.40 },
      ],
      4,
    );
    await page.waitForTimeout(150);
    // Right edge
    await interactor.paintStroke(
      [
        { x: 0.65, y: 0.40 },
        { x: 0.65, y: 0.60 },
      ],
      4,
    );
    await page.waitForTimeout(150);
    // Bottom edge
    await interactor.paintStroke(
      [
        { x: 0.65, y: 0.60 },
        { x: 0.35, y: 0.60 },
      ],
      4,
    );
    await page.waitForTimeout(150);
    // Left edge — closes back to the top-left corner.
    await interactor.paintStroke(
      [
        { x: 0.35, y: 0.60 },
        { x: 0.35, y: 0.40 },
      ],
      4,
    );
    await page.waitForTimeout(400);

    // Step 3: capture boundary baseline.
    const boundaryNonZero = await exportNonZero(page, segmentationId!);
    expect(
      boundaryNonZero,
      'four brush strokes must paint a non-zero boundary baseline',
    ).toBeGreaterThan(0);

    // Step 4: activate Paint Fill.
    const paintFillBtn = segPanel.locator('button', { hasText: 'Paint Fill' }).first();
    await expect(paintFillBtn).toBeVisible({ timeout: 10_000 });
    await expect(paintFillBtn).toBeEnabled({ timeout: 10_000 });
    await paintFillBtn.click();
    await page.waitForTimeout(300);

    // Step 5: click center of the square (inside the boundary).
    await interactor.click({ x: 0.50, y: 0.50 });
    await page.waitForTimeout(800);

    const afterFillNonZero = await exportNonZero(page, segmentationId!);

    // Step 6: positive-case assertion — the fill flooded the enclosed
    // interior. The increment must exceed the brush-stroke baseline by
    // a meaningful amount (the interior is ≈10% of canvas at the
    // chosen geometry; even a very small flood produces dozens of
    // voxels). We use a conservative ≥ 10-voxel increment so noise
    // doesn't false-fail.
    expect(
      afterFillNonZero - boundaryNonZero,
      `Paint Fill must flood the interior of the brushed boundary ` +
        `(boundary baseline: ${boundaryNonZero}, after fill: ${afterFillNonZero})`,
    ).toBeGreaterThan(10);

    // Step 7: single Ctrl+Z. Production undo path — same code the
    // user takes.
    await page.keyboard.press('Control+Z');
    await page.waitForTimeout(500);

    // Step 8/9: single undo reverts ONLY the paint-fill memo, not the
    // four brush memos. afterUndo must equal boundaryNonZero exactly.
    // This is the load-bearing G16 invariant: one undo entry covers
    // the entire fill atomically. A regression that issued one
    // undo-entry per voxel would leave most of the fill in place; a
    // regression that issued one undo-entry per slice would leave a
    // partial fill; a regression that re-batched into the brush
    // strokes would over-revert. Equality with boundaryNonZero is the
    // narrow target.
    const afterUndoNonZero = await exportNonZero(page, segmentationId!);
    expect(
      afterUndoNonZero,
      `one Ctrl+Z must revert only the Paint Fill memo, not the four ` +
        `brush strokes (expected boundary baseline ${boundaryNonZero}, ` +
        `got ${afterUndoNonZero}; afterFill was ${afterFillNonZero})`,
    ).toBe(boundaryNonZero);
  });
});
