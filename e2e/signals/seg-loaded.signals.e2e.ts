/**
 * Pending acceptance signals — loaded SEG containers (S4).
 *
 * RED-BEFORE-GREEN against the rebuilt panel. Signal 24 first LOADS the real
 * seg-multilabel fixture (proving the hand-built SEG flows through the harness),
 * then gates on the rebuilt panel listing the loaded container's members.
 * See e2e/signals/README.md.
 */
import { test, expect } from '../fixtures/electron-app';
import { ensureFixture, enterLocalViewer, loadLocalDicom, loadCtAxialAnatomy } from '../helpers/local-fixture';

test.describe('Signal 24 — SEG round-trip + 3D continuity (C7, C8)', () => {
  test('a loaded multi-segment SEG lists all segments in the rebuilt panel', async ({ page }) => {
    const files = ensureFixture('seg-multilabel');
    await enterLocalViewer(page);
    await loadLocalDicom(page, files);

    // The hand-built SEG actually loads via the real adapter (fixture flows E2E).
    await expect
      .poll(() => page.evaluate(() => window.__XNAT_E2E__!.getSegmentationCount()), { timeout: 20_000 })
      .toBeGreaterThan(0);

    // Rebuilt panel should mount and list the loaded SEG container's 5 members.
    const panel = page.locator('[data-testid="annotations-panel"]');
    await expect(panel, 'rebuilt panel should list the loaded SEG').toBeVisible({ timeout: 5_000 });
    await expect(panel.locator('[data-testid="member-row"]')).toHaveCount(5);
    // Faithful oblique round-trip (nearest-neighbor resample, 3D-connected brush,
    // save+reload preserves native oblique orientation) needs an oblique-grid SEG
    // variant — deferred fixture.
  });
});

test.describe('Signal 30 — Contour Fill must-fix (C3; Phase-5 gate)', () => {
  test('LabelMapEditWithContourTool rasterizes a boundary into the active segment as one undo entry', async ({ page }) => {
    await loadCtAxialAnatomy(page);
    const createSeg = page.locator('[data-testid="create-segmentation"]');
    await expect(createSeg, 'rebuilt create-Segmentation action should exist').toBeVisible({ timeout: 5_000 });
    // Intended: draw a freehand/polygon boundary on a slice; the enclosed region
    // rasterizes into the active segment (boundary-then-fill, not voxel-by-voxel);
    // respects active-segment lock + overlap policy; undo reverts the whole fill
    // as ONE entry. (This tool is currently broken — its Phase-5 fix gate.)
  });
});
