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
import { clickTool } from '../../helpers/toolbox';

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

// ── Every non-text control, anywhere in the viewer chrome ─────────────────────────
//
// The rule is not about <button>s. A slider, a checkbox, a dropdown or a toolbar button
// holds the keyboard just the same once clicked — and an <input> was exempt wholesale,
// so dragging the toolbox's Brush size slider left it focused: the next key press drew
// the browser's accent-coloured ring around it, and the shortcuts were swallowed (the
// hotkey guard treated the slider as a text field) while the arrow keys resized the
// brush instead of changing slice. Only text entry keeps the keyboard; modal dialogs
// are keyboard surfaces of their own and are not covered.

/** Focus and outline state across the whole viewer chrome (modal dialogs excluded). */
const chromeFocus = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    const ringed = Array.from(document.querySelectorAll('body *'))
      .filter((n) => !n.closest('[role="dialog"]'))
      .filter((n) => {
        const cs = getComputedStyle(n);
        return n.matches(':focus-visible') && cs.outlineStyle !== 'none' && cs.outlineWidth !== '0px';
      })
      .map((n) => n.getAttribute('aria-label') ?? n.getAttribute('title') ?? n.tagName);
    const held = el && el !== document.body && !el.closest('[data-testid^="unified-viewport"]') ? (el.getAttribute('aria-label') ?? el.getAttribute('title') ?? el.tagName) : null;
    return { held, ringed };
  });

async function openSegmentationToolbox(page: Page) {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  const panel = page.locator(PANELS.annotations);
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await expect(panel.locator('[data-testid^="member-row-"]').first()).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Escape'); // end the create-naming capture, keep default names
  return panel;
}

const brushSize = (page: Page) =>
  page.evaluate(() => Number((document.querySelector('[data-testid="annotations-side-panel"] input[aria-label="Brush size"]') as HTMLInputElement | null)?.value));

test('dragging a toolbox slider leaves neither focus nor an outline, and the keys reach the image', async ({ page }) => {
  const panel = await openSegmentationToolbox(page);
  const slider = panel.getByLabel('Brush size');
  await expect(slider).toBeVisible({ timeout: 10_000 });

  // A real drag on the thumb, the way the slider in the report was moved.
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + 6, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const dragged = await brushSize(page);
  expect(dragged, 'the drag moved the slider').toBeGreaterThan(3);

  expect((await chromeFocus(page)).held, 'the slider must not keep the keyboard').toBe(null);

  // ']' is the brush-size shortcut: it must reach the hotkeys, not be swallowed by a
  // focused slider.
  await page.keyboard.press(']');
  await expect.poll(() => brushSize(page), { message: 'the shortcut reaches the hotkeys' }).toBe(dragged + 2);
  expect((await chromeFocus(page)).ringed, 'and no outline appears on the keyboard press').toEqual([]);

  const slice = () => page.evaluate(() => document.querySelector('[data-testid="unified-viewport:panel_0"]')?.textContent?.match(/(\d+)\s*\/\s*\d+/)?.[1] ?? '');
  const before = await slice();
  await page.keyboard.press('ArrowDown');
  await expect.poll(slice, { message: 'the arrow keys change slice' }).not.toBe(before);
  expect(await brushSize(page), 'rather than resizing the brush').toBe(dragged + 2);
});

test('a toolbar button does not keep the keyboard: Space does not press it again', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  const panel = page.locator(PANELS.annotations);
  // The Annotate toggle: its state is visible (the panel), so a second press would show.
  const toggle = page.locator('[data-testid="toolbar"]').getByRole('button', { name: /segmentation panel$/ });
  const wasOpen = await panel.isVisible();
  await toggle.click();
  await expect(panel, 'the click toggles the panel').toBeVisible({ visible: !wasOpen });

  expect((await chromeFocus(page)).held, 'the toolbar button must not keep the keyboard').toBe(null);
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  await expect(panel, 'Space must not press the toolbar button again').toBeVisible({ visible: !wasOpen });
  expect((await chromeFocus(page)).ringed, 'and no outline appears').toEqual([]);
});

test('choosing from a toolbox dropdown hands the keyboard back', async ({ page }) => {
  const panel = await openSegmentationToolbox(page);
  await clickTool(panel.locator('[data-testid="context-toolbox"]'), 'Threshold');
  const preset = panel.getByLabel('Threshold preset');
  await expect(preset).toBeVisible({ timeout: 10_000 });
  const option = await preset.locator('option').nth(1).getAttribute('value');
  // A mouse click focuses the <select> before its menu opens; selectOption alone does not.
  await preset.focus();
  await preset.selectOption(option!);

  await page.waitForTimeout(150);
  expect((await chromeFocus(page)).held, 'the dropdown must not keep the keyboard').toBe(null);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);
  expect((await chromeFocus(page)).ringed, 'and no outline appears on the next key press').toEqual([]);
});

test('a slider that does hold focus still draws no outline', async ({ page }) => {
  // The display half on its own: focus put on the slider programmatically (not by a
  // click, so nothing releases it), then a key press grants :focus-visible.
  const panel = await openSegmentationToolbox(page);
  const slider = panel.getByLabel('Brush size');
  await expect(slider).toBeVisible({ timeout: 10_000 });
  await slider.focus();
  await page.keyboard.press('Shift');
  await page.waitForTimeout(100);
  const state = await chromeFocus(page);
  expect(state.held, 'focus is on the slider for this check').toBe('Brush size');
  expect(state.ringed, 'no outline is drawn on it').toEqual([]);

  // …and the shortcuts are not swallowed by it: the hotkey guard is for text entry only.
  const size = await brushSize(page);
  await page.keyboard.press(']');
  await expect.poll(() => brushSize(page), { message: 'the brush shortcut still works' }).toBe(size + 2);
});
