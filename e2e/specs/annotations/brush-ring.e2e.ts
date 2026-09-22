/**
 * The brush hover ring: where it may appear, and what its size means.
 *
 * Reported as "when I am in the brush tool and move outside the current viewport, a
 * circle annotation appears". Two findings behind that:
 *
 *  - A ring stranded in a viewport the pointer has left. Per-element `mouseleave`
 *    handlers cover the ordinary case, but viewport elements are recreated by layout and
 *    hanging-protocol changes, so an unwired element has no handler. The guard is now
 *    document-level and does not depend on wiring.
 *  - The ring looked far too large for the stated size because the size is in WORLD
 *    MILLIMETRES while the UI said "px". Measured: slider 5 drew a 32.8px radius, and
 *    17.4px after a zoom change — the same setting, a different pixel size. A correctly
 *    sized ring read as a bug because the label lied.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

type Win = { __XNAT_E2E__: {
  resetUnifiedSegmentations: () => void;
  setLayoutPreset: (p: string) => void;
  setUnifiedBrushSize: (n: number) => void;
}; };

/** Brush rings per viewport, with radii, read from the SVG the user actually sees. */
const rings = (page: Page) =>
  page.evaluate(() => {
    const out: Record<string, number[]> = {};
    document.querySelectorAll('[data-testid^="unified-viewport-element:"]').forEach((el) => {
      const id = (el as HTMLElement).dataset.testid!.split(':')[1];
      out[id] = Array.from(el.querySelectorAll('svg circle')).map((c) =>
        Number((c as SVGCircleElement).getAttribute('r')),
      );
    });
    return out;
  });

const ringCount = async (page: Page) =>
  Object.values(await rings(page)).reduce((n, rs) => n + rs.length, 0);

async function brushOnNewSeg(page: Page) {
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await expect(panel.locator('[data-testid^="member-row-"]').first()).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'Brush', exact: true }).click();
  return panel;
}

test('the ring never outlives the pointer leaving the viewports', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setLayoutPreset('mpr-2x2'));
  await page.waitForTimeout(2500);
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
  const panel = await brushOnNewSeg(page);

  const box = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
  await page.waitForTimeout(300);
  expect(await ringCount(page), 'hovering a viewport should show exactly one ring').toBe(1);

  // Out of the viewports entirely — over the side panel.
  const pb = (await panel.boundingBox())!;
  await page.mouse.move(pb.x + pb.width / 2, pb.y + 150, { steps: 8 });
  await page.waitForTimeout(400);
  expect(
    await ringCount(page),
    'no viewport may keep a brush ring once the pointer is outside them all',
  ).toBe(0);
});

test('only ever one viewport shows the ring, whichever the pointer is in', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setLayoutPreset('mpr-2x2'));
  await page.waitForTimeout(2500);
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
  await brushOnNewSeg(page);

  for (const id of ['panel_0', 'panel_1', 'panel_2', 'panel_3']) {
    const b = await page.locator(`[data-testid="unified-viewport-element:${id}"] canvas`).boundingBox();
    if (!b) continue;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
    await page.waitForTimeout(280);
    const perViewport = await rings(page);
    const total = Object.values(perViewport).reduce((n, rs) => n + rs.length, 0);
    expect(total, `hovering ${id} left rings in: ${JSON.stringify(perViewport)}`).toBeLessThanOrEqual(1);
    expect((perViewport[id] ?? []).length, `the ring should be in ${id}, the hovered one`).toBe(total);
  }
});

test('brush size is world millimetres, and the UI does not call it pixels', async ({ page }) => {
  // The same setting must render a different PIXEL radius at a different zoom — that is
  // what "world units" means, and it is why the ring can look far bigger than "5".
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
  const panel = await brushOnNewSeg(page);
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setUnifiedBrushSize(5));

  const box = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
  await page.waitForTimeout(300);
  const before = (await rings(page)).panel_0?.[0];
  expect(before, 'a ring should be drawn').toBeGreaterThan(0);

  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setLayoutPreset('mpr-2x2'));
  await page.waitForTimeout(2500);
  const box2 = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;
  await page.mouse.move(box2.x + box2.width / 2 + 6, box2.y + box2.height / 2 + 4, { steps: 3 });
  await page.waitForTimeout(400);
  const after = (await rings(page)).panel_0?.[0];

  expect(await panel.getByLabel('Brush size').inputValue(), 'the setting itself is unchanged').toBe('5');
  expect(after, 'the same setting at a different zoom must draw a different pixel radius').not.toBeCloseTo(before!, 0);
  await expect(
    panel.getByText(/\d+\s*px/),
    'the control must not label a world-millimetre value as pixels',
  ).toHaveCount(0);
});
