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
