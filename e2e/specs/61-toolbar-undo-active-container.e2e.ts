/**
 * REPRO (user: "undo/redo buttons are not working").
 *
 * Spec 50 drives the toolbar undo path but creates the SEG via the
 * `createUnifiedLabelmapSegmentation` hook, which sets NO active member — so it
 * exercises the GLOBAL history ring. The real app creates/selects a container in
 * the Annotations side panel, which DOES set an active member, switching
 * `segmentationService.undo/redo` + `refreshUndoState` to the PER-CONTAINER path
 * (`perContainerHistory`, keyed by the active member's containerId).
 *
 * This drives the real panel create flow, paints the active container, and asserts
 * the toolbar Undo button enables + actually reverts the stroke.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../helpers/local-fixture';

interface E2EHooks {
  setMultiviewportEnabled: (v: boolean) => void;
  setActiveUnifiedTool: (toolName: string) => void;
  setUnifiedBrushSize: (size: number) => void;
  getPaintedVoxelCount: () => number;
  isUnifiedVolumeReady: () => boolean;
  getUndoRedoState: () => { canUndo: boolean; canRedo: boolean };
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

test('toolbar Undo enables + reverts after painting a panel-created (active) SEG', async ({ page }) => {
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setMultiviewportEnabled(true));
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await expect.poll(() => hook<boolean>(page, 'isUnifiedVolumeReady'), { timeout: 30_000 }).toBe(true);

  // Create a SEG through the REAL side panel (this sets the active member).
  await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await panel.getByLabel('Rename container').press('Enter');
  await expect(panel.getByLabel('Rename member')).toBeVisible({ timeout: 10_000 });
  await panel.getByLabel('Rename member').press('Enter');

  // Paint the active container.
  await hook(page, 'setUnifiedBrushSize', 40);
  await hook(page, 'setActiveUnifiedTool', 'Brush');
  const box = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;
  await brushStroke(page, box);
  const painted = await hook<number>(page, 'getPaintedVoxelCount');
  expect(painted).toBeGreaterThan(0);

  // CONTRACT: the toolbar Undo button enables after the edit.
  await expect
    .poll(() => hook<{ canUndo: boolean }>(page, 'getUndoRedoState').then((s) => s.canUndo), {
      timeout: 10_000,
      message: 'toolbar Undo should enable after painting the active container',
    })
    .toBe(true);

  // The real Undo button reverts the stroke. (Prefix match: the toolbar appends a
  // context suffix, e.g. "Undo (Ctrl+Z) — active container", per the §10 rebuild.)
  await page.locator('button[title^="Undo (Ctrl+Z)"]').click();
  await expect.poll(() => hook<number>(page, 'getPaintedVoxelCount'), { timeout: 10_000 }).toBe(0);

  // …and the real Redo button restores it (round-trip).
  await expect
    .poll(() => hook<{ canRedo: boolean }>(page, 'getUndoRedoState').then((s) => s.canRedo), {
      timeout: 10_000,
      message: 'toolbar Redo should enable after an undo on the active container',
    })
    .toBe(true);
  await page.locator('button[title^="Redo (Ctrl+Shift+Z)"]').click();
  await expect.poll(() => hook<number>(page, 'getPaintedVoxelCount'), { timeout: 10_000 }).toBeGreaterThan(0);
});
