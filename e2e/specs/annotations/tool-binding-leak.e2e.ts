/**
 * Switching tools must not leave the previous one wired to the mouse.
 *
 * Reported as "shift to invert brush to erase actually fills a circle — the wrong tool
 * AND the wrong mode". Cause: the Shift+Primary binding the edit-mode tools need.
 * Cornerstone's `setToolPassive` only strips bindings matching
 * `getDefaultPrimaryBindings()` — plain Primary — so a `{Primary + Shift}` binding
 * survives demotion, and:
 *
 *     if (toolOptions.bindings.length !== 0) { mode = Active; }
 *
 * keeps the demoted tool ACTIVE. Use Circle once and CircleScissors holds a live
 * Shift+Primary binding for the rest of the session; select Brush and Shift-drag, and
 * the scissors answer instead — filling a disc where an erase was asked for.
 *
 * This must be an E2E: the unit mock does not emulate Cornerstone's binding filtering,
 * so a mocked assertion would be testing the mock.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

type Win = {
  __XNAT_E2E__: {
    resetUnifiedSegmentations: () => void;
    getPaintedVoxelCount: () => number;
    setUnifiedBrushSize: (n: number) => void;
  };
};

const paintedVoxels = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelCount());

async function segToolbox(page: Page) {
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await expect(panel.locator('[data-testid^="member-row-"]').first()).toBeVisible({ timeout: 15_000 });
  return panel;
}

async function drag(page: Page, from: [number, number], to: [number, number], shift = false) {
  const box = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 10 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
  await page.waitForTimeout(400);
}

test('a shape tool used earlier does not answer Shift-drag once the brush is selected', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
  const panel = await segToolbox(page);
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setUnifiedBrushSize(20));

  // Use Circle first — this is what leaves the stale Shift binding behind.
  await panel.getByRole('button', { name: 'Circle', exact: true }).click();
  await panel.getByRole('button', { name: 'fill', exact: true }).click();
  await drag(page, [130, 130], [200, 200]);
  const afterCircle = await paintedVoxels(page);
  expect(afterCircle, 'the circle should have filled something to erase').toBeGreaterThan(0);

  // Now the brush, and Shift-drag over the filled area. Shift inverts fill→erase, so
  // this must REMOVE voxels. If the stale scissors binding wins it ADDS a disc instead.
  await panel.getByRole('button', { name: 'Brush', exact: true }).click();
  await drag(page, [140, 140], [190, 190], true);

  expect(
    await paintedVoxels(page),
    'Shift-drag with the brush must erase; more voxels means the old shape tool answered',
  ).toBeLessThan(afterCircle);
});

test('only the active tool is bound to the mouse after a switch', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
  const panel = await segToolbox(page);

  for (const tool of ['Circle', 'Rect', 'Sphere', 'Brush', 'Sph. Brush', 'Threshold']) {
    await panel.getByRole('button', { name: tool, exact: true }).click();
    await page.waitForTimeout(120);
    const bound = await page.evaluate(() => {
      const w = window as unknown as { __XNAT_E2E__: { toolsBoundToPrimary?: () => string[] } };
      return w.__XNAT_E2E__.toolsBoundToPrimary?.() ?? null;
    });
    expect(bound, 'the E2E hook must exist for this assertion to mean anything').not.toBeNull();
    expect(
      bound!.length,
      `after selecting "${tool}", these tools still answer the primary button: ${bound!.join(', ')}`,
    ).toBe(1);
  }
});
