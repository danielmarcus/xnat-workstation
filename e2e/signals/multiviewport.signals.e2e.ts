/**
 * Pending acceptance signals — multi-viewport / MPR / cross-panel (S3).
 *
 * RED-BEFORE-GREEN against the rebuilt surfaces; run offline on a single CT
 * volume (multi-panel + MPR are layouts of one volume, so no extra fixture is
 * needed). Each test gates on the rebuilt entry point FIRST (fast red), then
 * documents the intended multi-panel flow for when the feature lands.
 */
import { test, expect } from '../fixtures/electron-app';
import { loadCtAxial300 } from '../helpers/local-fixture';

async function enableMvAndLoad(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    (window as unknown as { __XNAT_E2E__: { setMultiviewportEnabled: (v: boolean) => void } })
      .__XNAT_E2E__.setMultiviewportEnabled(true);
  });
  return loadCtAxial300(page);
}

test.describe('Signal 1 — freehand contour propagates to orthogonal MPR (live)', () => {
  test('drawing a contour on axial slices shows correctly placed segments on sagittal + coronal, live', async ({ page }) => {
    await enableMvAndLoad(page);
    const createStructure = page.locator('[data-testid="create-structure"]');
    await expect(createStructure, 'rebuilt create-Structure action should exist').toBeVisible({ timeout: 5_000 });
    // Intended: open axial+sagittal+coronal of one CT (MPR layout); draw a
    // freehand contour on three axial slices; the sagittal + coronal panels show
    // three correctly placed line segments updating live as you draw.
  });
});

test.describe('Signal 2 — shared-volume editing across two panels (A6, §1.5)', () => {
  test('editing a contour on panel A is absent on panel B until B scrolls to the edited slice', async ({ page }) => {
    await enableMvAndLoad(page);
    const createSeg = page.locator('[data-testid="create-segmentation"]');
    await expect(createSeg, 'rebuilt create-Segmentation action should exist').toBeVisible({ timeout: 5_000 });
    // Intended: open the same volume in two volume panels at different slice
    // indices; edit on A's current slice; B (on another slice) shows no change
    // there; scroll B to the edited slice — the edit is present (one shared
    // ImageVolume).
  });
});

test.describe('Signal 3 — SEG brush on stack resamples onto axial-MPR (live)', () => {
  test('brush-painting a SEG segment on stack shows resampled voxels on MPR, live', async ({ page }) => {
    await enableMvAndLoad(page);
    const createSeg = page.locator('[data-testid="create-segmentation"]');
    await expect(createSeg, 'rebuilt create-Segmentation action should exist').toBeVisible({ timeout: 5_000 });
    // Intended: one volume in axial-MPR + stack; brush-paint a SEG segment on the
    // stack; the MPR shows the painted voxels resampled, live.
  });
});

test.describe('Signal 5 — per-viewport hide resets to global default (A5)', () => {
  test('hiding a structure on panel A only leaves others showing; reopening A restores the global default', async ({ page }) => {
    await enableMvAndLoad(page);
    const createStructure = page.locator('[data-testid="create-structure"]');
    await expect(createStructure, 'rebuilt create-Structure action should exist').toBeVisible({ timeout: 5_000 });
    // Intended: hide structure "GTV" on panel A only; other panels still show it;
    // close panel A and reopen — GTV is visible again (per-viewport hide reset to
    // the global default).
  });
});

test.describe('Signal 6 — rapid layout swaps preserve state (A7)', () => {
  test('editing across four panels and swapping 2x2 -> 1x1 -> MPR -> 2x2 loses nothing', async ({ page }) => {
    await enableMvAndLoad(page);
    const createSeg = page.locator('[data-testid="create-segmentation"]');
    await expect(createSeg, 'rebuilt create-Segmentation action should exist').toBeVisible({ timeout: 5_000 });
    // Intended: four panels, edit, switch layouts rapidly — no structures lost,
    // no duplicates, no stale highlights, single dirty flag; one save produces a
    // correct file.
  });
});

test.describe('Signal 8 — global selection sync across panels + list (A11)', () => {
  test('clicking a contour in panel A highlights it in panel B and the list; empty-click clears both', async ({ page }) => {
    await enableMvAndLoad(page);
    const createStructure = page.locator('[data-testid="create-structure"]');
    await expect(createStructure, 'rebuilt create-Structure action should exist').toBeVisible({ timeout: 5_000 });
    // Intended: two panels on the same scan; click a contour in A -> highlighted
    // in both; click in the list panel -> highlighted in both; click empty space
    // in B -> cleared in both.
  });
});
