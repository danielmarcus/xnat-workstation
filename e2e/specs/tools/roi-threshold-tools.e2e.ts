/**
 * Rect Multi: drag a rectangle, and everything inside it within the intensity window
 * joins the segment.
 *
 * It shipped greyed out, and the reason is worth keeping: Cornerstone's
 * RectangleROIThreshold tool only DRAWS a region. Nothing in the library applies a fill —
 * `rectangleROIThresholdVolumeByRange` exists but has no caller, because the application
 * decides when to run it. So the tool was registered, drawable, and completely without
 * effect: exactly the "silent no-op" the catalog warned about.
 *
 * The fill runs against a segmentation VOLUME. The panel builds per-slice masks, and
 * `getOrCreateSegmentationVolume` wraps those same images rather than copying them, so
 * writes reach the slices directly — the mechanism the sphere brush already depends on.
 *
 * Each spec asserts the fill LANDED and that it respected the window, because "voxels
 * appeared" would also pass if the region were filled wholesale, which is the obvious way
 * to get this wrong.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

type Win = { __XNAT_E2E__: {
  setActiveUnifiedTool: (t: string) => void;
  setUnifiedBrushThreshold: (r: [number, number]) => void;
  getPaintedVoxelCount: () => number;
  resetUnifiedSegmentations: () => void;
  isUnifiedVolumeReady: () => boolean;
}; };

async function newSegmentation(page: Page) {
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await panel.getByLabel('Rename container').press('Enter');
  const mr = panel.getByLabel('Rename member');
  if (await mr.count()) await mr.press('Enter');
  return panel;
}

/** Drag a region across the middle of the image. */
async function dragRegion(page: Page) {
  const box = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.38, box.y + box.height * 0.38);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.62, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(2000);
}

// A circle variant was removed from the app entirely rather than shipped disabled:
// Cornerstone's fill utility rejects a circle annotation outright
// ("rectangleROIThresholdVolumeByRange only supports RectangleROIThreshold and
// RectangleROIStartEndThreshold"), so there was no path to implementing it.
for (const tool of [
  { label: 'Rect Multi', name: 'rectangle' },
]) {
  test(`${tool.label} fills the segment inside the region, within the intensity window`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await loadFixture(page, 'ct-axial-anatomy', 'panel_0');
    await expect.poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.isUnifiedVolumeReady()), { timeout: 30_000 }).toBe(true);

    const fillWith = async (range: [number, number]) => {
      await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
      const panel = await newSegmentation(page);
      await panel.getByRole('button', { name: tool.label, exact: true }).click();
      await page.evaluate((r) => (window as unknown as Win).__XNAT_E2E__.setUnifiedBrushThreshold(r), range);
      await dragRegion(page);
      return page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelCount());
    };

    const wide = await fillWith([-2000, 4000]);
    expect(pageErrors, `drawing the region must not throw: ${pageErrors[0] ?? ''}`).toEqual([]);
    expect(wide, 'a wide window must fill the region — 0 means the ROI was drawn and never applied').toBeGreaterThan(0);

    const narrow = await fillWith([3500, 3600]);
    expect(
      narrow,
      'a window nothing in the region matches must fill less — equal counts mean the region was filled wholesale, ignoring intensities',
    ).toBeLessThan(wide);
  });
}
