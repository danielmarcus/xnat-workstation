/**
 * Pixel readback from a viewport, for assertions about what is actually DRAWN.
 *
 * The acceptance contract for "the annotation appears in the other viewport" is about
 * pixels, not about a panel row or a Cornerstone representation record (CLAUDE.md §1). A
 * spec asserting the container is LISTED passes while the viewport draws nothing.
 *
 * Two things this has to get right, both learned by getting them wrong:
 *
 *  - **Screenshot the viewport ELEMENT, not its canvas.** Cornerstone renders labelmaps
 *    into the canvas but annotations — contours, measurements, handles — onto an SVG layer
 *    over it. A canvas-only screenshot silently omits every contour.
 *  - **Diff against a baseline.** A viewport is full of coloured chrome: the active-panel
 *    border, orientation markers, the scale bar, the overlay readouts. Counting coloured
 *    pixels absolutely measures those, and a before/after comparison then returns
 *    byte-identical numbers whatever the annotation does.
 *
 * Screenshot-then-decode rather than reading the WebGL context: Cornerstone's volume
 * viewports keep no readable drawing buffer, so getImageData on their canvas is blank.
 */
import type { Page } from '@playwright/test';

export interface DrawnRegion {
  /** Changed pixels as a fraction of the viewport. */
  fraction: number;
  /** Their centroid in viewport FRACTIONS (0..1), or null when nothing changed. */
  centroid: { x: number; y: number } | null;
  count: number;
}

/** A PNG of the whole viewport (canvas + SVG annotation layer + chrome), base64. */
export async function captureViewport(page: Page, viewportId: string): Promise<string> {
  const shot = await page.locator(`[data-testid="unified-viewport-element:${viewportId}"]`).first().screenshot();
  return shot.toString('base64');
}

/**
 * Where the picture changed between two captures, and by how much.
 *
 * The centroid is in fractions rather than pixels so viewports of different sizes are
 * directly comparable, and so a single tolerance means the same thing everywhere.
 */
export async function changedRegion(page: Page, before: string, after: string): Promise<DrawnRegion> {
  return page.evaluate(async ([a, b]) => {
    const decode = async (data: string) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      c.getContext('2d')!.drawImage(img, 0, 0);
      return { ctx: c.getContext('2d')!, w: c.width, h: c.height };
    };
    const A = await decode(a);
    const B = await decode(b);
    if (A.w !== B.w || A.h !== B.h) return { fraction: 0, centroid: null, count: -1 };
    const pa = A.ctx.getImageData(0, 0, A.w, A.h).data;
    const pb = B.ctx.getImageData(0, 0, B.w, B.h).data;
    const total = pa.length / 4;
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let p = 0; p < total; p++) {
      const i = p * 4;
      // Sum of absolute channel differences; 30 clears JPEG-free PNG noise and the
      // sub-pixel jitter of anti-aliased chrome without needing an exact match.
      const d =
        Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]);
      if (d > 30) {
        sx += (p % A.w) / A.w;
        sy += Math.floor(p / A.w) / A.h;
        n += 1;
      }
    }
    return { fraction: n / total, centroid: n === 0 ? null : { x: sx / n, y: sy / n }, count: n };
  }, [before, after] as const);
}
