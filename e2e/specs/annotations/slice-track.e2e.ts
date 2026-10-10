/**
 * The slice track on the viewport scrollbar (SegWorks parity D5 —
 * docs/mockup/segworks-wireframes.html §7): the active segment's slices are marked on
 * the scrollbar in its colour, numbered as the viewport numbers them; while the Cleanup
 * sheet's scope is a Range, the range is drawn there and its ends can be dragged.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';
import { clickTool } from '../../helpers/toolbox';

type Win = { __XNAT_E2E__: { clearAllContainers: () => void } };
const VIEWPORT = '[data-testid="unified-viewport-element:panel_0"]';
const SCROLLBAR = '[data-testid="viewport-scrollbar:panel_0"]';

test.beforeEach(({ page }) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers()));

async function stroke(page: Page, fx: number, fy: number) {
  const b = (await page.locator(`${VIEWPORT} canvas`).boundingBox())!;
  await page.mouse.move(b.x + b.width * fx, b.y + b.height * fy);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * (fx + 0.08), b.y + b.height * fy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}

const shownSlice = async (page: Page) =>
  Number((await page.getByTestId('overlay-field-imageIndex:panel_0').innerText()).split('/')[0].trim());

async function segmentation(page: Page) {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await clickTool(toolbox, 'Brush');
  return { panel, toolbox };
}

/** Coloured (non-grey) pixels in the scrollbar strip. */
async function colouredScrollbarPixels(page: Page): Promise<number> {
  const shot = (await page.locator(SCROLLBAR).screenshot()).toString('base64');
  return page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    // Red-dominant pixels: the segment's colour (the thumb is sky-blue, the track grey).
    for (let i = 0; i < px.length; i += 4) if (px[i] > 120 && px[i] > px[i + 1] + 50 && px[i] > px[i + 2] + 50) n++;
    return n;
  }, shot);
}

test('the scrollbar marks the slices the active segment is on, in the viewport\'s numbering', async ({ page }) => {
  await segmentation(page);
  await stroke(page, 0.4, 0.5);
  const first = await shownSlice(page);
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(250);
  await stroke(page, 0.4, 0.5);
  const second = await shownSlice(page);

  const bands = page.locator(`${SCROLLBAR} [data-testid="slice-track-band"]`);
  await expect(bands).toHaveCount(2);
  const ranges = await bands.evaluateAll((els) => els.map((e) => [Number(e.getAttribute('data-from')), Number(e.getAttribute('data-to'))]));
  expect(ranges.flat().sort((a, b) => a - b)).toEqual([first, first, second, second].sort((a, b) => a - b));
  expect(await colouredScrollbarPixels(page), 'the bands are drawn').toBeGreaterThan(10);

  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(bands).toHaveCount(0);
  expect(await colouredScrollbarPixels(page)).toBe(0);
});

test('with no segment active the scrollbar is unmarked', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await expect(page.locator(SCROLLBAR)).toBeVisible();
  await expect(page.locator(`${SCROLLBAR} [data-testid="slice-track-band"]`)).toHaveCount(0);
});

test('a Range scope is drawn on the track, and dragging its end edits the range', async ({ page }) => {
  const { panel, toolbox } = await segmentation(page);
  const current = await shownSlice(page);
  await toolbox.getByRole('tab', { name: 'Process' }).click();
  await toolbox.getByRole('button', { name: 'Cleanup', exact: true }).click();
  const sheet = panel.getByTestId('cleanup-sheet');
  await sheet.getByRole('group', { name: 'Slices' }).getByRole('button', { name: 'Range' }).click();

  const range = page.locator(`${SCROLLBAR} [data-testid="slice-track-range"]`);
  await expect(range).toHaveAttribute('data-from', String(current));
  await expect(range).toHaveAttribute('data-to', String(current));

  // Typing in the sheet moves the bracket…
  await sheet.getByLabel('Range to').fill(String(current + 3));
  await expect(range).toHaveAttribute('data-to', String(current + 3));

  // …and dragging the bracket's end to the bottom of the track edits the sheet.
  const end = page.locator(`${SCROLLBAR} [data-testid="slice-track-range-end"]`);
  const eb = (await end.boundingBox())!;
  const sb = (await page.locator(SCROLLBAR).boundingBox())!;
  await page.mouse.move(eb.x + eb.width / 2, eb.y + eb.height / 2);
  await page.mouse.down();
  await page.mouse.move(eb.x + eb.width / 2, sb.y + sb.height - 1, { steps: 6 });
  await page.mouse.up();
  const total = Number((await page.getByTestId('overlay-field-imageIndex:panel_0').innerText()).split('/')[1].trim());
  await expect(sheet.getByLabel('Range to')).toHaveValue(String(total));
  // The viewport did not scroll: the drag edited the range, not the slice.
  expect(await shownSlice(page)).toBe(current);
});
