/**
 * Performance baseline (requirements D8) — measured, not asserted.
 *
 * D8 asks for ≥30 fps edit propagation and ≤250 ms layout changes with four viewports
 * of a ~300-slice CT. That budget was previously recorded as "not offline-measurable"
 * because the acceptance fixtures are ≤16 slices. This harness closes the measurable
 * part: it loads a real 300-slice 512×512 series (`ct-perf-300`, ~150 MB) through the
 * app's own import path and times the operations D8 names.
 *
 * READ THE NUMBERS AS A BASELINE FOR THIS HOST. They are recorded to
 * e2e/test-results/perf/latest.json so runs can be compared, and printed to the
 * console. The assertions are loose sanity ceilings only — a verdict on the clinical
 * hardware budget still needs a run on that hardware with real patient data.
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { ensureFixture, enterLocalViewer } from '../helpers/local-fixture';

interface E2EHooks {
  setLayoutPreset: (preset: 'single' | 'mpr-2x2') => void;
  createUnifiedLabelmapSegmentation: (label?: string) => Promise<{ segmentationId: string; segmentIndex: number }>;
  setActiveUnifiedTool: (toolName: string) => void;
  setUnifiedBrushSize: (size: number) => void;
  getPaintedVoxelCount: () => number;
  isUnifiedVolumeReady: () => boolean;
  scrollActiveViewport: (delta: number) => void;
  clearAllContainers: () => void;
  getCacheStats: (panelId: string) => { cacheBytes: number; volumeSlices: number | null; imageCount: number };
  startRenderCounter: (panelIds: string[]) => void;
  readRenderCounter: () => { frames: number; elapsedMs: number };
}
type Win = { __XNAT_E2E__: E2EHooks };

const hook = <T,>(page: Page, fn: keyof E2EHooks, ...args: unknown[]): Promise<T> =>
  page.evaluate(
    ([name, a]) => (window as unknown as Win).__XNAT_E2E__[name as keyof E2EHooks](...(a as [])),
    [fn, args] as const,
  ) as Promise<T>;

/**
 * Cornerstone's own cache accounting, in MB. Preferred over `performance.memory`,
 * which is coarse (quantized, and unchanged across this whole run on this host) and
 * so cannot show a 150 MB volume arriving.
 */
const cacheMb = async (page: Page) => {
  const stats = await hook<{ cacheBytes: number }>(page, 'getCacheStats', 'panel_0');
  return Math.round(stats.cacheBytes / 1024 / 1024);
};

const results: Record<string, number | null | string> = {};

test.afterAll(() => {
  const outDir = path.resolve(__dirname, '../test-results/perf');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'latest.json'), `${JSON.stringify(results, null, 2)}\n`);
  console.log('\n── D8 perf baseline (this host) ──');
  for (const [key, value] of Object.entries(results)) console.log(`  ${key}: ${value}`);
  console.log(`  (written to ${path.relative(process.cwd(), path.join(outDir, 'latest.json'))})\n`);
});

test('300-slice volume: load, layout, scroll and edit timings', async ({ page }) => {
  const files = ensureFixture('ct-perf-300');
  expect(files.length).toBe(300);
  results.slices = files.length;
  results.cacheMbBeforeLoad = await cacheMb(page);

  await enterLocalViewer(page);

  // ── time-to-first-render: import → a rendered canvas ──
  const loadStart = Date.now();
  await page.locator('[data-testid="local-import-input"]').setInputFiles(files);
  await page
    .locator('[data-testid="unified-viewport-element:panel_0"] canvas')
    .first()
    .waitFor({ state: 'visible', timeout: 300_000 });
  results.timeToFirstRenderMs = Date.now() - loadStart;

  // ── volume ready (the full 3D volume, not just the first image) ──
  const volumeStart = Date.now();
  await expect
    .poll(() => hook<boolean>(page, 'isUnifiedVolumeReady'), { timeout: 300_000, intervals: [250] })
    .toBe(true);
  results.volumeReadyMs = (Date.now() - loadStart);
  results.volumeReadyAfterFirstRenderMs = Date.now() - volumeStart;
  results.cacheMbAfterLoad = await cacheMb(page);

  // Prove the measurement ran against the WHOLE series: the panel's volume must have
  // all 300 slices, or every number below describes a partial load.
  const stats = await hook<{ volumeSlices: number | null; imageCount: number }>(page, 'getCacheStats', 'panel_0');
  results.panelImageCount = stats.imageCount;
  results.volumeSlices = stats.volumeSlices;
  expect(stats.imageCount, 'the panel should hold all 300 imageIds').toBe(files.length);
  expect(stats.volumeSlices, 'the built volume should span all 300 slices').toBe(files.length);

  // ── layout change to 4 viewports (D8: ≤250 ms is the target) ──
  const layoutStart = Date.now();
  await hook(page, 'setLayoutPreset', 'mpr-2x2');
  for (const panel of ['panel_0', 'panel_1', 'panel_2', 'panel_3']) {
    await page
      .locator(`[data-testid="unified-viewport-element:${panel}"] canvas`)
      .first()
      .waitFor({ state: 'visible', timeout: 120_000 });
  }
  results.layoutTo4PanelsMs = Date.now() - layoutStart;
  results.cacheMbAfter4Panels = await cacheMb(page);

  // ── scroll timing: 30 slice steps on the active viewport ──
  const scrollSteps = 30;
  const scrollStart = Date.now();
  for (let i = 0; i < scrollSteps; i++) {
    await hook(page, 'scrollActiveViewport', 1);
  }
  const scrollMs = Date.now() - scrollStart;
  results.scrollStepMeanMs = Math.round((scrollMs / scrollSteps) * 10) / 10;
  results.scrollStepsPerSecond = Math.round((scrollSteps / scrollMs) * 1000);

  // ── edit propagation: brush strokes on a 4-panel layout ──
  await hook(page, 'createUnifiedLabelmapSegmentation', 'Perf seg');
  await hook(page, 'setActiveUnifiedTool', 'Brush');
  await hook(page, 'setUnifiedBrushSize', 15);
  const canvas = page.locator('[data-testid="unified-viewport-element:panel_0"] canvas').first();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const cx = box!.x + box!.width / 2;
  const cy = box!.y + box!.height / 2;

  // Count Cornerstone's real render events across all four panels during the strokes:
  // D8's "≥30 fps edit propagation" is about frames, and wall-clock gesture timing is
  // dominated by Playwright's input synthesis rather than by rendering.
  await hook(page, 'startRenderCounter', ['panel_0', 'panel_1', 'panel_2', 'panel_3']);

  const strokes = 5;
  const editStart = Date.now();
  for (let i = 0; i < strokes; i++) {
    await page.mouse.move(cx - 30, cy - 10 + i * 4);
    await page.mouse.down();
    await page.mouse.move(cx + 30, cy - 10 + i * 4, { steps: 8 });
    await page.mouse.up();
  }
  const editMs = Date.now() - editStart;
  const counter = await hook<{ frames: number; elapsedMs: number }>(page, 'readRenderCounter');
  results.brushStrokeMeanWallClockMs = Math.round((editMs / strokes) * 10) / 10;
  results.editRenderFrames = counter.frames;
  results.editRenderFps = counter.elapsedMs > 0
    ? Math.round((counter.frames / counter.elapsedMs) * 1000 * 10) / 10
    : 0;
  results.paintedVoxels = await hook<number>(page, 'getPaintedVoxelCount');
  results.cacheMbAfterEdits = await cacheMb(page);
  expect(results.paintedVoxels as number).toBeGreaterThan(0);

  await hook(page, 'clearAllContainers');
  await hook(page, 'setLayoutPreset', 'single');

  // Sanity ceilings only — these catch "it never finished", not budget compliance.
  expect(results.timeToFirstRenderMs as number).toBeLessThan(300_000);
  expect(results.volumeReadyMs as number).toBeLessThan(300_000);
});
