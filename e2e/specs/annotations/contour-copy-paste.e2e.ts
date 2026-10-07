/**
 * Contour copy/paste through the keyboard: Ctrl+C on the selected contour, move to
 * another slice, Ctrl+V.
 *
 * Copy acts on Cornerstone's annotation selection. On Cornerstone 5 a finished contour
 * stroke does not survive as itself: the contour union deletes it and adds its result
 * as a new annotation (new UID), even when there is nothing to union with. The drawn
 * contour was the selected one, so the selection was left holding a UID that no longer
 * exists — Ctrl+C silently copied nothing, and Ctrl+V pasted nothing.
 *
 * Drives the real panel, a real freehand stroke and the real hotkeys, and checks the
 * outline that is drawn on the target slice.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

type Snapshot = { total: number; onCurrentSlice: number; currentSliceIndex: number | null };
type Win = {
  __XNAT_E2E__: {
    resetUnifiedSegmentations: () => void;
    getActiveContourSnapshot: (panelId?: string, segmentationId?: string | null) => Snapshot;
  };
};

const VIEWPORT = '[data-testid="unified-viewport-element:panel_0"]';

const snapshot = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getActiveContourSnapshot('panel_0'));

/** Committed contour outlines drawn on the current slice. */
const outlineCount = (page: Page) =>
  page.evaluate(
    (vp) =>
      Array.from(document.querySelectorAll(`${vp} svg path`)).filter(
        (n) => (n as SVGGraphicsElement).getBoundingClientRect().width > 5,
      ).length,
    VIEWPORT,
  );

async function drawLoop(page: Page) {
  const box = (await page.locator(`${VIEWPORT} canvas`).boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const r = Math.min(box.width, box.height) * 0.15;
  await page.mouse.move(cx + r, cy);
  await page.mouse.down();
  for (let i = 1; i <= 32; i++) {
    const a = (i / 32) * 2 * Math.PI;
    await page.mouse.move(cx + r * Math.cos(a), cy + r * Math.sin(a), { steps: 2 });
  }
  await page.mouse.up();
  await page.waitForTimeout(700);
}

test('a contour just drawn can be copied and pasted onto another slice', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Structure (RTSTRUCT)' }).click();
  await page.keyboard.press('Escape'); // end the create-naming capture, keep default names
  await panel.locator('[data-testid="context-toolbox"]').getByRole('button', { name: 'Freehand', exact: true }).click();

  await drawLoop(page);
  const source = await snapshot(page);
  expect(source.total, 'the stroke lands as one contour').toBe(1);

  await page.keyboard.press('Control+c');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await snapshot(page)).currentSliceIndex).toBe((source.currentSliceIndex ?? 0) + 3);
  expect(await outlineCount(page), 'nothing on the target slice before the paste').toBe(0);

  await page.keyboard.press('Control+v');

  await expect
    .poll(async () => (await snapshot(page)).onCurrentSlice, { timeout: 5_000, message: 'the paste lands on this slice' })
    .toBe(1);
  await expect.poll(() => outlineCount(page), { message: 'and its outline is drawn' }).toBe(1);

  // The paste goes through the same union, so its undo entry must follow it too.
  await page.keyboard.press('Control+z');
  await expect.poll(() => outlineCount(page), { message: 'undo takes the paste back off this slice' }).toBe(0);
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowUp');
  await expect.poll(() => outlineCount(page), { message: 'and leaves the source contour' }).toBe(1);
});

/** Outlines on the current slice, by stroke colour (rtstruct-typed's GTV is pure red). */
const outlines = (page: Page) =>
  page.evaluate(
    (vp) =>
      Array.from(document.querySelectorAll(`${vp} svg path`))
        .map((n) => ({ el: n as SVGGraphicsElement, stroke: getComputedStyle(n).stroke }))
        .filter(({ el }) => el.getBoundingClientRect().width > 5)
        .map(({ el, stroke }) => {
          const r = el.getBoundingClientRect();
          return { stroke, x: r.x, y: r.y, w: r.width, h: r.height };
        }),
    VIEWPORT,
  );
const GTV = 'rgb(255, 0, 0)';

test('a loaded Structure contour can be copied, and the paste interpolates with it', async ({ page }) => {
  // rtstruct-typed: four ROIs, each one square on the same slice. Their contours come in
  // through the RTSTRUCT loader, not a tool stroke.
  await loadFixture(page, 'rtstruct-typed', 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  const activate = panel.locator('[data-testid^="container-activate-"]').first();
  await expect(activate).toBeVisible({ timeout: 20_000 });
  await activate.click();
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await expect(toolbox, 'activating the Structure shows its tools').toBeVisible();
  await toolbox.getByRole('button', { name: 'Freehand', exact: true }).click();

  // Find the slice the structures are on.
  for (let i = 0; i < 20 && !(await outlines(page)).some((o) => o.stroke === GTV); i++) {
    await page.keyboard.press(i < 10 ? 'ArrowUp' : 'ArrowDown');
    await page.waitForTimeout(200);
  }
  const gtv = (await outlines(page)).find((o) => o.stroke === GTV)!;
  expect(gtv, 'the GTV outline is drawn').toBeTruthy();
  // Loaded structures arrive locked; unlock GTV the way a user does, from its row. The
  // Structure's active member (BODY) stays locked: clicking GTV's outline must still
  // select it — a press on an existing contour is not a draw into BODY.
  await panel.locator('[data-testid^="member-row-"]').filter({ hasText: 'GTV' }).getByRole('button', { name: 'Toggle lock' }).click();
  const source = await snapshot(page);

  // Click ON the GTV outline (its top edge) to select it, then copy.
  await page.mouse.click(gtv.x + gtv.w / 2, gtv.y + 1);
  await page.keyboard.press('Control+c');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await snapshot(page)).currentSliceIndex).toBe((source.currentSliceIndex ?? 0) + 3);
  await expect.poll(() => outlines(page), { message: 'nothing on the target slice before the paste' }).toEqual([]);

  await page.keyboard.press('Control+v');
  await expect
    .poll(async () => (await outlines(page)).map((o) => o.stroke), { timeout: 5_000, message: 'the GTV paste is drawn here' })
    .toEqual([GTV]);

  // Interpolation joins the paste to the loaded contour: both slices in between get one.
  for (const step of [1, 2]) {
    await page.keyboard.press('ArrowUp');
    await expect
      .poll(async () => (await outlines(page)).map((o) => o.stroke), {
        timeout: 5_000,
        message: `slice ${step} between the paste and the loaded contour is interpolated`,
      })
      .toEqual([GTV]);
  }
});
