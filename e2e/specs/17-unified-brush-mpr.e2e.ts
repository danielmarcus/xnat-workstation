/**
 * P1.7b — signal 3: a brush-painted SEG segment is resampled live on the other
 * MPR planes (offline, flag on).
 *
 * MPR-2×2 of one CT over ONE shared volume. We create a labelmap segmentation,
 * attach it to all four unified viewports (addToViewport auto-converts the stack
 * labelmap to a VOLUME labelmap for the orthographic viewports), select the real
 * BrushTool, and brush-paint on the axial panel with a REAL mouse gesture (no
 * setter shortcut). Because the labelmap is one 3D volume, the painted voxels
 * render on every plane natively — verified structurally (non-zero labelmap
 * voxels exist after the stroke) and visually (the sagittal + coronal canvases
 * change).
 *
 * (Signal 3's literal "stack" paint surface is, in the volume-default unified
 * design, the axial volume panel; the core claim — paint resampled live on MPR
 * via the shared volume — is what this verifies.)
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { ensureFixture, enterLocalViewer } from '../helpers/local-fixture';

interface E2EHooks {
  setLayoutPreset: (preset: 'single' | 'mpr-2x2') => void;
  setActiveUnifiedTool: (toolName: string) => void;
  createUnifiedLabelmapSegmentation: (label?: string) => Promise<{ segmentationId: string; segmentIndex: number }>;
  setUnifiedBrushSize: (size: number) => void;
  getPaintedVoxelCount: () => number;
  isUnifiedVolumeReady: () => boolean;
  resetUnifiedSegmentations: () => void;
}
type Win = { __XNAT_E2E__: E2EHooks };

const setPreset = (page: Page, p: 'single' | 'mpr-2x2') =>
  page.evaluate((pp) => (window as unknown as Win).__XNAT_E2E__.setLayoutPreset(pp), p);
const setTool = (page: Page, t: string) =>
  page.evaluate((tn) => (window as unknown as Win).__XNAT_E2E__.setActiveUnifiedTool(tn), t);
const createLabelmap = (page: Page, label: string) =>
  page.evaluate((l) => (window as unknown as Win).__XNAT_E2E__.createUnifiedLabelmapSegmentation(l), label);
const setBrushSize = (page: Page, n: number) =>
  page.evaluate((s) => (window as unknown as Win).__XNAT_E2E__.setUnifiedBrushSize(s), n);
const paintedVoxels = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelCount());
const volumeReady = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.isUnifiedVolumeReady());

/** Brush a short stroke across the centre of a canvas via real mouse events. */
async function brushStroke(page: Page, box: { x: number; y: number; width: number; height: number }) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const d = Math.min(box.width, box.height) * 0.12;
  await page.mouse.move(cx - d, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy, { steps: 4 });
  await page.mouse.move(cx + d, cy, { steps: 4 });
  await page.mouse.move(cx + d, cy + d, { steps: 4 });
  await page.mouse.up();
}

test('brush-painted SEG on axial is resampled on sagittal + coronal (flag on)', async ({ page }) => {
  await enterLocalViewer(page);

  const files = ensureFixture('ct-axial-300');
  await page.locator('[data-testid="local-import-input"]').setInputFiles(files);
  await expect(page.locator('[data-testid="unified-viewport-element:panel_0"] canvas'))
    .toBeVisible({ timeout: 30_000 });

  await setPreset(page, 'mpr-2x2');
  for (const id of ['panel_1', 'panel_2']) {
    await expect(page.locator(`[data-testid="unified-viewport-element:${id}"] canvas`))
      .toBeVisible({ timeout: 30_000 });
  }

  // Wait for the shared source volume to finish loading before deriving the labelmap.
  await expect.poll(() => volumeReady(page), { timeout: 30_000 }).toBe(true);

  // Isolate from any segmentation a prior spec left in the worker-scoped app.
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());

  // Create + attach a labelmap segmentation across all MPR panels; pick the brush.
  await createLabelmap(page, 'Signal-3 SEG');
  // A brush large enough that the painted region spans the volume centre, so it
  // crosses the sagittal/coronal planes (which sit at the volume centre).
  await setBrushSize(page, 60);
  await setTool(page, 'Brush');

  // Nothing painted yet.
  expect(await paintedVoxels(page)).toBe(0);

  // Baseline screenshots of the sagittal + coronal canvases (pre-brush).
  const sagCanvas = page.locator('[data-testid="unified-viewport-element:panel_1"] canvas');
  const corCanvas = page.locator('[data-testid="unified-viewport-element:panel_2"] canvas');
  const sagBefore = await sagCanvas.screenshot();
  const corBefore = await corCanvas.screenshot();

  // Brush-paint on the axial panel via a real gesture.
  const axBox = await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox();
  expect(axBox).not.toBeNull();
  await brushStroke(page, axBox!);

  // Structural: the stroke wrote non-zero voxels into the labelmap.
  await expect
    .poll(() => paintedVoxels(page), {
      timeout: 15_000,
      message: 'the brush stroke should have painted labelmap voxels',
    })
    .toBeGreaterThan(0);

  // Visual: the one 3D labelmap renders resampled on the sagittal + coronal
  // panels → their canvases changed vs the pre-brush baseline.
  await expect
    .poll(async () => !(await sagCanvas.screenshot()).equals(sagBefore), {
      timeout: 15_000,
      message: 'sagittal panel should show the resampled paint',
    })
    .toBe(true);
  await expect
    .poll(async () => !(await corCanvas.screenshot()).equals(corBefore), {
      timeout: 15_000,
      message: 'coronal panel should show the resampled paint',
    })
    .toBe(true);
});
