/**
 * Phase 5 — signal 29 (voxel-tool roster), deterministic core + the lock invariant
 * shared with signal 21.
 *
 * Signal 29 requires that each segmentation tool writes/erases correctly and that
 * "locking the active segment blocks each at gesture-start with a hint." The full
 * roster includes GPU growcut tools (region-segment) and contour sculpting that are
 * flaky/heavy to drive headlessly; this spec covers the DETERMINISTIC, non-GPU core
 * that exercises the same write / erase / lock-gate machinery:
 *   1. the 2D brush paints the active segment (voxels 0 → >0);
 *   2. the eraser clears what the brush painted (voxels drop back toward 0);
 *   3. locking the active segment blocks the brush at gesture-start — a stroke over a
 *      locked segment paints NOTHING.
 *
 * All gestures are REAL mouse events through the unified tool group (no setter
 * shortcut into the labelmap). The lock-gate is the load-bearing correctness check:
 * if a locked segment could still be edited, segment locking would be meaningless.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { ensureFixture, enterLocalViewer } from '../helpers/local-fixture';

interface E2EHooks {
  setMultiviewportEnabled: (v: boolean) => void;
  setActiveUnifiedTool: (toolName: string) => void;
  createUnifiedLabelmapSegmentation: (label?: string) => Promise<{ segmentationId: string; segmentIndex: number }>;
  setUnifiedBrushSize: (size: number) => void;
  getPaintedVoxelCount: () => number;
  isUnifiedVolumeReady: () => boolean;
  resetUnifiedSegmentations: () => void;
  setSegmentLocked: (segmentationId: string, segmentIndex: number, locked: boolean) => void;
}
type Win = { __XNAT_E2E__: E2EHooks };

const enableFlag = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setMultiviewportEnabled(true));
const setTool = (page: Page, t: string) => page.evaluate((tn) => (window as unknown as Win).__XNAT_E2E__.setActiveUnifiedTool(tn), t);
const setBrushSize = (page: Page, n: number) => page.evaluate((s) => (window as unknown as Win).__XNAT_E2E__.setUnifiedBrushSize(s), n);
const paintedVoxels = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelCount());
const volumeReady = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.isUnifiedVolumeReady());
const createLabelmap = (page: Page, label: string) =>
  page.evaluate((l) => (window as unknown as Win).__XNAT_E2E__.createUnifiedLabelmapSegmentation(l), label);

/** A short stroke across the centre of a canvas via real mouse events. */
async function stroke(page: Page, box: { x: number; y: number; width: number; height: number }) {
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

async function setup(page: Page) {
  await enableFlag(page);
  await enterLocalViewer(page);
  const files = ensureFixture('ct-axial-300');
  await page.locator('[data-testid="local-import-input"]').setInputFiles(files);
  await expect(page.locator('[data-testid="unified-viewport-element:panel_0"] canvas')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => volumeReady(page), { timeout: 30_000 }).toBe(true);
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
}

test('brush paints the active segment, eraser clears it (signal 29)', async ({ page }) => {
  await setup(page);
  await createLabelmap(page, 'Brush/Eraser SEG');
  await setBrushSize(page, 40);
  await setTool(page, 'Brush');
  expect(await paintedVoxels(page)).toBe(0);

  const box = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;
  expect(box).not.toBeNull();
  await stroke(page, box);
  const painted = await expectPaintedAtLeast(page, 1);

  // Eraser over the same region (a touch larger) clears what was painted.
  await setBrushSize(page, 55);
  await setTool(page, 'Eraser');
  await stroke(page, box);
  await expect
    .poll(() => paintedVoxels(page), { timeout: 15_000, message: 'eraser should clear the painted voxels' })
    .toBeLessThan(painted);
});

test('locking the active segment blocks the brush at gesture-start (signal 29 / 21)', async ({ page }) => {
  await setup(page);
  const { segmentationId, segmentIndex } = await createLabelmap(page, 'Locked SEG');
  await setBrushSize(page, 40);
  await setTool(page, 'Brush');
  expect(await paintedVoxels(page)).toBe(0);

  // Lock the active segment, then attempt to paint it.
  await page.evaluate(
    ([id, idx]) => (window as unknown as Win).__XNAT_E2E__.setSegmentLocked(id as string, idx as number, true),
    [segmentationId, segmentIndex] as const,
  );
  const box = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;
  await stroke(page, box);

  // A locked segment must not accept the edit. Give it the same time a real paint
  // would take to land, then assert nothing was written.
  await page.waitForTimeout(1500);
  expect(await paintedVoxels(page)).toBe(0);
});

/** Poll until the painted-voxel count reaches at least `min`, returning the count. */
async function expectPaintedAtLeast(page: Page, min: number): Promise<number> {
  await expect
    .poll(() => paintedVoxels(page), { timeout: 15_000, message: 'the brush stroke should have painted voxels' })
    .toBeGreaterThanOrEqual(min);
  return paintedVoxels(page);
}
