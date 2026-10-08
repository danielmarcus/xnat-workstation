/**
 * A selected annotation is visibly selected: its outline is drawn thicker, in its own
 * colour.
 *
 * Measurements: Cornerstone shows selection by switching to its selected colour, but the
 * app pins every state to the measurement's own colour (so it doesn't flip
 * green-then-yellow), which left selection invisible. Contours: Cornerstone styles a
 * contour from its segment alone and ignores selection entirely.
 *
 * Drives the real panel rows / toolbox and reads the stroke width Cornerstone renders.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

type Win = { __XNAT_E2E__: { clearAllContainers: () => void; getMeasurementCount: () => number } };
const VIEWPORT = '[data-testid="unified-viewport-element:panel_0"]';

test.beforeEach(({ page }) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers()));

/**
 * Rendered stroke width of each measurement line, keyed by annotation UID. Cornerstone
 * tags only a measurement's text label with its UID, so each label is paired with the
 * drawn line nearest to it vertically (the test draws its lines far apart).
 */
const measurementLineWidths = (page: Page) =>
  page.evaluate((vp) => {
    const layer = document.querySelector(`${vp} .svg-layer`)!;
    const lines = Array.from(layer.querySelectorAll('line')).map((l) => {
      const r = l.getBoundingClientRect();
      return { y: r.y + r.height / 2, w: Number(l.getAttribute('stroke-width')), len: r.width };
    }).filter((l) => l.len > 20); // the measured segment, not a text-box link
    const out: Record<string, number> = {};
    for (const g of Array.from(layer.querySelectorAll('[data-annotation-uid]'))) {
      const y = g.getBoundingClientRect().y;
      const nearest = lines.reduce((best, l) => (Math.abs(l.y - y) < Math.abs(best.y - y) ? l : best), lines[0]);
      if (nearest) out[g.getAttribute('data-annotation-uid')!] = nearest.w;
    }
    return out;
  }, VIEWPORT);

async function openPanel(page: Page) {
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  return panel;
}

test('clicking a measurement row draws that measurement thicker than the others', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  const panel = await openPanel(page);
  await panel.getByRole('button', { name: 'New Measurement (SR)' }).click();
  await page.keyboard.press('Escape');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await toolbox.getByRole('button', { name: 'Length', exact: true }).click();

  const box = (await page.locator(`${VIEWPORT} canvas`).boundingBox())!;
  for (const y of [0.35, 0.65]) {
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);
  }
  const rows = panel.locator('[data-testid^="member-row-"]');
  await expect(rows).toHaveCount(2);

  const uidOf = async (i: number) => (await rows.nth(i).getAttribute('data-testid'))!.replace('member-row-', '');
  const [a, b] = [await uidOf(0), await uidOf(1)];

  await rows.nth(0).click();
  await expect
    .poll(async () => { const w = await measurementLineWidths(page); return w[a] > w[b]; }, { message: 'the selected measurement is drawn thicker' })
    .toBe(true);

  await rows.nth(1).click();
  await expect
    .poll(async () => { const w = await measurementLineWidths(page); return w[b] > w[a]; }, { message: 'selection moves, and the first goes back to normal' })
    .toBe(true);
});

/** Contour outlines on the current slice (left to right) with their rendered width. */
const contourOutlines = (page: Page) =>
  page.evaluate((vp) =>
    Array.from(document.querySelectorAll(`${vp} .svg-layer path`))
      .map((n) => ({ r: (n as SVGGraphicsElement).getBoundingClientRect(), w: Number(n.getAttribute('stroke-width')) }))
      .filter(({ r }) => r.width > 5)
      .sort((a, b) => a.r.x - b.r.x)
      .map(({ r, w }) => ({ x: r.x, y: r.y, width: r.width, height: r.height, w })),
  VIEWPORT);

type Snapshot = { total: number; selected: string[] };
const contourSnapshot = (page: Page) =>
  page.evaluate(() => (window as unknown as { __XNAT_E2E__: { getActiveContourSnapshot: (p: string) => Snapshot } })
    .__XNAT_E2E__.getActiveContourSnapshot('panel_0'));

/** A Structure with two separate contours of one ROI on the current slice. */
async function twoContours(page: Page) {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  const panel = await openPanel(page);
  await panel.getByRole('button', { name: 'New Structure (RTSTRUCT)' }).click();
  await page.keyboard.press('Escape');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await toolbox.getByRole('button', { name: 'Freehand', exact: true }).click();
  const box = (await page.locator(`${VIEWPORT} canvas`).boundingBox())!;
  const r = Math.min(box.width, box.height) * 0.08;
  for (const fx of [0.3, 0.7]) {
    const cx = box.x + box.width * fx;
    const cy = box.y + box.height * 0.5;
    await page.mouse.move(cx + r, cy);
    await page.mouse.down();
    for (let i = 1; i <= 32; i++) {
      const a = (i / 32) * 2 * Math.PI;
      await page.mouse.move(cx + r * Math.cos(a), cy + r * Math.sin(a), { steps: 2 });
    }
    await page.mouse.up();
    await page.waitForTimeout(500);
  }
  await expect.poll(async () => (await contourOutlines(page)).length).toBe(2);
  return { panel, toolbox, box };
}

test('the Select tool selects a contour, which is drawn thicker; a click on empty image clears it and draws nothing', async ({ page }) => {
  const { toolbox, box } = await twoContours(page);
  await toolbox.getByRole('button', { name: 'Select ROI', exact: true }).click();
  await page.mouse.move(box.x + 5, box.y + 5); // off both contours: no hover highlight
  const [left] = await contourOutlines(page);

  // Click the left contour's top edge.
  await page.mouse.click(left.x + left.width / 2, left.y + 1);
  await expect
    .poll(async () => { const [l, r] = await contourOutlines(page); return l.w > r.w; }, { message: 'the selected contour is drawn thicker' })
    .toBe(true);
  expect((await contourSnapshot(page)).selected).toHaveLength(1);

  // Click empty image: the selection clears, and the Select tool draws nothing.
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.2);
  await expect.poll(async () => (await contourSnapshot(page)).selected, { message: 'clicking empty image clears the selection' }).toEqual([]);
  await expect.poll(async () => { const [l, r] = await contourOutlines(page); return l.w === r.w; }).toBe(true);
  expect((await contourSnapshot(page)).total, 'the Select tool never draws').toBe(2);
});

test('clicking a Structure member row selects its contour on this slice', async ({ page }) => {
  // One contour, drawn with Freehand; selection is then cleared by switching away.
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  const panel = await openPanel(page);
  await panel.getByRole('button', { name: 'New Structure (RTSTRUCT)' }).click();
  await page.keyboard.press('Escape');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await toolbox.getByRole('button', { name: 'Freehand', exact: true }).click();
  const box = (await page.locator(`${VIEWPORT} canvas`).boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2, r = Math.min(box.width, box.height) * 0.1;
  await page.mouse.move(cx + r, cy);
  await page.mouse.down();
  for (let i = 1; i <= 32; i++) {
    const a = (i / 32) * 2 * Math.PI;
    await page.mouse.move(cx + r * Math.cos(a), cy + r * Math.sin(a), { steps: 2 });
  }
  await page.mouse.up();
  await expect.poll(async () => (await contourOutlines(page)).length).toBe(1);
  await toolbox.getByRole('button', { name: 'Select ROI', exact: true }).click();
  await page.mouse.click(box.x + 5, box.y + 5); // empty image: clear the draw's selection
  await expect.poll(async () => (await contourSnapshot(page)).selected).toEqual([]);
  const [before] = await contourOutlines(page);

  await panel.locator('[data-testid^="member-row-"]').first().click();
  await expect.poll(async () => (await contourSnapshot(page)).selected, { message: 'the row selects the contour' }).toHaveLength(1);
  await expect.poll(async () => (await contourOutlines(page))[0].w, { message: 'and it is drawn thicker' }).toBeGreaterThan(before.w);
});
