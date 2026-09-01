/**
 * P1.7d (part 1) — signal 6: rapid layout swaps lose nothing + single dirty flag
 * (offline, flag on).
 *
 * Create + paint a labelmap on an MPR-2×2 of one CT, then cycle layouts
 * (MPR → single → MPR → single → MPR). After the churn — which destroys and
 * recreates the non-axial panels — the segmentation must survive: exactly ONE
 * Cornerstone segmentation (no duplicates), the same painted-voxel count (no
 * loss), a single dirty flag still set, and the recreated panels get their
 * representation re-attached (no structure lost on a remounted panel).
 *
 * (Signal 6's "save once produces correct file" is verified separately.)
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
  getDirtyFlag: () => boolean;
  getCsSegmentationCount: () => number;
  getViewportSegRepCount: (panelId: string) => number;
}
type Win = { __XNAT_E2E__: E2EHooks };

const volumeReady = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.isUnifiedVolumeReady());
const resetSegs = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
const createLabelmap = (page: Page, label: string) =>
  page.evaluate((l) => (window as unknown as Win).__XNAT_E2E__.createUnifiedLabelmapSegmentation(l), label);
const setBrushSize = (page: Page, n: number) =>
  page.evaluate((s) => (window as unknown as Win).__XNAT_E2E__.setUnifiedBrushSize(s), n);
const setTool = (page: Page, t: string) =>
  page.evaluate((tn) => (window as unknown as Win).__XNAT_E2E__.setActiveUnifiedTool(tn), t);

const setPreset = (page: Page, p: 'single' | 'mpr-2x2') =>
  page.evaluate((pp) => (window as unknown as Win).__XNAT_E2E__.setLayoutPreset(pp), p);
const paintedVoxels = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelCount());
const segCount = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getCsSegmentationCount());
const dirty = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getDirtyFlag());
const repCount = (page: Page, id: string) =>
  page.evaluate((p) => (window as unknown as Win).__XNAT_E2E__.getViewportSegRepCount(p), id);

async function waitMprPanels(page: Page) {
  for (const id of ['panel_1', 'panel_2', 'panel_3']) {
    await expect(page.locator(`[data-testid="unified-viewport-element:${id}"] canvas`))
      .toBeVisible({ timeout: 30_000 });
  }
}

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

test('rapid layout swaps lose no structures + keep one dirty flag (flag on)', async ({ page }) => {
  await enterLocalViewer(page);
  const files = ensureFixture('ct-axial-300');
  await page.locator('[data-testid="local-import-input"]').setInputFiles(files);
  await expect(page.locator('[data-testid="unified-viewport-element:panel_0"] canvas'))
    .toBeVisible({ timeout: 30_000 });

  // Briefly enter MPR to capture a clean sagittal baseline (CT only, no seg).
  await setPreset(page, 'mpr-2x2');
  await waitMprPanels(page);
  await expect.poll(() => volumeReady(page), { timeout: 30_000 }).toBe(true);
  await resetSegs(page);
  const sagCanvas = page.locator('[data-testid="unified-viewport-element:panel_1"] canvas');
  await page.waitForTimeout(500);
  const sagClean = await sagCanvas.screenshot();

  // Create + paint the segmentation while in SINGLE — so only panel_0 ever has
  // it; panels 1–3 will be brand-new when we return to MPR.
  await setPreset(page, 'single');
  await expect(page.locator('[data-testid="unified-viewport-element:panel_1"]')).toHaveCount(0, { timeout: 15_000 });
  await createLabelmap(page, 'Signal-6 SEG');
  await setBrushSize(page, 60);
  await setTool(page, 'Brush');
  const axBox = await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox();
  expect(axBox).not.toBeNull();
  await brushStroke(page, axBox!);

  await expect.poll(() => paintedVoxels(page), { timeout: 15_000 }).toBeGreaterThan(0);
  const paintedBaseline = await paintedVoxels(page);
  expect(await segCount(page)).toBe(1);
  expect(await dirty(page)).toBe(true);

  // Switch to MPR — panels 1–3 are NEW and must receive the segmentation
  // (they never had it). Then churn layouts a couple more times.
  await setPreset(page, 'mpr-2x2');
  await waitMprPanels(page);
  for (let i = 0; i < 2; i++) {
    await setPreset(page, 'single');
    await expect(page.locator('[data-testid="unified-viewport-element:panel_3"]')).toHaveCount(0, { timeout: 15_000 });
    await setPreset(page, 'mpr-2x2');
    await waitMprPanels(page);
  }

  // No structures lost, no duplicates: still exactly one segmentation with the
  // same painted-voxel count, and one dirty flag still set.
  expect(await segCount(page)).toBe(1);
  await expect
    .poll(() => paintedVoxels(page), { timeout: 15_000, message: 'painted voxels must survive layout swaps' })
    .toBe(paintedBaseline);
  expect(await dirty(page)).toBe(true);

  // The brand-new sagittal panel received the segmentation (re-attach) — both as
  // a representation entry AND visibly (its canvas now differs from the clean
  // no-seg baseline). Without re-attach, panel_1 never had the seg → blank.
  await expect
    .poll(() => repCount(page, 'panel_1'), {
      timeout: 15_000,
      message: 'new sagittal panel should have the segmentation attached',
    })
    .toBeGreaterThanOrEqual(1);
  await expect
    .poll(async () => !(await sagCanvas.screenshot()).equals(sagClean), {
      timeout: 15_000,
      message: 'new sagittal panel should visibly show the structure',
    })
    .toBe(true);
});
