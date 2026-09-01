/**
 * Toolbar undo/redo (user-reported: "undo/redo functions are not currently working").
 *
 * The toolbar Undo/Redo buttons are `disabled={!canUndo}` / `disabled={!canRedo}`, driven
 * by segmentationStore.canUndo/canRedo, refreshed by segmentationService.refreshUndoState.
 * That refresh fired only after undo/redo/paste — NOT after a normal edit (brush, contour
 * fill, interpolation). So after a brush stroke the global history HAS an undo entry, but
 * the store flag stays false → the toolbar button stays disabled → "undo not working".
 *
 * This drives the REAL toolbar path (segmentationService.undo/redo) and asserts the
 * canUndo/canRedo flags track the edit. RED: canUndo stays false after a stroke (button
 * disabled). GREEN once refreshUndoState fires on edit completion.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { ensureFixture, enterLocalViewer } from '../helpers/local-fixture';

interface E2EHooks {
  setActiveUnifiedTool: (toolName: string) => void;
  createUnifiedLabelmapSegmentation: (label?: string) => Promise<{ segmentationId: string; segmentIndex: number }>;
  setUnifiedBrushSize: (size: number) => void;
  getPaintedVoxelCount: () => number;
  isUnifiedVolumeReady: () => boolean;
  resetUnifiedSegmentations: () => void;
  getUndoRedoState: () => { canUndo: boolean; canRedo: boolean };
  triggerToolbarUndo: () => void;
  triggerToolbarRedo: () => void;
}
type Win = { __XNAT_E2E__: E2EHooks };

const hook = <T,>(page: Page, fn: keyof E2EHooks, ...args: unknown[]): Promise<T> =>
  page.evaluate(
    ([f, a]) => (window as unknown as Win).__XNAT_E2E__[f as keyof E2EHooks].apply(null, a as never),
    [fn, args] as const,
  ) as Promise<T>;

async function brushStroke(page: Page, box: { x: number; y: number; width: number; height: number }) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const d = Math.min(box.width, box.height) * 0.12;
  await page.mouse.move(cx - d, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy, { steps: 4 });
  await page.mouse.move(cx + d, cy, { steps: 4 });
  await page.mouse.up();
}

test('the toolbar Undo button enables after a brush edit, and undo/redo round-trips (user bug)', async ({ page }) => {
  await enterLocalViewer(page);
  const files = ensureFixture('ct-axial-300');
  await page.locator('[data-testid="local-import-input"]').setInputFiles(files);
  await expect(page.locator('[data-testid="unified-viewport-element:panel_0"] canvas')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => hook<boolean>(page, 'isUnifiedVolumeReady'), { timeout: 30_000 }).toBe(true);
  await hook(page, 'resetUnifiedSegmentations');

  await hook(page, 'createUnifiedLabelmapSegmentation', 'Undo SEG');
  await hook(page, 'setUnifiedBrushSize', 40);
  await hook(page, 'setActiveUnifiedTool', 'Brush');

  const box = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;
  expect(box).not.toBeNull();
  await brushStroke(page, box);
  const painted = await expectPainted(page, 1);

  // CONTRACT: after the edit, Undo is available (the toolbar button is enabled).
  await expect
    .poll(async () => (await hook<{ canUndo: boolean }>(page, 'getUndoRedoState')).canUndo, {
      timeout: 10_000,
      message: 'the toolbar Undo button should enable after a brush edit',
    })
    .toBe(true);

  // Undo reverts the stroke and enables Redo.
  await hook(page, 'triggerToolbarUndo');
  await expect.poll(() => hook<number>(page, 'getPaintedVoxelCount'), { timeout: 10_000 }).toBeLessThan(painted);
  expect((await hook<{ canRedo: boolean }>(page, 'getUndoRedoState')).canRedo).toBe(true);

  // Redo restores the stroke.
  await hook(page, 'triggerToolbarRedo');
  await expect.poll(() => hook<number>(page, 'getPaintedVoxelCount'), { timeout: 10_000 }).toBeGreaterThanOrEqual(painted);
});

async function expectPainted(page: Page, min: number): Promise<number> {
  await expect.poll(() => hook<number>(page, 'getPaintedVoxelCount'), { timeout: 15_000 }).toBeGreaterThanOrEqual(min);
  return hook<number>(page, 'getPaintedVoxelCount');
}
