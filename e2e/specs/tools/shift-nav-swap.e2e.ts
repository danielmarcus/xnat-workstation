/**
 * Shift+left-drag swaps the two navigation tools: under Pan it zooms, under Zoom it
 * pans. Cornerstone dispatches on an EXACT modifier match, so before the swap binding
 * existed a Shift-drag under either tool matched nothing and did nothing.
 *
 * Drives real toolbar clicks and real Shift-drags on the canvas, and reads the camera:
 * zoom moves parallelScale, pan moves only the focal point.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

type Win = {
  __XNAT_E2E__: {
    getPanelFocalPoint: (panelId: string) => [number, number, number] | null;
    getPanelParallelScale: (panelId: string) => number | null;
    getUnifiedToolsWithPrimary: () => string[];
  };
};

const camera = (page: Page) =>
  page.evaluate(() => {
    const h = (window as unknown as Win).__XNAT_E2E__;
    return { focal: h.getPanelFocalPoint('panel_0')!, scale: h.getPanelParallelScale('panel_0')! };
  });

async function drag(page: Page, shift: boolean) {
  const box = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 80, { steps: 12 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
  await page.waitForTimeout(300);
}

const moved = (a: number[], b: number[]) => a.some((v, i) => Math.abs(v - b[i]) > 1e-3);

test('Shift-drag zooms with Pan active and pans with Zoom active', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');

  await page.locator('button[title="Pan (left-click drag)"]').click();
  // Plain left-click still belongs to Pan alone.
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getUnifiedToolsWithPrimary()))
    .toEqual(['Pan']);

  let before = await camera(page);
  await drag(page, false);
  let after = await camera(page);
  expect(after.scale, 'plain drag under Pan must not zoom').toBeCloseTo(before.scale, 5);
  expect(moved(after.focal, before.focal), 'plain drag under Pan must pan').toBe(true);

  before = after;
  await drag(page, true);
  after = await camera(page);
  expect(Math.abs(after.scale - before.scale), 'Shift-drag under Pan must zoom').toBeGreaterThan(1e-3);

  await page.locator('button[title="Zoom (left-click drag)"]').click();
  before = await camera(page);
  await drag(page, true);
  after = await camera(page);
  expect(after.scale, 'Shift-drag under Zoom must not zoom').toBeCloseTo(before.scale, 5);
  expect(moved(after.focal, before.focal), 'Shift-drag under Zoom must pan').toBe(true);

  // Leaving the nav tools drops the swap: Shift-drag under W/L touches neither.
  await page.locator('button[title="Window/Level (left-click drag)"]').click();
  before = await camera(page);
  await drag(page, true);
  after = await camera(page);
  expect(after.scale, 'Shift-drag under W/L must not zoom').toBeCloseTo(before.scale, 5);
  expect(moved(after.focal, before.focal), 'Shift-drag under W/L must not pan').toBe(false);
});
