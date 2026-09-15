/**
 * The brush hover cursor must not persist onto slices it was never hovered on.
 *
 * Reported as "the mask shows up on other slices when I scroll". The labelmap data was
 * always correct — a stroke on slice 8 writes voxels ONLY to slice 8 — but a red circle
 * stayed drawn on every slice the user scrolled to, which reads as the mask.
 *
 * Cause: Cornerstone's BrushTool keeps its cursor in `_hoverData` and clears it only when
 * the tool stops being active (onSetToolPassive / Enabled / Disabled). Its
 * `renderAnnotation` checks that hover data exists and that the viewport is in the render
 * list, but never that the CURRENT SLICE is the one the cursor was hovered on. With no
 * hook for "pointer left" or "slice changed", one hover left the circle drawn everywhere,
 * even with the pointer outside the viewport. unifiedToolService now wires that lifecycle.
 *
 * Asserts both halves: the voxels stay on one slice, AND nothing is drawn in the
 * annotation layer after scrolling away.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

type Hooks = {
  setActiveUnifiedTool: (t: string) => void;
  createUnifiedLabelmapSegmentation: (l?: string) => Promise<unknown>;
  setUnifiedBrushSize: (n: number) => void;
  isUnifiedVolumeReady: () => boolean;
  resetUnifiedSegmentations: () => void;
  scrollActiveViewport: (d: number) => void;
  getPaintedVoxelsPerSlice: () => Array<{ segmentationId: string; dims: [number, number, number]; perSlice: number[] }>;
};
type Win = { __XNAT_E2E__: Hooks };

/** Shapes drawn in the viewport's annotation layer (defs is structural, not a shape). */
const drawnShapes = (page: Page) =>
  page.evaluate(() => {
    const vp = document.querySelector('[data-testid="unified-viewport-element:panel_0"]')!;
    const svg = vp.querySelector('svg.svg-layer');
    if (!svg) return [];
    return Array.from(svg.children)
      .filter((c) => c.tagName.toLowerCase() !== 'defs')
      .map((c) => c.tagName.toLowerCase());
  });

test('the brush cursor does not follow you to other slices', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.isUnifiedVolumeReady()), { timeout: 30_000 })
    .toBe(true);
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.createUnifiedLabelmapSegmentation('Slice SEG'));
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setUnifiedBrushSize(30));
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setActiveUnifiedTool('Brush'));

  const box = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx - 20, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 20, cy, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(1200);

  // The data half: a 2D stroke writes to exactly one slice.
  const before = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelsPerSlice());
  const painted = before[0].perSlice.map((n, i) => ({ i, n })).filter((s) => s.n > 0);
  expect(painted.length, `a 2D stroke painted ${painted.length} slices: ${JSON.stringify(painted)}`).toBe(1);

  // The rendering half: scroll away, with the brush STILL selected — nothing may be drawn.
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.scrollActiveViewport(4));
  await page.waitForTimeout(800);

  const after = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelsPerSlice());
  expect(after[0].perSlice.map((n, i) => ({ i, n })).filter((s) => s.n > 0)).toEqual(painted);

  const shapes = await drawnShapes(page);
  expect(shapes, `brush cursor still drawn after scrolling to another slice: ${shapes.join(', ')}`).toEqual([]);
});
