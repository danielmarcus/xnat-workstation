/**
 * Phase 4 — signal 13 (inter-slice contour interpolation): drawing a contour on two
 * non-adjacent slices of the same structure auto-generates the in-between contours.
 *
 * Coverage for a previously-untested acceptance signal. Inter-slice contour
 * interpolation is driven by Cornerstone's InterpolationManager (a global registry of
 * contour-segmentation tool names); on the unified path it is active, so drawing a
 * contour on two non-adjacent slices of the same structure auto-generates the
 * in-between contours, and write-through (B5) accepts them immediately.
 *
 * (Note: the per-tool `interpolation.enabled` config the legacy group set is inert here
 * — verified by forcing it false, interpolation still ran — so the Settings
 * interpolation toggle does not currently gate the unified path; that is a separate,
 * deeper concern, tracked apart from signal 13 which only requires interpolation to work.)
 *
 * REAL gestures (two freehand loops via mouse events on two slices, no setter shortcut).
 * Contract: after the second contour, the structure spans MORE than the two drawn
 * slices — the interpolated contours fill the gap.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { ensureFixture, enterLocalViewer } from '../helpers/local-fixture';

interface E2EHooks {
  setActiveUnifiedTool: (toolName: string) => void;
  isUnifiedVolumeReady: () => boolean;
  resetUnifiedSegmentations: () => void;
  createUnifiedContourSeg: (label?: string) => { segmentationId: string; segmentIndex: number };
  scrollActiveViewport: (delta: number) => void;
  getActiveContourSnapshot: (panelId?: string, segmentationId?: string) => { total: number; sliceIndices: number[] };
}
type Win = { __XNAT_E2E__: E2EHooks };

const hook = <T,>(page: Page, fn: keyof E2EHooks, ...args: unknown[]): Promise<T> =>
  page.evaluate(
    ([f, a]) => (window as unknown as Win).__XNAT_E2E__[f as keyof E2EHooks].apply(null, a as never),
    [fn, args] as const,
  ) as Promise<T>;

/** Draw a closed freehand-contour loop centred on the canvas via real mouse events. */
async function drawContourLoop(page: Page, box: { x: number; y: number; width: number; height: number }) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const r = Math.min(box.width, box.height) * 0.4;
  const N = 32;
  await page.mouse.move(cx + r, cy);
  await page.mouse.down();
  for (let i = 1; i <= N; i++) {
    const a = (i / N) * 2 * Math.PI;
    await page.mouse.move(cx + r * Math.cos(a), cy + r * Math.sin(a), { steps: 2 });
  }
  await page.mouse.move(cx + r, cy, { steps: 2 });
  await page.mouse.up();
}

test('drawing a contour on two slices interpolates the contours between them (signal 13)', async ({ page }) => {
  await enterLocalViewer(page);
  const files = ensureFixture('ct-axial-300');
  await page.locator('[data-testid="local-import-input"]').setInputFiles(files);
  await expect(page.locator('[data-testid="unified-viewport-element:panel_0"] canvas')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => hook<boolean>(page, 'isUnifiedVolumeReady'), { timeout: 30_000 }).toBe(true);

  await hook(page, 'resetUnifiedSegmentations');
  const { segmentationId } = await hook<{ segmentationId: string }>(page, 'createUnifiedContourSeg', 'Interp Structure');
  await hook(page, 'setActiveUnifiedTool', 'FreehandContour');

  const ax = page.locator('[data-testid="unified-viewport-element:panel_0"] canvas');
  const box = (await ax.boundingBox())!;
  expect(box).not.toBeNull();

  // Contour #1 on the current slice.
  await drawContourLoop(page, box);
  await expect
    .poll(async () => (await hook<{ total: number }>(page, 'getActiveContourSnapshot', 'panel_0', segmentationId)).total, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(1);

  // Scroll five slices away and draw contour #2 → leaves a 4-slice gap to interpolate.
  await hook(page, 'scrollActiveViewport', 5);
  await page.waitForTimeout(300);
  await drawContourLoop(page, box);
  await page.waitForTimeout(500);

  // CONTRACT: interpolation filled the gap — the structure now has MORE than the two
  // drawn contours.
  await expect
    .poll(async () => (await hook<{ total: number }>(page, 'getActiveContourSnapshot', 'panel_0', segmentationId)).total, {
      timeout: 15_000,
      message: 'interpolation should generate contours between the two drawn slices',
    })
    .toBeGreaterThan(2);
});
