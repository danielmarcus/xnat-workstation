/**
 * Phase 5 — signal 29 (voxel-tool roster): the THRESHOLD brush writes only in-range
 * voxels.
 *
 * On the intensity-varied phantom (ct-axial-anatomy: bone core +1000 HU at the
 * centre, soft-tissue +40 HU around it, air -1000 HU outside), a brush disk centred
 * on the volume spans BOTH bone and soft-tissue. A plain FILL brush paints every
 * voxel in the disk; the THRESHOLD brush with range [0,100] paints only the
 * soft-tissue/lesion voxels — excluding the +1000 bone core and the -1000 air. So the
 * threshold stroke must write FEWER voxels than the fill stroke (but more than zero).
 * That delta is the proof the intensity gate is actually applied (vs. behaving like a
 * plain fill).
 *
 * Real gestures through the unified tool group; the threshold range is set via the
 * production setBrushThreshold path (which only applies once a threshold strategy is
 * active — so the tool is selected first).
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { ensureFixture, enterLocalViewer } from '../helpers/local-fixture';

interface E2EHooks {
  setActiveUnifiedTool: (toolName: string) => void;
  createUnifiedLabelmapSegmentation: (label?: string) => Promise<{ segmentationId: string; segmentIndex: number }>;
  setUnifiedBrushSize: (size: number) => void;
  setUnifiedBrushThreshold: (range: [number, number]) => void;
  getPaintedVoxelCount: () => number;
  isUnifiedVolumeReady: () => boolean;
  resetUnifiedSegmentations: () => void;
}
type Win = { __XNAT_E2E__: E2EHooks };

const setTool = (page: Page, t: string) => page.evaluate((tn) => (window as unknown as Win).__XNAT_E2E__.setActiveUnifiedTool(tn), t);
const setBrushSize = (page: Page, n: number) => page.evaluate((s) => (window as unknown as Win).__XNAT_E2E__.setUnifiedBrushSize(s), n);
const setThreshold = (page: Page, r: [number, number]) => page.evaluate((rr) => (window as unknown as Win).__XNAT_E2E__.setUnifiedBrushThreshold(rr), r);
const paintedVoxels = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelCount());
const volumeReady = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.isUnifiedVolumeReady());
const reset = (page: Page) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
const createLabelmap = (page: Page, label: string) =>
  page.evaluate((l) => (window as unknown as Win).__XNAT_E2E__.createUnifiedLabelmapSegmentation(l), label);

/** A short stroke across the centre of the canvas via real mouse events. */
async function centreStroke(page: Page, box: { x: number; y: number; width: number; height: number }) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const d = Math.min(box.width, box.height) * 0.06;
  await page.mouse.move(cx - d, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy, { steps: 4 });
  await page.mouse.move(cx + d, cy, { steps: 4 });
  await page.mouse.up();
}

test('threshold brush writes only in-range voxels — fewer than a plain fill (signal 29)', async ({ page }) => {
  await enterLocalViewer(page);
  const files = ensureFixture('ct-axial-anatomy');
  await page.locator('[data-testid="local-import-input"]').setInputFiles(files);
  await expect(page.locator('[data-testid="unified-viewport-element:panel_0"] canvas')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => volumeReady(page), { timeout: 30_000 }).toBe(true);
  await reset(page);

  const box = (await page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').boundingBox())!;
  expect(box).not.toBeNull();

  // (1) Plain FILL brush over the centre — paints every voxel in the disk (bone + soft tissue).
  await createLabelmap(page, 'Fill SEG');
  await setBrushSize(page, 40);
  await setTool(page, 'Brush');
  await centreStroke(page, box);
  await expect.poll(() => paintedVoxels(page), { timeout: 15_000, message: 'fill brush should paint' }).toBeGreaterThan(0);
  const fillCount = await paintedVoxels(page);

  // (2) THRESHOLD brush over the SAME centre with the SAME size, range [0,100] —
  // excludes the +1000 bone core and -1000 air, so it writes fewer voxels.
  await reset(page);
  await createLabelmap(page, 'Threshold SEG');
  await setBrushSize(page, 40);
  await setTool(page, 'ThresholdBrush');
  await setThreshold(page, [0, 100]);
  await centreStroke(page, box);

  const thresholdCount = await expectPainted(page);
  expect(thresholdCount, 'threshold brush should write SOME in-range voxels').toBeGreaterThan(0);
  expect(thresholdCount, 'threshold brush should write FEWER voxels than a plain fill (bone + air excluded)')
    .toBeLessThan(fillCount);
});

async function expectPainted(page: Page): Promise<number> {
  await expect
    .poll(() => paintedVoxels(page), { timeout: 15_000, message: 'threshold brush should paint in-range voxels' })
    .toBeGreaterThan(0);
  return paintedVoxels(page);
}
