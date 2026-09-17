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

/**
 * The XNAT browser's outline does not appear on a row after you have moved on from it.
 *
 * Reported: "I've just clicked on a row and the scan loaded. No outline. If I tab to
 * another viewport the outline suddenly appears."
 *
 * Both halves are Chrome behaving correctly, which is exactly why it looked arbitrary:
 *
 *  - A mouse click focuses the button but does NOT grant :focus-visible, so clicking a row
 *    draws no ring. Correct.
 *  - Tab is bound to panel.nextViewport and is intercepted, so the default focus move is
 *    prevented and DOM focus STAYS on that scan row. The interaction was keyboard, so
 *    Chrome flips to keyboard modality, and the row it is still focused on starts matching
 *    :focus-visible — a ring appears in the BROWSER on a row clicked several actions ago,
 *    while the user has moved to a viewport.
 *
 * So the ring is not the defect; focus being stranded in the browser is. The fix is in the
 * viewport-cycling action, but the symptom and the assertion are both about the browser:
 * after tabbing away, nothing in the browser is outlined.
 */
test('a browser row is not outlined after you tab away from it to a viewport', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.locator('[title^="Viewport layout"]').click();
  await page.getByRole('button', { name: '1 x 2' }).click();
  await page.locator('[data-testid="unified-viewport:panel_1"]').waitFor({ state: 'attached', timeout: 20_000 });

  // Strand focus on a browser control, exactly as clicking a scan row does.
  await page.evaluate(() => {
    const root = document.querySelector('[data-testid="xnat-browser"]');
    (root?.querySelector('button') as HTMLElement | null)?.focus();
  });
  expect(
    await page.evaluate(() =>
      !!document.querySelector('[data-testid="xnat-browser"]')?.contains(document.activeElement),
    ),
    'setup: focus must start inside the browser',
  ).toBe(true);

  await page.keyboard.press('Tab');

  const after = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    const browser = document.querySelector('[data-testid="xnat-browser"]');
    // Anything in the browser still drawing a focus outline?
    const ringed = Array.from(browser?.querySelectorAll('*') ?? []).filter((n) => {
      const cs = getComputedStyle(n);
      return n.matches(':focus-visible') && cs.outlineStyle !== 'none' && cs.outlineWidth !== '0px';
    }).length;
    return {
      ringedInBrowser: ringed,
      stillInBrowser: !!browser?.contains(el),
      onAViewport: !!el?.closest('[data-testid^="unified-viewport:"]'),
      activeViewport: document.querySelector('[data-testid^="unified-viewport:"][data-active="true"]')
        ?.getAttribute('data-panel-id') ?? null,
      focusedViewport: el?.closest('[data-testid^="unified-viewport:"]')?.getAttribute('data-panel-id') ?? null,
    };
  });

  // The reported symptom, asserted directly.
  expect(after.ringedInBrowser, 'nothing in the XNAT browser may be outlined once you have tabbed away').toBe(0);

  // ...and the reason, so a regression says which half broke.
  expect(after.stillInBrowser, 'focus must not be left behind in the browser').toBe(false);
  expect(after.onAViewport, 'it must land on the viewport the action moved to').toBe(true);
  expect(
    after.focusedViewport,
    'the focused viewport and the active viewport must be the same one',
  ).toBe(after.activeViewport);
});
