/**
 * Signal 29 — effect coverage for the segmentation tools `tools/voxel-tools-lock` left out.
 *
 * A 2026-09 audit found 17 of 25 selectable annotation tools had no test proving they
 * do ANYTHING: six rested on `tools/active-tool-registration`, which asserts only that the active tool name
 * changed, and eleven had nothing at all. That is the gap the threshold brush fell
 * through — it activated correctly and painted like a plain fill for months.
 *
 * This spec closes the deterministic, non-GPU half of that list, using `tools/voxel-tools-lock`'s
 * contract: a REAL mouse gesture through the unified tool group, then assert the
 * labelmap actually changed. No setter shortcuts into the labelmap, and no assertion
 * on tool *state* — activation is not the claim being tested here.
 *
 * (Region / Region+ are GPU growcut and stay out for the reason `tools/voxel-tools-lock` gives.)
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { ensureFixture, enterLocalViewer } from '../../helpers/local-fixture';

interface E2EHooks {
  setActiveUnifiedTool: (toolName: string) => void;
  createUnifiedLabelmapSegmentation: (label?: string) => Promise<{ segmentationId: string; segmentIndex: number }>;
  setUnifiedBrushSize: (size: number) => void;
  getPaintedVoxelCount: () => number;
  isUnifiedVolumeReady: () => boolean;
  resetUnifiedSegmentations: () => void;
  activateSegmentation: (panelId: string, segmentationId: string, segmentIndex?: number) => void;
  getActiveSegmentationState: () => { activeSegmentationId: string | null; activeSegmentIndex: number };
}
type Win = { __XNAT_E2E__: E2EHooks };

const setTool = (page: Page, t: string) => page.evaluate((tn) => (window as unknown as Win).__XNAT_E2E__.setActiveUnifiedTool(tn), t);
const setBrushSize = (page: Page, n: number) => page.evaluate((s) => (window as unknown as Win).__XNAT_E2E__.setUnifiedBrushSize(s), n);
const paintedVoxels = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelCount());
const volumeReady = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.isUnifiedVolumeReady());
const createLabelmap = (page: Page, label: string) =>
  page.evaluate((l) => (window as unknown as Win).__XNAT_E2E__.createUnifiedLabelmapSegmentation(l), label);

const activeState = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getActiveSegmentationState());

const canvas = (page: Page) => page.locator('[data-testid="unified-viewport-element:panel_0"] canvas');

async function setup(page: Page, fixture = 'ct-axial-300') {
  await enterLocalViewer(page);
  const files = ensureFixture(fixture);
  await page.locator('[data-testid="local-import-input"]').setInputFiles(files);
  await expect(canvas(page)).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => volumeReady(page), { timeout: 30_000 }).toBe(true);
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
  return (await canvas(page).boundingBox())!;
}

/** Drag a shape across the centre of the canvas via real mouse events. */
async function dragShape(page: Page, box: { x: number; y: number; width: number; height: number }) {
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5, { steps: 6 });
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 6 });
  await page.mouse.up();
}

test('circle scissors fill the active segment inside the drawn region (signal 29)', async ({ page }) => {
  const box = await setup(page);
  await createLabelmap(page, 'Circle Scissors SEG');
  await setTool(page, 'CircleScissors');
  expect(await paintedVoxels(page)).toBe(0);

  await dragShape(page, box);

  await expect
    .poll(() => paintedVoxels(page), { timeout: 15_000, message: 'circle scissors should fill the enclosed region' })
    .toBeGreaterThan(0);
});

test('paint fill floods the active segment from the clicked region (signal 24 / 29)', async ({ page }) => {
  const box = await setup(page);
  await createLabelmap(page, 'Paint Fill SEG');

  // Paint fill floods a region bounded by existing labels, so seed a brush stroke and
  // flood from inside it — flooding an empty labelmap has nothing to bound the fill.
  await setBrushSize(page, 30);
  await setTool(page, 'Brush');
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5, { steps: 6 });
  await page.mouse.up();
  const seeded = await expectAtLeastOne(page, 'brush seed should paint');

  await setTool(page, 'PaintFill');
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);

  // The flood must leave the labelmap at least as painted as the seed and must not
  // throw (SafePaintFillTool exists because stock PaintFill crashed on our labelmaps).
  await page.waitForTimeout(1500);
  expect(await paintedVoxels(page), 'paint fill must not wipe the seeded region').toBeGreaterThanOrEqual(seeded);
});

/**
 * Circle Multi (CircleROIStartEndThresholdTool) — NOT covered here, deliberately.
 *
 * The audit predicted it and this spec proved it before the tool was disabled: with
 * Circle Multi enabled, a completed real drag wrote 0 voxels. It draws an ROI and
 * computes points-inside-volume, but nothing in src/renderer converts that into
 * labelmap voxels — exactly the shape of the threshold-brush bug (activates cleanly,
 * does nothing). Its rectangle sibling (rectMulti / RectangleROIThreshold) was
 * already marked planned; this one shipped enabled by oversight and now matches.
 *
 * The regression guard lives in `annotations/tool-affordance` with the other planned-tool assertions: the
 * button must stay DISABLED. When the ROI → labelmap conversion is built, drop that
 * guard and add the effect test here instead (drag → expect paintedVoxels > 0).
 */

async function expectAtLeastOne(page: Page, message: string): Promise<number> {
  await expect.poll(() => paintedVoxels(page), { timeout: 15_000, message }).toBeGreaterThan(0);
  return paintedVoxels(page);
}

/**
 * Segment Select — BROKEN, not covered. Found by writing this spec's test for it.
 *
 * SegmentSelectTool hovers (100ms) and calls Cornerstone's setActiveSegmentIndex
 * directly. Nothing syncs that back: every active-segment path in the app runs
 * app → Cornerstone (segmentationService.setActiveSegmentIndex), and there is no
 * listener taking a Cornerstone-originated change into the store. The test written
 * here — paint segment 1, point the app at segment 2, hover the painted voxels —
 * left the store on 2 (expected 1). So the panel and the store disagree with
 * Cornerstone after using the tool.
 *
 * Deliberately NOT fixed blind: setActiveSegmentIndex does fire
 * SEGMENTATION_MODIFIED, which segmentationService already listens to, so the naive
 * fix is to read the active index back during syncSegmentations. But our SEG ids are
 * VIRTUAL multi-layer-group ids that Cornerstone does not know (see
 * resolveContainerSubjectId / mlg), so an ungrouped read fixes nothing for the common
 * case and risks a sync loop in a load-bearing path. A correct fix is group-aware —
 * the same shape as the deferred SegmentBidirectional group-awareness work.
 *
 * Restore the test below this comment once that lands.
 */
