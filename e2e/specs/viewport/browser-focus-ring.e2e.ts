/**
 * Keyboard focus in the XNAT browser is shown in the app's own colour, not the OS accent.
 *
 * Reported: "a yellowish outline shows up in the XNAT browser very sporadically, typically
 * when I tab viewports." It is the same thing that was outlining viewports — Chrome's
 * :focus-visible ring, measured as rgb(229,151,0), the macOS system accent colour — landing
 * on the browser's buttons instead. It is sporadic because :focus-visible needs the last
 * interaction to have been keyboard, so it appears after a Tab and not after a click.
 *
 * The correct answer here is the OPPOSITE of the viewport's. A viewport is not in the tab
 * order and already carries an app-drawn active ring, so the browser ring there was pure
 * duplication and is suppressed. A scan row IS keyboard-reachable and the focus ring is
 * the only thing telling a keyboard user where they are — removing it would be an
 * accessibility regression. So it is restyled, not removed: the app's own subtle zinc,
 * matching the focus treatment the browser's search input already uses.
 *
 * Reading a scan row needs a live XNAT connection, so this asserts the rule on the
 * browser's own controls, which render offline. The rule is scoped to the browser root and
 * applies to every focusable inside it.
 */
import { test, expect } from '../../fixtures/electron-app';
import { loadFixture } from '../../helpers/local-fixture';

/** macOS system accent as Chrome reports it for the UA focus ring. */
const OS_ACCENT = 'rgb(229, 151, 0)';

test('a keyboard-focused browser control is ringed in the app’s colour, not the OS accent', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');

  // Reproduce the condition that grants :focus-visible — a keyboard interaction first.
  await page.keyboard.press('Tab');
  await page.evaluate(() => {
    const root = document.querySelector('[data-testid="xnat-browser"]');
    (root?.querySelector('button') as HTMLElement | null)?.focus();
  });

  const focused = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const cs = getComputedStyle(el);
    return {
      insideBrowser: !!document.querySelector('[data-testid="xnat-browser"]')?.contains(el),
      focusVisible: el.matches(':focus-visible'),
      outlineColor: cs.outlineColor,
      outlineStyle: cs.outlineStyle,
    };
  });

  expect(focused.insideBrowser, 'the control under test must be in the browser').toBe(true);
  expect(focused.focusVisible, 'the condition under test must actually hold, or this proves nothing').toBe(true);
  expect(
    focused.outlineColor,
    'the focus ring must not be the macOS system accent colour — that varies per machine and is nothing the app chose',
  ).not.toBe(OS_ACCENT);
  expect(
    focused.outlineStyle,
    'but a keyboard-focused control must still be ringed — it is the only cue a keyboard user gets',
  ).not.toBe('none');
});
