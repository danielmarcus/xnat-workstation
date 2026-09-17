/**
 * Exactly ONE thing outlines a viewport: the app's active-viewport ring.
 *
 * Reported: "sometimes there isn't one at all, sometimes it's blue, sometimes it's yellow."
 * Measured, there were two independent outlines:
 *
 *  - The intended one — a light gray (zinc-400) ring drawn only on the viewport with
 *    data-active="true". Absent elsewhere by design, which is the "sometimes there isn't
 *    one".
 *  - Chrome's `:focus-visible` UA outline, measured as `rgb(229,151,0) auto 1px` — the
 *    macOS system accent colour, so its colour varies per machine and is nothing the app
 *    chose. That is the "yellow".
 *
 * The UA ring reached the viewport because globals.css reset `outline: none` for three
 * LEGACY testids (cornerstone-viewport-canvas, mpr-viewport-canvas,
 * oriented-viewport-canvas) and the unified path renders `unified-viewport:` instead — the
 * reset stopped covering the viewport that actually renders.
 *
 * It only appears sometimes because :focus-visible needs the last interaction to have been
 * keyboard: changing the orientation dropdown by keyboard hands focus back to the panel
 * (ViewportOverlay), and the ring lands then but not after a plain mouse click.
 *
 * The ring is asserted in PIXELS, not by reading box-shadow off the element. The first
 * version of this file checked the computed property and passed while the ring was
 * invisible on every viewport that had an image in it: `ring-inset` is an inset
 * box-shadow on the container, and the canvas filling that container paints straight over
 * it. Measured then: 12 of 12 edge samples sky-blue on an empty viewport, 0 of 12 on a
 * loaded one. The property was there the whole time.
 */
import { test, expect } from '../../fixtures/electron-app';
import { loadFixture } from '../../helpers/local-fixture';

const outlineOf = (page: import('@playwright/test').Page, panelId: string) =>
  page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="unified-viewport:${id}"]`) as HTMLElement;
    const cs = getComputedStyle(el);
    return {
      outlineStyle: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
      focusVisible: el.matches(':focus-visible'),
      active: el.getAttribute('data-active'),
    };
  }, panelId);

/**
 * How many of 12 samples around the viewport's edge are actually sky-500. Pixels, because
 * the CSS property can be present while nothing is drawn.
 */
async function skyEdgeSamples(page: import('@playwright/test').Page, panelId: string): Promise<number> {
  const shot = (await page.locator(`[data-testid="unified-viewport:${panelId}"]`).screenshot()).toString('base64');
  return page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    const at = (x: number, y: number) => {
      const i = (y * c.width + x) * 4;
      return [px[i], px[i + 1], px[i + 2]];
    };
    const pts: number[][] = [];
    for (const f of [0.25, 0.5, 0.75]) {
      pts.push(at(Math.floor(c.width * f), 1));
      pts.push(at(Math.floor(c.width * f), c.height - 2));
      pts.push(at(1, Math.floor(c.height * f)));
      pts.push(at(c.width - 2, Math.floor(c.height * f)));
    }
    // zinc-400, #a1a1aa. Tolerance is tight (±25) on purpose: a loose one would match the
    // grayscale image itself, and the ring is a gray on a gray picture. The viewport's
    // unringed edge measures near-black, so a tight window separates them cleanly.
    return pts.filter(
      (p) => Math.abs(p[0] - 161) < 25 && Math.abs(p[1] - 161) < 25 && Math.abs(p[2] - 170) < 25,
    ).length;
  }, shot);
}

test('a keyboard-focused viewport shows no second outline from the browser', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');

  // Reproduce the condition that grants :focus-visible — a keyboard interaction, then the
  // focus hand-back the orientation dropdown performs.
  await page.keyboard.press('Tab');
  await page.evaluate(() =>
    (document.querySelector('[data-testid="unified-viewport:panel_0"]') as HTMLElement)?.focus(),
  );

  const o = await outlineOf(page, 'panel_0');
  expect(o.focusVisible, 'the condition under test must actually hold, or this proves nothing').toBe(true);
  expect(
    o.outlineStyle,
    'a focused viewport must not draw a browser outline on top of the app’s active ring',
  ).toBe('none');
  expect(
    await skyEdgeSamples(page, 'panel_0'),
    'the app’s own active ring is the one marker and must remain VISIBLE',
  ).toBeGreaterThan(8);
});

test('only the active viewport is outlined, and only in the app’s own colour', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.locator('[title^="Viewport layout"]').click();
  await page.getByRole('button', { name: '1 x 2' }).click();
  await page.locator('[data-testid="unified-viewport:panel_1"]').waitFor({ state: 'attached', timeout: 20_000 });

  await page.locator('[data-testid="unified-viewport:panel_0"]').click({ position: { x: 20, y: 20 } });
  const a = await outlineOf(page, 'panel_0');
  const b = await outlineOf(page, 'panel_1');
  expect(a.active).toBe('true');
  // panel_0 holds the loaded scan — the case where the ring used to be painted over.
  expect(await skyEdgeSamples(page, 'panel_0'), 'the active viewport carries a VISIBLE ring').toBeGreaterThan(8);
  expect(
    await skyEdgeSamples(page, 'panel_1'),
    'an inactive viewport carries no ring — that is the intent, not a gap',
  ).toBe(0);
  expect(b.outlineStyle, 'and no browser outline either').toBe('none');
});
