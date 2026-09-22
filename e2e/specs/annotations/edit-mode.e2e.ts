/**
 * The shape tools' add/remove mode, end to end.
 *
 * Cornerstone registers exactly two strategies on each scissors tool — FILL_INSIDE and
 * ERASE_INSIDE. Erase was never reachable in the running app: the fill/erase preference
 * and its Shift-invert lived on the legacy `toolService`, whose `initialize()` is never
 * called outside tests, so `applyScissorPreferences()` always returned early on a
 * tool group that did not exist. The Settings control moved bytes and nothing else.
 *
 * This drives the real surface: click the toolbox toggle, drag the shape over painted
 * voxels, and count what is left in the labelmap. A test that asserted the strategy
 * string would have passed against the dead path too.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

type Win = {
  __XNAT_E2E__: {
    resetUnifiedSegmentations: () => void;
    getPaintedVoxelCount: () => number;
  };
};

const paintedVoxels = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelCount());

async function segToolbox(page: Page) {
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await panel.getByLabel('Rename container').press('Enter');
  const mr = panel.getByLabel('Rename member');
  if (await mr.count()) await mr.press('Enter');
  return panel;
}

/** Drag the active shape tool across the middle of the viewport. */
async function dragShape(
  page: Page,
  from: [number, number],
  to: [number, number],
  opts: { shift?: boolean } = {},
) {
  const vp = page.locator('[data-testid="unified-viewport-element:panel_0"] canvas');
  const box = (await vp.boundingBox())!;
  if (opts.shift) await page.keyboard.down('Shift');
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 12 });
  await page.mouse.up();
  if (opts.shift) await page.keyboard.up('Shift');
  await page.waitForTimeout(400);
}

/** The CSS cursor currently on the viewport element. */
const viewportCursor = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector(
      '[data-testid="unified-viewport-element:panel_0"]',
    ) as HTMLElement;
    return getComputedStyle(el).cursor;
  });

test('the shape tools add in fill mode and remove in erase mode', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
  const panel = await segToolbox(page);

  // Fill mode: dragging a rectangle puts voxels in.
  await panel.getByRole('button', { name: 'Rect', exact: true }).click();
  await panel.getByRole('button', { name: 'fill', exact: true }).click();
  await dragShape(page, [120, 120], [240, 240]);

  const afterFill = await paintedVoxels(page);
  expect(afterFill, 'fill mode should paint voxels').toBeGreaterThan(0);

  // Erase mode: dragging the same rectangle takes them back out.
  await panel.getByRole('button', { name: 'erase', exact: true }).click();
  await dragShape(page, [120, 120], [240, 240]);

  const afterErase = await paintedVoxels(page);
  expect(afterErase, 'erase mode should remove the voxels fill added').toBeLessThan(afterFill);
});

test('the mode toggle reflects the active mode and survives a tool switch', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
  const panel = await segToolbox(page);

  await panel.getByRole('button', { name: 'Circle', exact: true }).click();
  await panel.getByRole('button', { name: 'erase', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'erase', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // Switching to another shape tool keeps the mode — it is one setting for the family,
  // not per-tool state, and the toggle must not silently reset to fill.
  await panel.getByRole('button', { name: 'Sphere', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'erase', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('holding Shift inverts the mode AND still draws', async ({ page }) => {
  // Reported as "when I use shift to invert the mode, the circle does not draw".
  // Cornerstone needs an exact modifier match on the binding, so Shift+drag was
  // reaching no tool at all. A test that only checked the strategy string would have
  // passed throughout — the drag has to actually happen.
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
  const panel = await segToolbox(page);

  await panel.getByRole('button', { name: 'Rect', exact: true }).click();
  await panel.getByRole('button', { name: 'fill', exact: true }).click();

  // Plain drag fills.
  await dragShape(page, [120, 120], [240, 240]);
  const afterFill = await paintedVoxels(page);
  expect(afterFill, 'plain drag should fill').toBeGreaterThan(0);

  // Shift+drag over the same box inverts fill→erase and must still draw.
  await dragShape(page, [120, 120], [240, 240], { shift: true });
  const afterShift = await paintedVoxels(page);
  expect(afterShift, 'Shift+drag should invert to erase and remove voxels').toBeLessThan(afterFill);
});

test('the shape tools show one cursor, and it tracks the mode', async ({ page }) => {
  // Reported as "the cursor is confusing — it starts as a cross and then after drawing
  // turns into a green icon with a little plus". Two writers: a CSS 'crosshair' from
  // CURSOR_FOR_TOOL and Cornerstone's SVG cursor, which is the one that encodes the
  // mode. Selecting the tool must land on the Cornerstone cursor immediately.
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
  const panel = await segToolbox(page);

  await panel.getByRole('button', { name: 'Circle', exact: true }).click();
  await panel.getByRole('button', { name: 'fill', exact: true }).click();
  await page.waitForTimeout(300);

  const fillCursor = await viewportCursor(page);
  expect(fillCursor, 'no bare crosshair before the first drag').not.toBe('crosshair');

  await panel.getByRole('button', { name: 'erase', exact: true }).click();
  await page.waitForTimeout(300);

  const eraseCursor = await viewportCursor(page);
  expect(eraseCursor, 'the cursor must change with the mode').not.toBe(fillCursor);
});

test('a stale stored "erase" is reset to fill on load', async ({ page }) => {
  // The unit test calls the migrate hook directly; this checks it actually fires on
  // rehydration and reaches the toolbox. Seed the shape of payload every existing
  // install has — no version field, defaultStrategy 'erase' — then reload.
  await page.evaluate(() => {
    const KEY = 'xnat-viewer:preferences';
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : { state: { preferences: {} } };
    parsed.state.preferences.annotation = {
      ...(parsed.state.preferences.annotation ?? {}),
      scissors: { defaultStrategy: 'erase', previewEnabled: false, previewColor: '#FFFFFF' },
    };
    // A genuine pre-upgrade payload carries neither marker: zustand's numeric `version`
    // (added 2026-09-21) nor `preferences.schemaVersion`. Without deleting the latter the
    // seed looks like a deliberate post-upgrade choice, which is correctly preserved.
    delete parsed.version;
    delete parsed.state.preferences.schemaVersion;
    window.localStorage.setItem(KEY, JSON.stringify(parsed));
  });
  await page.reload();

  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
  const panel = await segToolbox(page);
  await panel.getByRole('button', { name: 'Circle', exact: true }).click();

  await expect(
    panel.getByRole('button', { name: 'fill', exact: true }),
    'a stored "erase" nobody chose must not survive into the toolbox',
  ).toHaveAttribute('aria-pressed', 'true');
});

test('the brush follows the same mode as the shape tools', async ({ page }) => {
  // Erase used to be a separate Eraser button; it is now the same shared mode. This is
  // the assertion that the two families really do behave alike.
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
  const panel = await segToolbox(page);

  await panel.getByRole('button', { name: 'Brush', exact: true }).click();
  await expect(panel.locator('[data-testid="edit-mode-controls"]')).toBeVisible();
  await panel.getByRole('button', { name: 'fill', exact: true }).click();
  await dragShape(page, [140, 140], [200, 200]);
  const afterFill = await paintedVoxels(page);
  expect(afterFill, 'the brush should paint in fill mode').toBeGreaterThan(0);

  await panel.getByRole('button', { name: 'erase', exact: true }).click();
  await dragShape(page, [140, 140], [200, 200]);
  expect(await paintedVoxels(page), 'the brush should erase in erase mode').toBeLessThan(afterFill);
});

test('there is no separate Eraser tool any more', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
  const panel = await segToolbox(page);

  await expect(panel.getByRole('button', { name: 'Eraser', exact: true })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Sph. Eraser', exact: true })).toHaveCount(0);
});

test('Shift shows the erase cursor while held, for the brush and the shape tools', async ({ page }) => {
  // The requirement is that the pointer SAYS what the next drag will do. The brush ring
  // shows radius only — Cornerstone dashes it off what lies under the pointer, not off
  // the active strategy — so erase needs a cursor of its own, and it has to appear on
  // Shift-down and go away on Shift-up, without waiting for a drag.
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
  const panel = await segToolbox(page);

  for (const tool of ['Brush', 'Circle']) {
    await panel.getByRole('button', { name: tool, exact: true }).click();
    await panel.getByRole('button', { name: 'fill', exact: true }).click();
    await page.waitForTimeout(250);
    const fillCursor = await viewportCursor(page);

    await page.keyboard.down('Shift');
    await page.waitForTimeout(250);
    const shiftCursor = await viewportCursor(page);
    await page.keyboard.up('Shift');
    await page.waitForTimeout(250);
    const releasedCursor = await viewportCursor(page);

    expect(shiftCursor, `"${tool}": holding Shift must change the cursor`).not.toBe(fillCursor);
    expect(releasedCursor, `"${tool}": releasing Shift must restore the cursor`).toBe(fillCursor);
  }
});

test('the e hotkey toggles the mode for whichever tool is active', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
  const panel = await segToolbox(page);

  await panel.getByRole('button', { name: 'Brush', exact: true }).click();
  await panel.getByRole('button', { name: 'fill', exact: true }).click();

  await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('e');
  await expect(
    panel.getByRole('button', { name: 'erase', exact: true }),
    '`e` used to pick the Eraser tool; it now toggles the mode, so it works for every tool',
  ).toHaveAttribute('aria-pressed', 'true');
});
