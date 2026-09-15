/**
 * A brush affects only the slice it is drawn on — labelmaps are never interpolated.
 *
 * There used to be a bespoke labelmap interpolation that ran automatically on EVERY
 * edit (`onSegmentationDataModified` → scheduleLabelmapInterpolation). Cornerstone has
 * no such feature — its InterpolationManager is contour-only — and the default
 * "morphological" algorithm built an UNSIGNED distance field but kept the signed
 * formulation's `blended > 0` test, so it was a union, not an interpolation: painting
 * slice 4 and slice 8 put BOTH shapes on 5, 6 and 7, identically, regardless of alpha.
 * Measured: 1958 and 1952 voxels on the drawn slices, 3426 on every slice between.
 *
 * Contour interpolation (Cornerstone's, on the contour tools) is untouched.
 */
import { test, expect } from '../../fixtures/electron-app';
import { loadFixture } from '../../helpers/local-fixture';

type Win = { __XNAT_E2E__: {
  setActiveUnifiedTool: (t: string) => void;
  createUnifiedLabelmapSegmentation: (l?: string) => Promise<unknown>;
  setUnifiedBrushSize: (n: number) => void;
  isUnifiedVolumeReady: () => boolean;
  resetUnifiedSegmentations: () => void;
  scrollActiveViewport: (d: number) => void;
  getPaintedVoxelsPerSlice: () => Array<{ segmentationId: string; dims: [number, number, number]; perSlice: number[] }>;
}; };

test('painting two separated slices leaves the slices between them empty', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.isUnifiedVolumeReady()), { timeout: 30_000 })
    .toBe(true);
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.createUnifiedLabelmapSegmentation('No-Interp SEG'));
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setUnifiedBrushSize(40));
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setActiveUnifiedTool('Brush'));

  const box = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;
  const stroke = async () => {
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.42, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.58, y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(900);
  };

  await stroke();
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.scrollActiveViewport(4));
  await page.waitForTimeout(600);
  await stroke();

  const vols = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelsPerSlice());
  const painted = vols.flatMap((v) => v.perSlice.map((n, i) => ({ i, n })).filter((s) => s.n > 0));
  const indices = [...new Set(painted.map((p) => p.i))].sort((a, b) => a - b);

  expect(
    indices.length,
    `two strokes should touch exactly two slices, got ${indices.length}: ${JSON.stringify(painted)}`,
  ).toBe(2);
  // …and they must be the two we drew on, four apart — nothing generated between them.
  expect(indices[1] - indices[0]).toBe(4);
});
