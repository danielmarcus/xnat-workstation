/**
 * Switching back to an existing Segmentation from the panel makes it the one the brush
 * paints into.
 *
 * Reported: with two Segmentations on a scan, activating the first one again (its member
 * row went active and the toolbox named it) left the brush painting into the second —
 * the panel switched, the viewport did not.
 *
 * Drives the real panel (container name / member row) and the real brush, and checks
 * which container's labelmap the new paint lands in.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

type Win = {
  __XNAT_E2E__: {
    clearAllContainers: () => void;
    getPaintedVoxelsPerSlice: () => Array<{ segmentationId: string; perSlice: number[] }>;
  };
};
const VIEWPORT = '[data-testid="unified-viewport-element:panel_0"]';

test.beforeEach(({ page }) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers()));

/** Painted voxels per container (a container's labelmap layers carry its id as prefix). */
const paintedBy = (page: Page, containerId: string) =>
  page.evaluate(
    (cid) =>
      (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelsPerSlice()
        .filter((l) => l.segmentationId === cid || l.segmentationId.startsWith(`${cid}_`))
        .reduce((sum, l) => sum + l.perSlice.reduce((a, b) => a + b, 0), 0),
    containerId,
  );

async function stroke(page: Page, fx: number, fy: number) {
  const box = (await page.locator(`${VIEWPORT} canvas`).boundingBox())!;
  const x = box.x + box.width * fx, y = box.y + box.height * fy;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + box.width * 0.08, y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
}

async function twoSegmentations(page: Page) {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  const rows = panel.locator('[data-testid^="container-row-"]');

  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  await expect(rows).toHaveCount(1);
  const a = (await rows.nth(0).getAttribute('data-testid'))!.replace('container-row-', '');
  await stroke(page, 0.3, 0.4);

  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  await expect(rows).toHaveCount(2);
  const ids = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.replace('container-row-', '')));
  const b = ids.find((id) => id !== a)!;
  await stroke(page, 0.3, 0.6);

  await expect.poll(() => paintedBy(page, a), { message: 'A painted' }).toBeGreaterThan(0);
  await expect.poll(() => paintedBy(page, b), { message: 'B painted' }).toBeGreaterThan(0);
  return { panel, a, b };
}

test('clicking an earlier Segmentation\'s name makes the brush paint into it', async ({ page }) => {
  const { panel, a, b } = await twoSegmentations(page);
  const [a0, b0] = [await paintedBy(page, a), await paintedBy(page, b)];

  await panel.locator(`[data-testid="container-activate-${a}"]`).click();
  await stroke(page, 0.6, 0.5);

  await expect.poll(() => paintedBy(page, a), { message: 'the new stroke lands in the activated Segmentation' }).toBeGreaterThan(a0);
  expect(await paintedBy(page, b), 'and not in the other one').toBe(b0);
});

test('double-clicking an earlier Segmentation\'s segment row makes the brush paint into it', async ({ page }) => {
  const { panel, a, b } = await twoSegmentations(page);
  const [a0, b0] = [await paintedBy(page, a), await paintedBy(page, b)];

  const row = panel.locator(`[data-testid="container-row-${a}"]`).locator('xpath=following-sibling::*[1]')
    .locator('[data-testid^="member-row-"]').first();
  const fallback = panel.locator('[data-testid^="member-row-"]').first();
  const memberRow = (await row.count()) ? row : fallback;
  const box = (await memberRow.boundingBox())!;
  await memberRow.dblclick({ position: { x: box.width * 0.55, y: box.height / 2 } });
  await stroke(page, 0.6, 0.5);

  await expect.poll(() => paintedBy(page, a), { message: 'the new stroke lands in the activated Segmentation' }).toBeGreaterThan(a0);
  expect(await paintedBy(page, b), 'and not in the other one').toBe(b0);
});

test('switching back to a Segmentation after working in a Structure paints into it', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  const rows = panel.locator('[data-testid^="container-row-"]');
  const ids = () => rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.replace('container-row-', '')));

  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  await expect(rows).toHaveCount(1);
  const [a] = await ids();
  await stroke(page, 0.3, 0.4);

  // A Structure contour, drawn and left selected.
  await panel.getByRole('button', { name: 'New Structure (RTSTRUCT)' }).click();
  await page.keyboard.press('Escape');
  const toolbox = panel.locator('[data-testid="context-toolbox"]');
  await toolbox.getByRole('button', { name: 'Freehand', exact: true }).click();
  const box = (await page.locator(`${VIEWPORT} canvas`).boundingBox())!;
  const cx = box.x + box.width * 0.7, cy = box.y + box.height * 0.3, r = box.width * 0.06;
  await page.mouse.move(cx + r, cy);
  await page.mouse.down();
  for (let i = 1; i <= 24; i++) { const t = (i / 24) * 2 * Math.PI; await page.mouse.move(cx + r * Math.cos(t), cy + r * Math.sin(t), { steps: 2 }); }
  await page.mouse.up();
  await page.waitForTimeout(500);

  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await page.keyboard.press('Escape');
  await expect(rows).toHaveCount(3);
  const b = (await ids()).find((id) => id !== a && !id.startsWith('rtstruct'))!;
  await stroke(page, 0.3, 0.6);
  await expect.poll(() => paintedBy(page, b), { message: 'B painted' }).toBeGreaterThan(0);
  const [a0, b0] = [await paintedBy(page, a), await paintedBy(page, b)];

  await panel.locator(`[data-testid="container-activate-${a}"]`).click();
  await stroke(page, 0.55, 0.75);
  await expect.poll(() => paintedBy(page, a), { message: 'the new stroke lands in the activated Segmentation' }).toBeGreaterThan(a0);
  expect(await paintedBy(page, b), 'and not in the other one').toBe(b0);
});
