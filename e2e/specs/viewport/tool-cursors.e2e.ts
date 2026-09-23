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
  ['Crosshairs (left-click to sync; left-drag W/L)', 'Crosshairs'],
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
