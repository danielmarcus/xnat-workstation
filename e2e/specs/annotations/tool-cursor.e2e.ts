/**
 * Switching tools leaves exactly one cursor behind — and never a "forbidden" one on a
 * tool that works.
 *
 * Reported as cursors that "aren't matched right and don't update right". Measured: after
 * a Brush → Sph. Brush switch the viewport carried TWO cursor circles, and the count
 * varied with whichever tool had been selected before. Cornerstone clears a brush cursor
 * when BrushTool stops being active, but every brush variant IS BrushTool — only the
 * strategy differs — so switching between them never triggered that clear.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

type Win = { __XNAT_E2E__: { resetUnifiedSegmentations: () => void } };

const cursorState = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector('[data-testid="unified-viewport-element:panel_0"]') as HTMLElement;
    return {
      circles: el?.querySelectorAll('svg circle').length ?? 0,
      css: getComputedStyle(el).cursor.slice(0, 20),
    };
  });

test('switching between brush variants never leaves a second cursor behind', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();

  const box = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;
  const hover = async () => {
    await page.mouse.move(box.x + box.width / 2 - 20, box.y + box.height / 2 - 20);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
    await page.waitForTimeout(350);
  };

  // Walk the whole brush family in sequence — the case that accumulated cursors.
  //
  // Dyn. Thresh legitimately draws TWO: Cornerstone's circularCursor composition adds a
  // second ring at `dynamicRadiusInCanvas` to show the region it will sample. That is the
  // visual feedback for the sampling-radius control, so it is asserted, not tolerated.
  // Eraser / Sph. Eraser retired into the shared edit mode (edit-mode.e2e.ts covers it).
  for (const tool of ['Brush', 'Sph. Brush', 'Threshold', 'Sph. Thresh', 'Dyn. Thresh', 'Brush']) {
    await panel.getByRole('button', { name: tool, exact: true }).click();
    await hover();
    const expected = tool === 'Dyn. Thresh' ? 2 : 1;
    const { circles } = await cursorState(page);
    expect(circles, `"${tool}" must show ${expected} cursor ring(s), not ${circles}`).toBe(expected);
  }
});

test('a usable tool never shows a forbidden cursor', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();

  const box = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;
  // Every enabled SEG tool, in one pass — the ordering that produced "not-allowed" before.
  //
  // The pointer must land somewhere NEW each time. Moving it to coordinates it already
  // occupies emits no mousemove, so the cursor is never re-asserted and the spec reads a
  // stale value — which cost an hour of chasing a fix that was already working.
  const tools = ['Region', 'Region+', 'Rect Multi', 'Paint Fill', 'Contour Fill', 'Select',
                 'Circle', 'Rect', 'Sphere'];
  for (const [i, tool] of tools.entries()) {
    await panel.getByRole('button', { name: tool, exact: true }).click();
    await page.mouse.move(box.x + box.width / 2 + i * 3, box.y + box.height / 2 + i * 2, { steps: 2 });
    await page.waitForTimeout(250);
    const { css } = await cursorState(page);
    expect(css, `"${tool}" is selectable and usable, so it must not show a forbidden cursor`)
      .not.toContain('not-allowed');
  }
});
