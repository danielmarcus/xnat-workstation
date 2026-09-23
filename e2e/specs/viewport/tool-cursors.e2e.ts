/**
 * Every navigation, measurement and structure tool shows Cornerstone's own cursor.
 *
 * Reported as "the mouse cursor is an arrow when a tool is selected". The app's single
 * cursor authority resolved every tool outside the segmentation set to an EMPTY CSS
 * cursor and wrote it over the glyph Cornerstone's setToolActive had just applied — so
 * the pointer was the OS arrow for W/L, Pan, Zoom, Length and the rest.
 *
 * Drives the real toolbar and side-panel toolbox, hovers the canvas, and reads the
 * computed cursor. Cornerstone's SVG cursors are blob URLs stamped `#<Name>-pointer`,
 * so the descriptor name is a stable identity.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

const cursor = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector('[data-testid="unified-viewport-element:panel_0"]') as HTMLElement;
    const c = getComputedStyle(el).cursor;
    const named = c.match(/#([A-Za-z0-9_.]+)-pointer/);
    if (named) return named[1];
    if (c.startsWith('url(')) return 'url:UNNAMED';
    return c;
  });

async function hover(page: Page, i: number) {
  const box = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2 + i * 3, box.y + box.height / 2 + i * 2, { steps: 2 });
  await page.waitForTimeout(150);
}

async function toolbox(page: Page, create: string) {
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: create }).click();
  const box = panel.locator('[data-testid="context-toolbox"]');
  await expect(box).toBeVisible({ timeout: 10_000 });
  return box;
}

const NAV: Array<[string, string]> = [
  ['Pan (left-click drag)', 'Pan'],
  ['Zoom (left-click drag)', 'Zoom'],
  // Our own registration: the crosshair pointer without Cornerstone's tool icon.
  ['Crosshairs (left-click to sync; left-drag W/L)', 'XnatCrosshair'],
  ['Window/Level (left-click drag)', 'WindowLevel'],
];

const MEASUREMENT: Array<[string, string]> = [
  ['Length', 'Length'],
  ['Angle', 'Angle'],
  ['Bidir.', 'Bidirectional'],
  ['Ellipse', 'EllipticalROI'],
  ['Rect ROI', 'RectangleROI'],
  ['Circle ROI', 'CircleROI'],
  ['Probe', 'Probe'],
  ['Arrow', 'ArrowAnnotate'],
  ['Freehand ROI', 'FreehandROI'],
];

const STRUCTURE: Array<[string, string]> = [
  ['Freehand', 'FreehandROI'],
  ['Spline', 'FreehandROI'],
  ['Livewire', 'FreehandROI'],
  ['Sculptor', 'FreehandROISculptor'],
];

test('toolbar navigation tools show their Cornerstone cursor', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  for (const [i, [title, expected]] of NAV.entries()) {
    await page.locator(`button[title="${title}"]`).click();
    await hover(page, i);
    expect(await cursor(page), `"${title}"`).toBe(expected);
  }
});

test('measurement tools show their Cornerstone cursor', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  const box = await toolbox(page, 'New Measurement (SR)');
  for (const [i, [label, expected]] of MEASUREMENT.entries()) {
    await box.getByLabel(label, { exact: true }).click();
    await hover(page, i);
    expect(await cursor(page), `"${label}"`).toBe(expected);
  }
});

test('structure tools show their Cornerstone cursor', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  const box = await toolbox(page, 'New Structure (RTSTRUCT)');
  for (const [i, [label, expected]] of STRUCTURE.entries()) {
    await box.getByLabel(label, { exact: true }).click();
    await hover(page, i);
    expect(await cursor(page), `"${label}"`).toBe(expected);
  }
});

test('the crosshair cursor is the bare crosshair, with no tool icon beside it', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.locator('button[title="Crosshairs (left-click to sync; left-drag W/L)"]').click();
  await hover(page, 0);
  // Rasterise the image the pointer is actually drawn from and count painted pixels by
  // quadrant. Cornerstone lays a pointer cursor out as a 32x32 image: the crosshair in the
  // top-left 16x16 (hotspot 8,8), the tool icon in the bottom-right 16x16. That quadrant
  // must be empty.
  const painted = await page.evaluate(async () => {
    const el = document.querySelector('[data-testid="unified-viewport-element:panel_0"]') as HTMLElement;
    const url = getComputedStyle(el).cursor.match(/url\("?([^")]+)/)?.[1];
    if (!url) return null;
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const count = (x: number, y: number, w: number, h: number) => {
      const d = ctx.getImageData(x, y, w, h).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
      return n;
    };
    return { size: [img.naturalWidth, img.naturalHeight], pointer: count(0, 0, 16, 16), icon: count(16, 16, 16, 16) };
  });
  expect(painted, 'the crosshair cursor should be an image').not.toBeNull();
  expect(painted!.size).toEqual([32, 32]);
  expect(painted!.pointer, 'the crosshair itself is drawn').toBeGreaterThan(10);
  expect(painted!.icon, 'no tool icon beside the crosshair').toBe(0);
});

/**
 * Shift swaps which nav tool a left-drag drives (shift-nav-swap.e2e.ts), so the pointer
 * must show the tool that WILL act — and, mid-drag, the one that IS acting. Cornerstone
 * picks the tool at mousedown and keeps it for the drag, so toggling Shift mid-drag must
 * not change the cursor either.
 */
test('Pan/Zoom cursor follows Shift, and stays with the drag that is in progress', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  const box = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  for (const [title, self, partner] of [
    ['Pan (left-click drag)', 'Pan', 'Zoom'],
    ['Zoom (left-click drag)', 'Zoom', 'Pan'],
  ]) {
    await page.locator(`button[title="${title}"]`).click();
    await page.mouse.move(cx, cy);
    await expect.poll(() => cursor(page), { message: `${self}: hover` }).toBe(self);

    await page.keyboard.down('Shift');
    await expect.poll(() => cursor(page), { message: `${self}: Shift held` }).toBe(partner);

    // Shift-drag, releasing Shift mid-drag: still the partner's drag.
    await page.mouse.down();
    await page.mouse.move(cx + 20, cy + 20, { steps: 4 });
    await expect.poll(() => cursor(page), { message: `${self}: Shift-drag` }).toBe(partner);
    await page.keyboard.up('Shift');
    await page.mouse.move(cx + 30, cy + 30, { steps: 2 });
    await expect.poll(() => cursor(page), { message: `${self}: Shift released mid-drag` }).toBe(partner);
    await page.mouse.up();
    await expect.poll(() => cursor(page), { message: `${self}: drag over, no Shift` }).toBe(self);

    // Plain drag, pressing Shift mid-drag: still this tool's drag.
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 20, cy + 20, { steps: 4 });
    await page.keyboard.down('Shift');
    await page.mouse.move(cx + 30, cy + 30, { steps: 2 });
    await expect.poll(() => cursor(page), { message: `${self}: Shift pressed mid-drag` }).toBe(self);
    await page.mouse.up();
    await expect.poll(() => cursor(page), { message: `${self}: drag over, Shift still held` }).toBe(partner);
    await page.keyboard.up('Shift');
    await expect.poll(() => cursor(page), { message: `${self}: Shift released` }).toBe(self);
  }
});
