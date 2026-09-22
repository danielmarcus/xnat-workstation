/**
 * The pointer, for every segmentation tool and every edit mode.
 *
 * Reported as "very buggy … sometimes the wrong fill/erase version, inconsistent when
 * shift inverting, sometimes an arrow pointer". An audit of the live app found three
 * independent causes, none of which a per-symptom fix would have caught:
 *
 *  1. TWO WRITERS. A CSS map (applyToolCursor) and an edit-mode writer fought. The CSS
 *     one re-asserted on every mousemove and wiped the other, so erase mode showed the
 *     plain arrow — except while Shift was held, which sets no mousemove in motion. That
 *     is the whole of "inconsistent when shift inverting".
 *  2. LAZY CURSOR VARIANTS. Cornerstone's `_getCursor` tries `${tool}.${strategy}`, then
 *     falls back to `${tool}`, then to `default`, and registers the variants lazily — so
 *     the same state resolved differently depending on what ran before it. Measured: the
 *     first Circle selection gave `CircleScissor`, a later identical one gave
 *     `CircleScissor.FILL_INSIDE`, and Sphere gave the OS arrow.
 *  3. NO CURSOR AT ALL for the brush family, so fill mode was the OS arrow.
 *
 * Now one function decides per (tool, mode) and names every cursor exactly. This spec
 * pins the result, because the failure mode is a wrong VALUE, not an exception — nothing
 * throws when the pointer is wrong.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

type Win = { __XNAT_E2E__: { resetUnifiedSegmentations: () => void } };

/**
 * A STABLE identity for the pointer. Cornerstone's SVG cursors are blob URLs whose id
 * changes on every registration, so hashing the computed value differs between runs for
 * the same glyph; the blob fragment carries the cursor's NAME, which does not.
 */
const cursor = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector('[data-testid="unified-viewport-element:panel_0"]') as HTMLElement;
    const c = getComputedStyle(el).cursor;
    const named = c.match(/#([A-Za-z0-9_.]+)-pointer/);
    if (named) return named[1];
    if (c.startsWith('url(')) return 'url:UNNAMED';
    return c;
  });

/** tool → [cursor in fill mode, cursor in erase mode | null when the tool has no mode] */
const EXPECTED: Array<[string, string, string | null]> = [
  ['Brush', 'crosshair', 'Eraser'],
  ['Sph. Brush', 'crosshair', 'Eraser'],
  // Fill-only: Cornerstone ships THRESHOLD_INSIDE_* with no erase counterpart.
  ['Threshold', 'crosshair', null],
  ['Sph. Thresh', 'crosshair', null],
  ['Dyn. Thresh', 'crosshair', null],
  ['Circle', 'CircleScissor', 'Eraser'],
  ['Rect', 'RectangleScissor', 'Eraser'],
  // No SphereScissor glyph ships; the circle one reads correctly for it.
  ['Sphere', 'CircleScissor', 'Eraser'],
  ['Paint Fill', 'cell', null],
  ['Region', 'crosshair', null],
  ['Rect Multi', 'crosshair', null],
  ['Contour Fill', 'crosshair', null],
  ['Select', 'pointer', null],
];

async function segPanel(page: Page) {
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await panel.getByLabel('Rename container').press('Enter');
  const mr = panel.getByLabel('Rename member');
  if (await mr.count()) await mr.press('Enter');
  return panel;
}

test('every tool shows the right cursor in both modes, and Shift restores it', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
  const panel = await segPanel(page);
  const box = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;

  for (const [i, [tool, fillCursor, eraseCursor]] of EXPECTED.entries()) {
    await panel.getByRole('button', { name: tool, exact: true }).click();
    const hasMode = (await panel.locator('[data-testid="edit-mode-controls"]').count()) > 0;
    expect(hasMode, `"${tool}" should ${eraseCursor ? '' : 'not '}offer the edit mode`).toBe(eraseCursor !== null);
    if (hasMode) await panel.getByRole('button', { name: 'fill', exact: true }).click();

    // The pointer must land somewhere NEW each time: moving it to coordinates it already
    // occupies emits no mousemove, so the cursor is never re-asserted and the spec reads
    // a stale value.
    await page.mouse.move(box.x + box.width / 2 + i * 4, box.y + box.height / 2 + i * 3, { steps: 2 });
    await page.waitForTimeout(220);
    expect(await cursor(page), `"${tool}" in fill mode`).toBe(fillCursor);

    if (!eraseCursor) continue;

    await panel.getByRole('button', { name: 'erase', exact: true }).click();
    await page.mouse.move(box.x + box.width / 2 + i * 4 + 2, box.y + box.height / 2 + i * 3 + 2, { steps: 2 });
    await page.waitForTimeout(220);
    expect(await cursor(page), `"${tool}" in erase mode`).toBe(eraseCursor);

    // Back to fill, then Shift must invert and release must restore EXACTLY.
    await panel.getByRole('button', { name: 'fill', exact: true }).click();
    await page.waitForTimeout(180);
    await page.keyboard.down('Shift');
    await page.waitForTimeout(220);
    expect(await cursor(page), `"${tool}" while Shift is held`).toBe(eraseCursor);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(220);
    expect(await cursor(page), `"${tool}" after releasing Shift`).toBe(fillCursor);
  }
});

test('no segmentation tool leaves the bare OS arrow over the image', async ({ page }) => {
  // "Sometimes an arrow pointer shows up." `auto`/`default` means nothing was set.
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
  const panel = await segPanel(page);
  const box = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;

  for (const [i, [tool]] of EXPECTED.entries()) {
    await panel.getByRole('button', { name: tool, exact: true }).click();
    await page.mouse.move(box.x + box.width / 2 + i * 5, box.y + box.height / 2 + i * 2, { steps: 2 });
    await page.waitForTimeout(200);
    const c = await cursor(page);
    expect(['auto', 'default', 'url:UNNAMED'], `"${tool}" must set a deliberate cursor, got "${c}"`).not.toContain(c);
  }
});
