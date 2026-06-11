/**
 * Two-panel cross-series pixel-diff harness (Phase 2 signals 9/10/11 — A2 / D9).
 *
 * The harness: load two series of one study into a 1×2 layout (panel_0 + panel_1)
 * and pixel-compare the canvases — the infrastructure the cross-series rendering
 * signals were blocked on. `loadTwoSeries` is the reusable piece.
 *
 * HARNESS FINDING (recorded honestly): the eligibility-aware attach
 * (unifiedSegService.attachLabelmapWithEligibility — classify native / cross-show /
 * cross-hide / different-FoR + per-viewport style, Slice 2, unit-verified) is NOT
 * wired into the live SEG-create/attach flow. createUnifiedLabelmapSegmentation /
 * segmentationService.addToViewport attach a labelmap to ALL unified viewports
 * unconditionally (the MPR behavior), so a same-FoR sibling shows the SEG at full
 * (native) opacity rather than dimmed (D9), a displaced sibling is not hidden
 * (A2c), and a different-FoR panel still gets a (non-rendering) representation
 * instead of being skipped (A2d). The signals below that depend on that wiring are
 * `fixme` — the harness drives them and will verify them once the eligibility
 * attach is routed into the live flow (the next slice).
 *
 * Fixtures (on disk): mr-t1-t2-sameexam (same FoR), breath-hold-pair (same FoR,
 * bulk-displaced), cross-for-ct-mr (different FoR).
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadTwoSeries } from '../helpers/local-fixture';

interface E2EHooks {
  setMultiviewportEnabled: (v: boolean) => void;
  setActiveUnifiedTool: (toolName: string) => void;
  createUnifiedLabelmapSegmentation: (label?: string) => Promise<{ segmentationId: string; segmentIndex: number }>;
  setUnifiedBrushSize: (size: number) => void;
  getPaintedVoxelCount: () => number;
  getSegmentationViewportIds: (segmentationId: string) => string[];
  applyNonNativeLabelmapStyle: (segmentationId: string, viewportId: string) => void;
  resetUnifiedSegmentations: () => void;
}
type Win = { __XNAT_E2E__: E2EHooks };

const canvas = (page: Page, pid: string) =>
  page.locator(`[data-testid="unified-viewport-element:${pid}"] canvas`);

async function brushStroke(page: Page, box: { x: number; y: number; width: number; height: number }) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const d = Math.min(box.width, box.height) * 0.12;
  await page.mouse.move(cx - d, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy, { steps: 4 });
  await page.mouse.move(cx + d, cy + d, { steps: 4 });
  await page.mouse.up();
}

/** Create a SEG on panel_0 (native series), paint a stroke, return its segmentationId. */
async function paintSegOnPanel0(page: Page, label: string): Promise<string> {
  const p0 = canvas(page, 'panel_0');
  await p0.click(); // activate panel_0 (centre — corners hold overlay controls)
  const segId = await page.evaluate(
    async (l) => (await (window as unknown as Win).__XNAT_E2E__.createUnifiedLabelmapSegmentation(l)).segmentationId,
    label,
  );
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setUnifiedBrushSize(25));
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setActiveUnifiedTool('Brush'));
  const box0 = await p0.boundingBox();
  expect(box0).not.toBeNull();
  await brushStroke(page, box0!);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getPaintedVoxelCount()), { timeout: 15_000 })
    .toBeGreaterThan(0);
  return segId;
}

const segViewportIds = (page: Page, segId: string) =>
  page.evaluate((s) => (window as unknown as Win).__XNAT_E2E__.getSegmentationViewportIds(s), segId);

test.beforeEach(async ({ page }) => {
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setMultiviewportEnabled(true));
  // Isolate from any segmentation a prior test left in the worker-scoped app — without
  // this, a SEG painted in one test leaks into the next and corrupts its eligibility
  // (the documented "passes alone, fails combined" cross-test pollution).
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
});

test('harness: two same-exam series load into a 1×2 grid and render independently', async ({ page }) => {
  await loadTwoSeries(page, 'mr-t1-t2-sameexam', 't1-slice', 't2-slice');
  const p0 = canvas(page, 'panel_0');
  const p1 = canvas(page, 'panel_1');
  await expect(p0).toBeVisible({ timeout: 30_000 });
  await expect(p1).toBeVisible({ timeout: 30_000 });
  // Two DIFFERENT series (T1 vs T2) → distinct rendered pixels.
  expect((await p0.screenshot()).equals(await p1.screenshot())).toBe(false);
});

test('signal 9 (A2b): a SEG created on the T1 panel is attached to + renders on the same-FoR T2 panel (cross-series-show)', async ({ page }) => {
  await loadTwoSeries(page, 'mr-t1-t2-sameexam', 't1-slice', 't2-slice');
  const p1 = canvas(page, 'panel_1');
  await expect(canvas(page, 'panel_0')).toBeVisible({ timeout: 30_000 });
  await expect(p1).toBeVisible({ timeout: 30_000 });

  const p1Before = await p1.screenshot();
  const segId = await paintSegOnPanel0(page, 'Cross-series SEG');

  // Structural: the eligibility attach added the SEG to BOTH same-FoR panels (A2b
  // cross-series-show — panel_1 attaches non-native + read-only, verified at the
  // unit layer in Slice 2).
  await expect.poll(() => segViewportIds(page, segId), { timeout: 15_000 }).toContain('panel_1');
  // Visual: it renders there.
  await expect
    .poll(async () => !(await p1.screenshot()).equals(p1Before), { timeout: 15_000 })
    .toBe(true);
});

test('signal 11 (A2d): a SEG created on the CT panel is NOT attached to the different-FoR MR panel', async ({ page }) => {
  await loadTwoSeries(page, 'cross-for-ct-mr', 'ct-slice', 'mr-slice');
  await expect(canvas(page, 'panel_0')).toBeVisible({ timeout: 30_000 });
  await expect(canvas(page, 'panel_1')).toBeVisible({ timeout: 30_000 });

  const segId = await paintSegOnPanel0(page, 'CT SEG');

  // The eligibility gate skips the different-FoR panel (A2d): the SEG attaches to
  // the CT panel (native) but NOT to the MR panel (different frame of reference).
  const vps = await segViewportIds(page, segId);
  expect(vps).toContain('panel_0');
  expect(vps).not.toContain('panel_1');
});

// signal 9b (D9): the non-native (cross-series) labelmap style visibly dims the SEG.
// Asserted on the SAME panel (native render vs the dimmed style) so there's no
// different-base-series confound: paint a SEG native on panel_0, then apply the D9
// non-native style to that same SEG/panel — the render changes (reduced fill opacity +
// thin outline). That the change is specifically "dimmer" is unit-verified
// (eligibilityStyle.nonNativeStyleFor reduced fillAlpha, Slice 2); here we confirm the
// style is actually applied + visible live (not a no-op).
test('signal 9b (D9): the non-native labelmap style visibly changes (dims) the SEG render', async ({ page }) => {
  await loadTwoSeries(page, 'mr-t1-t2-sameexam', 't1-slice', 't2-slice');
  const p0 = canvas(page, 'panel_0');
  await expect(p0).toBeVisible({ timeout: 30_000 });

  const segId = await paintSegOnPanel0(page, 'D9 SEG'); // renders native (full opacity) on panel_0
  const nativeShot = await p0.screenshot();

  await page.evaluate(
    (s) => (window as unknown as Win).__XNAT_E2E__.applyNonNativeLabelmapStyle(s, 'panel_0'),
    segId,
  );
  await expect
    .poll(async () => !(await p0.screenshot()).equals(nativeShot), { timeout: 15_000 })
    .toBe(true);
});

// signal 10 (A2c): a SEG on one breath-hold series is HIDDEN on the displaced same-FoR
// sibling. The attach is eligibility-gated AND fed the live two-volume displacement
// (bulkDisplacementForPair reads both source volumes' scalar data → centroid delta).
// The breath-hold pair is bulk-shifted ~20mm > the 10mm threshold ⇒ cross-series-HIDE,
// which (unlike the same-exam T1/T2 in signal 9) does NOT attach: for a shared derived
// volume labelmap, not-attaching is the only reliable per-viewport hide. Contrast with
// signal 9, where the un-displaced sibling classifies cross-series-SHOW and DOES attach.
test('signal 10 (A2c): a SEG on one breath-hold series is HIDDEN on the displaced same-FoR sibling', async ({ page }) => {
  await loadTwoSeries(page, 'breath-hold-pair', 'bh1-slice', 'bh2-slice');
  const p1 = canvas(page, 'panel_1');
  await expect(canvas(page, 'panel_0')).toBeVisible({ timeout: 30_000 });
  await expect(p1).toBeVisible({ timeout: 30_000 });

  const p1Before = await p1.screenshot();
  const segId = await paintSegOnPanel0(page, 'BH SEG');

  // Structural: the displaced sibling is NOT attached (A2c hide), while the native
  // panel IS — the inverse of signal 9 (cross-series-show) on the same harness.
  const vps = await segViewportIds(page, segId);
  expect(vps).toContain('panel_0');
  expect(vps).not.toContain('panel_1');
  // Visual: panel_1 is unchanged by the paint on panel_0 (nothing rendered there).
  expect((await p1.screenshot()).equals(p1Before)).toBe(true);
});
