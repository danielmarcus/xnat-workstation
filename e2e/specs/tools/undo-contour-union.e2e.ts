/**
 * Undo after Cornerstone 5 unions two overlapping contours restores the first contour.
 *
 * v5 merges overlapping contours of one segment on a plane into a single contour, and
 * rewrites that stroke's undo entry to "restore the contours as they were before the
 * union" — via `DefaultHistoryMemo.replaceCurrentMemo`, which edits the ring in place and
 * never calls `push`. The app's per-container undo (the path the toolbar button and
 * Ctrl+Z take whenever a container is active) is fed from `push`, so it would still hold
 * the ORIGINAL entry for the second stroke: undoing it removes a contour that no longer
 * exists and leaves the union — the first contour's own outline is gone for good.
 *
 * Drives the real panel, real strokes and the real toolbar Undo, and checks the contours
 * that are drawn.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

type Snapshot = { activeSegmentationId: string | null; total: number };
type Win = {
  __XNAT_E2E__: {
    resetUnifiedSegmentations: () => void;
    getActiveContourSnapshot: (panelId?: string, segmentationId?: string | null) => Snapshot;
  };
};

/** Width of every committed contour outline on the viewport, largest first. */
const outlineWidths = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="unified-viewport-element:panel_0"] svg path'))
      .map((n) => Math.round((n as SVGGraphicsElement).getBoundingClientRect().width))
      .filter((w) => w > 5)
      .sort((a, b) => b - a),
  );

async function loop(page: Page, at: [number, number], scale: number) {
  const box = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;
  const cx = box.x + box.width * at[0];
  const cy = box.y + box.height * at[1];
  const r = Math.min(box.width, box.height) * scale;
  await page.mouse.move(cx + r, cy);
  await page.mouse.down();
  for (let i = 1; i <= 32; i++) {
    const a = (i / 32) * 2 * Math.PI;
    await page.mouse.move(cx + r * Math.cos(a), cy + r * Math.sin(a), { steps: 2 });
  }
  await page.mouse.up();
  await page.waitForTimeout(700);
}

test('undo after two contours are unioned brings the first contour back', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Structure (RTSTRUCT)' }).click();
  await page.keyboard.press('Escape'); // end the create-naming capture, keep default names

  const total = () =>
    page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getActiveContourSnapshot('panel_0').total);

  await loop(page, [0.45, 0.5], 0.15);
  expect(await total(), 'contour A lands').toBe(1);
  const [aWidth] = await outlineWidths(page);
  expect(aWidth, 'contour A is drawn').toBeGreaterThan(20);

  // B overlaps A on its right: the two are unioned into one, wider contour.
  await loop(page, [0.6, 0.5], 0.15);
  expect(await total(), 'overlapping B is unioned with A').toBe(1);
  const [unionWidth] = await outlineWidths(page);
  expect(unionWidth, 'the union is wider than A').toBeGreaterThan(aWidth * 1.3);

  await page.locator('button[title^="Undo"]').click();
  await page.waitForTimeout(700);

  expect(await total(), 'undo must leave contour A, not nothing').toBe(1);
  const [restoredWidth] = await outlineWidths(page);
  expect(
    Math.abs(restoredWidth - aWidth) / aWidth,
    'the contour left after undo must be A as drawn, not the union',
  ).toBeLessThan(0.1);

  // Redo re-applies the union.
  await page.locator('button[title^="Redo"]').click();
  await page.waitForTimeout(700);
  expect(await total(), 'redo leaves one contour').toBe(1);
  const [redoneWidth] = await outlineWidths(page);
  expect(Math.abs(redoneWidth - unionWidth) / unionWidth, 'redo restores the union').toBeLessThan(0.1);
});
