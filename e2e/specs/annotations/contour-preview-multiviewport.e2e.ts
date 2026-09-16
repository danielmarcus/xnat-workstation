/**
 * A contour being drawn is shown in the right anatomy in EVERY viewport, not just the one
 * it is being drawn in.
 *
 * Reported with a screenshot: one scan open twice at 163% and 133%, a freehand stroke in
 * progress appearing at a different anatomic location in the second viewport and snapping
 * into place on mouse-up.
 *
 * Cause is upstream and explicit — `planarFreehandROITool/renderMethods.js`:
 *
 *     function renderContourBeingDrawn(enabledElement, svgDrawingHelper, annotation) {
 *       const { canvasPoints } = this.drawData;
 *       drawPolylineSvg(svgDrawingHelper, annotation.annotationUID, '1', canvasPoints, options);
 *     }
 *
 * `enabledElement.viewport` is never consulted, so the source viewport's canvas
 * coordinates are painted verbatim into every other viewport. Correct for one viewport;
 * wrong the moment a series is open twice.
 *
 * Read from the SVG layer rather than from pixels: the element's position and WIDTH
 * together distinguish "wrong place" from "wrong scale", and both were wrong.
 *
 * Two mistakes made this invisible to the first specs written for it, and either one alone
 * is enough to hide it:
 *
 *  - **A centred stroke.** The canvas centre is the fixed point of a zoom, so a shape
 *    centred there has the same centroid at every zoom, whether its geometry went through
 *    world space or was replayed in canvas space.
 *  - **A closed loop.** Returning near the start auto-completes the contour, which commits
 *    it BEFORE mouse-up — the committed render maps through world correctly, so the
 *    preview under test is never on screen. The give-away was an SVG `path` (committed)
 *    where a `polyline` (in progress) was expected.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadSameSeriesTwice } from '../../helpers/local-fixture';

type Win = { __XNAT_E2E__: {
  zoomViewportBy: (viewportId: string, factor: number) => void;
  resetUnifiedSegmentations: () => void;
}; };

interface Shape { tag: string; cx: number; cy: number; w: number }

/** Every annotation shape drawn on each viewport, positioned as a fraction of it. */
const shapesPerViewport = (page: Page): Promise<Record<string, Shape[]>> =>
  page.evaluate(() =>
    Object.fromEntries(
      ['panel_0', 'panel_1'].map((id) => {
        const el = document.querySelector(`[data-testid="unified-viewport-element:${id}"]`);
        const host = el?.getBoundingClientRect();
        const shapes = Array.from(el?.querySelectorAll('svg polyline, svg path, svg polygon') ?? []).map((n) => {
          const r = (n as SVGGraphicsElement).getBoundingClientRect();
          return {
            tag: n.tagName,
            cx: host ? +(((r.x + r.width / 2) - host.x) / host.width).toFixed(3) : 0,
            cy: host ? +(((r.y + r.height / 2) - host.y) / host.height).toFixed(3) : 0,
            w: Math.round(r.width),
          };
        });
        return [id, shapes];
      }),
    ),
  );

/**
 * An OPEN, OFF-CENTRE stroke, left mid-gesture with the button still down — see the header
 * for why each of those three properties is load-bearing.
 */
async function beginOpenStroke(page: Page, viewportId: string) {
  const box = (await page.locator(`[data-testid="unified-viewport-element:${viewportId}"] canvas`).boundingBox())!;
  const cx = box.x + box.width * 0.3;
  const cy = box.y + box.height * 0.35;
  const r = Math.min(box.width, box.height) * 0.15;
  await page.mouse.move(cx - r, cy - r);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(cx - r + (2 * r * i) / 20, cy - r + (2 * r * i) / 20, { steps: 2 });
  }
}

for (const tool of [
  { button: 'New Structure (RTSTRUCT)', label: 'freehand' },
]) {
  test(`an in-progress ${tool.label} contour is placed by anatomy in both viewports`, async ({ page }) => {
    await loadSameSeriesTwice(page, 'ct-axial-300', 'slice');
    await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());

    const panel = page.locator('[data-testid="annotations-side-panel"]');
    if (!(await panel.isVisible())) {
      await page.getByRole('button', { name: 'Show segmentation panel' }).click();
    }
    await expect(panel).toBeVisible({ timeout: 15_000 });

    // Different zoom in the two viewports — with equal zoom, canvas-space and world-space
    // rendering coincide and nothing can be detected.
    await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.zoomViewportBy('panel_0', 1.8));
    await page.waitForTimeout(400);

    await page.locator('[data-testid="unified-viewport:panel_0"]').click({ position: { x: 20, y: 20 } });
    await panel.getByRole('button', { name: tool.button }).click();
    await panel.getByLabel('Rename container').press('Enter');
    const memberRename = panel.getByLabel('Rename member');
    if (await memberRename.count()) await memberRename.press('Enter');

    await beginOpenStroke(page, 'panel_0');
    const during = await shapesPerViewport(page);
    await page.mouse.up();
    await page.waitForTimeout(900);
    const after = await shapesPerViewport(page);

    const pick = (s: Shape[] | undefined) => s?.[0];
    const duringSource = pick(during.panel_0);
    const duringOther = pick(during.panel_1);
    const afterOther = pick(after.panel_1);

    expect(duringSource, 'a stroke must be previewed while drawing').toBeTruthy();
    expect(duringSource!.tag, 'the shape under test must be the in-progress preview, not a committed contour')
      .toBe('polyline');
    expect(duringOther, 'the second viewport shows the same scan, so it must preview the stroke too').toBeTruthy();
    expect(afterOther, 'the committed contour must render in the second viewport').toBeTruthy();

    // The committed render is correct by construction (it maps through world space), so it
    // is the reference: the preview must already be there.
    expect(
      Math.hypot(duringOther!.cx - afterOther!.cx, duringOther!.cy - afterOther!.cy),
      'the in-progress contour must sit where the finished one lands — no snap on mouse-up',
    ).toBeLessThan(0.03);
    expect(
      Math.abs(duringOther!.w - afterOther!.w) / Math.max(afterOther!.w, 1),
      'and at the same scale — this viewport is at a different zoom from the one being drawn in',
    ).toBeLessThan(0.15);

    // The positive control for the whole spec: if the two viewports render the preview
    // identically, the zoom difference is not reaching the geometry and everything above
    // would pass vacuously.
    expect(
      Math.abs(duringOther!.w - duringSource!.w),
      'the two viewports are at different zooms, so the preview cannot be the same size in both',
    ).toBeGreaterThan(5);
  });
}
