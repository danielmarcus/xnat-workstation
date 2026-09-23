/**
 * A series holding several orientations — a 3-plane localizer — is not a volume.
 *
 * Reported on a real localizer: painting worked on some slices and not others, the
 * slice number and scrollbar disagreed with the arrow keys ("at slice 1 I can still
 * arrow to additional slices"), and Cornerstone logged "No imageId found within the
 * specified criteria" on every scroll. Every multi-image panel was loaded as ONE
 * volume, so the three planes were stacked into a single block: most of its slices
 * matched no acquired image, and the labelmap had nothing to write into there.
 *
 * Drives real key presses and real brush strokes on `mr-localizer-3plane` (axial,
 * sagittal with a different matrix, coronal — 5 images each, one series).
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../../helpers/local-fixture';

type SliceState = { imageIndex: number; totalImages: number; displayedImageId: string | null; displayedImageIndex: number };
type Win = {
  __XNAT_E2E__: {
    resetUnifiedSegmentations: () => void;
    getViewportType: (panelId: string) => string | null;
    getPanelSliceState: (panelId: string) => SliceState;
    getPaintedVoxelsPerImage: () => number[];
    setUnifiedBrushSize: (n: number) => void;
  };
};

const TOTAL = 15;
const sliceState = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPanelSliceState('panel_0'));
const perImage = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelsPerImage());

async function press(page: Page, key: string, times = 1) {
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(key);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(150);
}

/** Every image must be reachable, and the number shown must be the image shown. */
async function expectConsistent(page: Page, index: number, label: string) {
  await expect.poll(() => sliceState(page), { message: label }).toMatchObject({
    imageIndex: index,
    totalImages: TOTAL,
    displayedImageIndex: index,
  });
}

test('a 3-plane localizer is browsed image by image, and the arrows stop at the ends', async ({ page }) => {
  const imageIdErrors: string[] = [];
  page.on('console', (m) => {
    if (m.text().includes('No imageId found')) imageIdErrors.push(m.text());
  });
  await loadFixture(page, 'mr-localizer-3plane', 'panel_0');

  expect(await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getViewportType('panel_0')))
    .toBe('stack');


  await press(page, 'Home');
  await expectConsistent(page, 0, 'Home lands on the first image');
  await press(page, 'ArrowUp');
  await expectConsistent(page, 0, 'ArrowUp at the first image stays there');

  for (let i = 1; i < TOTAL; i++) {
    await press(page, 'ArrowDown');
    await expectConsistent(page, i, `ArrowDown to image ${i + 1}`);
  }
  await press(page, 'ArrowDown');
  await expectConsistent(page, TOTAL - 1, 'ArrowDown at the last image stays there');

  // The wheel went through the same broken path in the report.
  const box = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(80);
  }
  const afterWheel = await sliceState(page);
  expect(afterWheel.displayedImageIndex, 'the wheel moves through images').toBe(afterWheel.imageIndex);
  expect(imageIdErrors, 'no "No imageId found" while browsing').toEqual([]);
});

test('the brush paints on every plane of a 3-plane localizer, on the image it is drawn on', async ({ page }) => {
  await loadFixture(page, 'mr-localizer-3plane', 'panel_0');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await expect(panel.locator('[data-testid^="member-row-"]').first()).toBeVisible({ timeout: 15_000 });
  await panel.getByRole('button', { name: 'Brush', exact: true }).click();
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setUnifiedBrushSize(8));

  const canvas = page.locator('[data-testid="unified-viewport-element:panel_0"] canvas');
  // One image in each plane: axial #3, sagittal #8 (the 96-row matrix), coronal #13.
  for (const target of [2, 7, 12]) {
    await press(page, 'Home');
    await press(page, 'ArrowDown', target);
    await expectConsistent(page, target, `navigate to image ${target + 1}`);

    const before = await perImage(page);
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.55, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    const after = await perImage(page);

    expect(after.length, 'one labelmap image per source image').toBe(TOTAL);
    expect((after[target] ?? 0) - (before[target] ?? 0), `the stroke painted image ${target + 1}`).toBeGreaterThan(0);
    for (let i = 0; i < TOTAL; i++) {
      if (i === target) continue;
      expect(after[i] ?? 0, `the stroke on image ${target + 1} must not reach image ${i + 1}`).toBe(before[i] ?? 0);
    }
  }
});

/**
 * The ordinary volume case of the same complaint, as a guard: the arrow keys start from
 * the index the overlay and scrollbar show (getSliceIndex on a volume) and scroll via
 * getCurrentImageIdIndex. Those agree on a single-orientation volume in every plane —
 * verified here, so a Cornerstone change that splits them shows up as a failure.
 */
test('arrow keys walk a reformatted volume one slice at a time and stop at the ends', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  const select = page.locator('[data-testid="orientation-select:panel_0"]');
  const canvas = page.locator('[data-testid="unified-viewport-element:panel_0"] canvas');

  for (const plane of ['ACQUISITION', 'SAGITTAL', 'CORONAL']) {
    await select.selectOption(plane);
    // Keyboard focus must leave the dropdown, or the arrows change the plane instead.
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + 5, box.y + box.height - 5);
    await expect.poll(async () => (await sliceState(page)).totalImages, { message: plane }).toBeGreaterThan(1);
    const total = (await sliceState(page)).totalImages;
    const at = async (index: number, label: string) =>
      expect.poll(async () => (await sliceState(page)).imageIndex, { message: `${plane}: ${label}` }).toBe(index);

    await press(page, 'Home');
    await at(0, 'Home');
    await press(page, 'ArrowUp');
    await at(0, 'ArrowUp at the first slice');
    await press(page, 'ArrowDown', 3);
    await at(3, 'three ArrowDowns');
    await press(page, 'End');
    await at(total - 1, 'End');
    await press(page, 'ArrowDown');
    await at(total - 1, 'ArrowDown at the last slice');
    await press(page, 'ArrowUp');
    await at(total - 2, 'ArrowUp from the last slice');
  }
});
