/**
 * The sphere brush family, driven from the panel's toolbox.
 *
 * These four shipped greyed out as "planned" although Cornerstone had them all along:
 * they are STRATEGIES on the BrushTool the app already registers
 * (FILL_INSIDE_SPHERE, ERASE_INSIDE_SPHERE, THRESHOLD_INSIDE_SPHERE, and the island-
 * removal variant), and only the strategy mapping was missing.
 *
 * The assertion that matters is the one that separates a sphere from a circle: a 3D
 * kernel writes into NEIGHBOURING SLICES from a single stroke, where the circle brush
 * touches exactly one. Asserting "it painted something" would pass with the circle
 * strategy still selected and prove nothing — the failure mode these tools invite, since
 * an unmapped strategy silently falls back to FILL_INSIDE_CIRCLE.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

type Win = { __XNAT_E2E__: {
  getPaintedVoxelsPerSlice: () => Array<{ segmentationId: string; dims: [number, number, number]; perSlice: number[] }>;
  getPaintedVoxelCount: () => number;
  setUnifiedBrushSize: (n: number) => void;
  setUnifiedBrushThreshold: (r: [number, number]) => void;
  resetUnifiedSegmentations: () => void;
  isUnifiedVolumeReady: () => boolean;
}; };

/** Distinct slices carrying any painted voxel, across every labelmap. */
const slicesTouched = async (page: Page): Promise<number> => {
  const vols = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelsPerSlice());
  const idx = new Set<number>();
  for (const v of vols) v.perSlice.forEach((n, i) => { if (n > 0) idx.add(i); });
  return idx.size;
};

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

async function stroke(page: Page) {
  const box = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;
  const y = box.y + box.height * 0.5;
  await page.mouse.move(box.x + box.width * 0.46, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.54, y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(1200);
}

/** Pick a tool by its real toolbox button, not by a hook. */
const pickTool = (panel: ReturnType<Page['locator']>, label: string) =>
  panel.getByRole('button', { name: label, exact: true }).click();

test('the spherical brush paints across slices; the circle brush does not', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.isUnifiedVolumeReady()), { timeout: 30_000 }).toBe(true);
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());

  // Baseline: the plain circle brush touches exactly one slice.
  let panel = await newSegmentation(page);
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setUnifiedBrushSize(12));
  await pickTool(panel, 'Brush');
  await stroke(page);
  expect(await slicesTouched(page), 'the circle brush marks one slice').toBe(1);

  // The sphere brush, same stroke, must reach more.
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
  panel = await newSegmentation(page);
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setUnifiedBrushSize(12));
  await pickTool(panel, 'Sph. Brush');
  await stroke(page);
  expect(
    await slicesTouched(page),
    'a spherical kernel must reach neighbouring slices — one slice means the strategy fell back to the circle brush',
  ).toBeGreaterThan(1);
});

test('the spherical brush in erase mode removes across slices', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.isUnifiedVolumeReady()), { timeout: 30_000 }).toBe(true);
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());

  const panel = await newSegmentation(page);
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setUnifiedBrushSize(14));
  await pickTool(panel, 'Sph. Brush');
  await stroke(page);
  const painted = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelCount());
  const spread = await slicesTouched(page);
  expect(painted).toBeGreaterThan(0);
  expect(spread).toBeGreaterThan(1);

  // Sph. Eraser retired into the shared edit mode: same tool, erase mode.
  await panel.getByRole('button', { name: 'erase', exact: true }).click();
  await stroke(page);
  expect(
    await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelCount()),
    'erasing over the same path must remove voxels, not add them',
  ).toBeLessThan(painted);
});

test('the spherical threshold brush respects the intensity window', async ({ page }) => {
  await loadFixture(page, 'ct-axial-anatomy', 'panel_0');
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.isUnifiedVolumeReady()), { timeout: 30_000 }).toBe(true);
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());

  // A window that excludes everything under the stroke must paint less than a wide one.
  const panel = await newSegmentation(page);
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setUnifiedBrushSize(14));
  await pickTool(panel, 'Sph. Thresh');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setUnifiedBrushThreshold([-2000, 4000]));
  await stroke(page);
  const wide = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelCount());
  expect(wide, 'a wide window paints').toBeGreaterThan(0);

  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
  const panel2 = await newSegmentation(page);
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setUnifiedBrushSize(14));
  await pickTool(panel2, 'Sph. Thresh');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setUnifiedBrushThreshold([3000, 3200]));
  await stroke(page);
  expect(
    await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelCount()),
    'a narrow window must paint less — equal counts mean the window is being ignored',
  ).toBeLessThan(wide);
});

/**
 * Dynamic threshold picks its intensity window from the voxel you click, rather than the
 * configured one — that is the whole difference from Threshold Brush, and it is what the
 * assertion has to separate.
 *
 * So: set a window that would paint NOTHING, then use each tool. Threshold Brush obeys it
 * and paints nothing; Dynamic Threshold ignores it, samples what is under the cursor, and
 * paints. A spec that only checked "it paints" would pass with the plain threshold
 * strategy still mapped.
 *
 * It was first mapped to THRESHOLD_INSIDE_SPHERE_WITH_ISLAND_REMOVAL on the strength of
 * the name. That strategy runs island removal on interaction-end against a
 * previewSegmentIndex, part of Cornerstone's preview workflow which this app does not
 * implement — it painted and then removed everything, measuring 0 voxels.
 */
test('dynamic threshold samples the clicked voxel instead of the configured window', async ({ page }) => {
  await loadFixture(page, 'ct-axial-anatomy', 'panel_0');
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.isUnifiedVolumeReady()), { timeout: 30_000 }).toBe(true);

  // A window far outside anything in the image.
  const IMPOSSIBLE: [number, number] = [9000, 9500];

  const paintWith = async (toolLabel: string) => {
    await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
    const panel = await newSegmentation(page);
    await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setUnifiedBrushSize(14));
    await pickTool(panel, toolLabel);
    await page.evaluate((r) => (window as unknown as Win).__XNAT_E2E__.setUnifiedBrushThreshold(r), IMPOSSIBLE);
    await stroke(page);
    return page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelCount());
  };

  expect(
    await paintWith('Threshold'),
    'the fixed-window threshold brush must paint nothing for a window nothing matches',
  ).toBe(0);

  expect(
    await paintWith('Dyn. Thresh'),
    'dynamic threshold must ignore that window and sample the clicked voxel instead',
  ).toBeGreaterThan(0);
});
