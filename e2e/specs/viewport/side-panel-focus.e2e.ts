/**
 * The side panels never hold the keyboard, and never show a focus outline.
 *
 * The XNAT browser and the annotations panel are mouse-driven; keyboard shortcuts are
 * viewport-only. A focus ring in either marks something the user cannot navigate to and
 * cannot act on — reported as an outline appearing "very sporadically", on a row clicked
 * several actions ago.
 *
 * Two halves, both needed:
 *  - Display: the outline is suppressed (globals.css). On its own this would only hide it.
 *  - Behaviour: focus stranded by a click is released (keepFocusInViewports.ts), so Space
 *    and Enter cannot re-activate a panel row instead of reaching the viewport.
 *
 * Text entry is exempt on purpose — the scan filter and rename fields must keep the
 * keyboard while the user types.
 *
 * Supersedes an earlier attempt to make the panels keyboard-navigable (branch
 * `keyboard-navigation`): moving focus out of the viewports is itself the problem.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

const PANELS = {
  browser: '[data-testid="xnat-browser"]',
  annotations: '[data-testid="annotations-side-panel"]',
};

const focusState = (page: Page) =>
  page.evaluate((panels) => {
    const el = document.activeElement as HTMLElement | null;
    const inPanel = Object.entries(panels).find(([, sel]) => el?.closest(sel))?.[0] ?? null;
    const ringed = Object.values(panels).flatMap((sel) =>
      Array.from(document.querySelector(sel)?.querySelectorAll('*') ?? []).filter((n) => {
        const cs = getComputedStyle(n);
        return n.matches(':focus-visible') && cs.outlineStyle !== 'none' && cs.outlineWidth !== '0px';
      }),
    ).length;
    return { inPanel, ringed, tag: el?.tagName ?? null };
  }, PANELS);

test('clicking a side-panel control does not leave the keyboard there', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');

  const button = page.locator(`${PANELS.browser} button`).first();
  await button.click();
  await page.waitForTimeout(200);

  const after = await focusState(page);
  expect(after.inPanel, 'a click must not leave focus inside the side panel').toBe(null);
});

test('no outline appears in either panel, even after a keyboard interaction', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');

  // Strand focus the way a click used to, then flip Chrome into keyboard modality — the
  // exact sequence that made the outline appear.
  await page.evaluate((panels) => {
    (document.querySelector(`${panels.browser} button`) as HTMLElement | null)?.focus();
  }, PANELS);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);

  expect(
    (await focusState(page)).ringed,
    'nothing in the side panels may draw a focus outline',
  ).toBe(0);
});

test('a text field in a side panel still keeps the keyboard while typing', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');

  // The annotations panel's rename field: the case that would break outright if focus
  // release were applied indiscriminately — the field appears, takes focus, and the user
  // types into it immediately.
  const panel = page.locator(PANELS.annotations);
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  }
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Structure (RTSTRUCT)' }).click();

  // Create does not open an input at all — the name is captured with focus left on the
  // viewport. This test covers the OTHER half: an editor the user opens deliberately
  // (double-click) keeps focus and stays typable, which is why focus release must not be
  // applied indiscriminately.
  await page.keyboard.press('Escape'); // end the create naming sequence first
  const row = panel.locator('[data-testid^="container-row-"]').last();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.locator('span[title]').first().dblclick();
  const rename = panel.getByLabel('Rename container');
  await expect(rename).toBeVisible({ timeout: 10_000 });
  await rename.click();
  await rename.fill('');
  await rename.type('Tumour');
  await page.waitForTimeout(200);

  const after = await focusState(page);
  expect(after.inPanel, 'a text field must keep focus — releasing it would break typing').toBe('annotations');
  expect(after.tag).toBe('INPUT');
  await expect(rename, 'and the characters must actually land').toHaveValue('Tumour');
});

test('viewport shortcuts still work after clicking in a side panel', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  const slice = () =>
    page.evaluate(
      () =>
        document.querySelector('[data-testid="unified-viewport:panel_0"]')?.textContent?.match(/(\d+)\s*\/\s*\d+/)?.[1] ??
        '',
    );

  await page.locator(`${PANELS.browser} button`).first().click();
  await page.waitForTimeout(200);
  const before = await slice();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(400);

  expect(
    await slice(),
    'arrow keys must reach the viewport, not the panel row that was just clicked',
  ).not.toBe(before);
});
