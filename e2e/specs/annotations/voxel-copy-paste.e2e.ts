/**
 * Signal 23 (D6) — live voxel copy/paste. Paint a region into the segmentation "New
 * Segmentation" creates (a multi-layer group, stack storage), COPY it (Ctrl+C), scroll
 * to a different slice, PASTE it (Ctrl+V): the region is NN-resampled, translated to the
 * current slice and written through the labelmap's live storage.
 *
 * The clipboard used to read only a `${id}_lm` labelmap VOLUME — a shape only the old
 * E2E create hook produced — so on every segmentation a user can make, Ctrl+C silently
 * copied nothing. Asserted per source image: the pasted slice carries exactly the
 * painted voxel count (same grid, pure translation) and the original slice is untouched.
 * The resample/translation math itself is covered by the voxelClipboard unit tests.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

interface E2EHooks {
  createUnifiedLabelmapSegmentation: (label?: string) => Promise<{ segmentationId: string; segmentIndex: number }>;
  setActiveUnifiedTool: (toolName: string) => void;
  setUnifiedBrushSize: (size: number) => void;
  getPaintedVoxelsPerImage: () => number[];
  getPanelSliceState: (panelId: string) => { imageIndex: number; displayedImageIndex: number };
}
type Win = { __XNAT_E2E__: E2EHooks };

const perImage = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelsPerImage());
const displayedIndex = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPanelSliceState('panel_0').displayedImageIndex);
const paintedSlices = (counts: number[]) => counts.flatMap((n, i) => (n > 0 ? [i] : []));

test('a copied voxel region pastes (NN-resampled) at a scrolled-to slice — signal 23', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  const p0 = page.locator('[data-testid="unified-viewport-element:panel_0"] canvas');
  await p0.click();
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.createUnifiedLabelmapSegmentation('Signal-23 SEG'));
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setUnifiedBrushSize(6));
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setActiveUnifiedTool('Brush'));

  const box = (await p0.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const d = Math.min(box.width, box.height) * 0.1;
  await page.mouse.move(cx - d, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy, { steps: 4 });
  await page.mouse.move(cx + d, cy + d, { steps: 4 });
  await page.mouse.up();

  await expect.poll(async () => paintedSlices(await perImage(page)).length, { timeout: 15_000 }).toBe(1);
  const before = await perImage(page);
  const [source] = paintedSlices(before);
  expect(source).toBe(await displayedIndex(page));

  // Copy, scroll 20 slices with the real navigation keys, paste.
  await page.keyboard.press('Control+c');
  const step = source + 20 < before.length ? 'ArrowDown' : 'ArrowUp';
  for (let i = 0; i < 20; i++) await page.keyboard.press(step);
  await expect.poll(() => displayedIndex(page)).not.toBe(source);
  const target = await displayedIndex(page);
  await page.waitForTimeout(300);
  const unpasted = await p0.screenshot();
  await page.keyboard.press('Control+v');

  await expect.poll(async () => paintedSlices(await perImage(page)), { timeout: 10_000 })
    .toEqual([source, target].sort((a, b) => a - b));
  const after = await perImage(page);
  expect(after[target], 'the pasted slice carries the copied region, voxel for voxel').toBe(before[source]);
  expect(after[source], 'the source slice is untouched').toBe(before[source]);
  // ...and it is DRAWN there, not only written: the viewport's pixels change.
  await expect.poll(async () => (await p0.screenshot()).equals(unpasted), { timeout: 5_000 }).toBe(false);
});
