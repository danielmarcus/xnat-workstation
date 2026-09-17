/**
 * Exactly ONE thing outlines a viewport: the app's active-viewport ring.
 *
 * Reported: "sometimes there isn't one at all, sometimes it's blue, sometimes it's yellow."
 * Measured, there were two independent outlines:
 *
 *  - The intended one — `ring-2 ring-inset ring-sky-500`, box-shadow rgb(14,165,233),
 *    drawn only on the viewport with data-active="true". Absent elsewhere by design, which
 *    is the "sometimes there isn't one".
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
      hasActiveRing: cs.boxShadow.includes('14, 165, 233'),
    };
  }, panelId);

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
  expect(o.hasActiveRing, 'the app’s own active ring is the one marker and must remain').toBe(true);
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
  expect(a.hasActiveRing, 'the active viewport carries the ring').toBe(true);
  expect(b.hasActiveRing, 'an inactive viewport carries no ring — that is the intent, not a gap').toBe(false);
  expect(b.outlineStyle, 'and no browser outline either').toBe('none');
});
