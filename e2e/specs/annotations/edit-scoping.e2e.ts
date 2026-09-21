/**
 * Bug (user-reported): existing structure contours could be grabbed and dragged even
 * while a measurement tool was in use. Root cause: every handle-based annotation tool was
 * left in Cornerstone PASSIVE mode, and Passive = existing annotations stay editable. The
 * fix keeps idle handle tools in ENABLED mode (rendered, view-only).
 *
 * This asserts the CONTRACT — the contour does not move when you drag it with the wrong
 * tool active — rather than the mechanism. It previously asserted only that the tool's
 * Cornerstone mode string equalled 'Enabled'. That is the layer the fix was made at, so it
 * could not fail for any reason other than the fix being reverted wholesale; it says
 * nothing about whether a drag actually moves anything.
 *
 * The final case is a positive control, and it is the point of the spec: with the
 * contour's OWN tool active the same drag must move it. Without that, "the contour did not
 * move" also passes when dragging is broken everywhere, which is the failure mode this
 * kind of assertion invites.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

type Win = { __XNAT_E2E__: {
  setActiveUnifiedTool: (toolName: string) => void;
  resetUnifiedSegmentations: () => void;
}; };

/** Bounding box of the contour drawn on panel_0, in page pixels. */
async function contourBox(page: Page): Promise<{ x: number; y: number; w: number; h: number } | null> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="unified-viewport-element:panel_0"]');
    const shape = el?.querySelector('svg path, svg polyline') as SVGGraphicsElement | null;
    if (!shape) return null;
    const r = shape.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
}

async function drawLoop(page: Page) {
  const box = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;
  const cx = box.x + box.width * 0.5;
  const cy = box.y + box.height * 0.5;
  const r = Math.min(box.width, box.height) * 0.22;
  await page.mouse.move(cx + r, cy);
  await page.mouse.down();
  for (let i = 1; i <= 24; i++) {
    const a = (i / 24) * 2 * Math.PI;
    await page.mouse.move(cx + r * Math.cos(a), cy + r * Math.sin(a), { steps: 2 });
  }
  await page.mouse.move(cx + r, cy, { steps: 2 });
  await page.mouse.up();
  await page.waitForTimeout(900);
}

/** Drag from a point ON the contour's edge, well inside the viewport. */
async function dragContourEdge(page: Page, from: { x: number; y: number; w: number; h: number }) {
  const edgeX = from.x + from.w;      // rightmost point of the loop
  const edgeY = from.y + from.h / 2;
  await page.mouse.move(edgeX, edgeY);
  await page.mouse.down();
  await page.mouse.move(edgeX + 60, edgeY + 40, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(900);
}

const moved = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.w - b.w) + Math.abs(a.h - b.h);

test('a structure contour cannot be dragged while a measurement tool is active', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());

  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  }
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Structure (RTSTRUCT)' }).click();
  await panel.getByLabel('Rename container').press('Enter');
  const memberRename = panel.getByLabel('Rename member');
  if (await memberRename.count()) await memberRename.press('Enter');

  await drawLoop(page);
  const drawn = await contourBox(page);
  expect(drawn, 'the contour must be on screen before we try to drag it').not.toBeNull();

  // Measurement tool active → the contour is view-only.
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setActiveUnifiedTool('Length'));
  await page.waitForTimeout(300);
  await dragContourEdge(page, drawn!);
  const afterWrongTool = await contourBox(page);
  expect(afterWrongTool, 'the contour must still exist after the drag attempt').not.toBeNull();
  expect(
    moved(drawn!, afterWrongTool!),
    'dragging with a measurement tool active must not move the contour',
  ).toBeLessThan(8);

  // POSITIVE CONTROL: its own tool active → the same drag DOES move it. Without this the
  // assertion above would also pass if dragging never worked at all.
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setActiveUnifiedTool('FreehandContour'));
  await page.waitForTimeout(300);
  await dragContourEdge(page, afterWrongTool!);
  const afterOwnTool = await contourBox(page);
  expect(afterOwnTool, 'the contour must still exist').not.toBeNull();
  expect(
    moved(afterWrongTool!, afterOwnTool!),
    'with its own tool active the same drag must reshape it — otherwise this spec proves nothing',
  ).toBeGreaterThan(8);
});
