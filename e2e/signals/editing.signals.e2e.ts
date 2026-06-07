/**
 * Pending acceptance signals — editing, gestures, tools, interpolation (S3).
 *
 * RED-BEFORE-GREEN against the rebuilt surfaces; run offline on a single CT
 * volume. Each test gates on the rebuilt entry point FIRST (fast red), then
 * documents the intended flow.
 */
import { test, expect } from '../fixtures/electron-app';
import { loadCtAxial300, loadCtAxialAnatomy } from '../helpers/local-fixture';

async function enableMv(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    (window as unknown as { __XNAT_E2E__: { setMultiviewportEnabled: (v: boolean) => void } })
      .__XNAT_E2E__.setMultiviewportEnabled(true);
  });
}

test.describe('Signal 4 — segment lock blocks editing on other panels (A4)', () => {
  test('locking a segment on panel A blocks brushing it on panel B', async ({ page }) => {
    await enableMv(page);
    await loadCtAxial300(page);
    const createSeg = page.locator('[data-testid="create-segmentation"]');
    await expect(createSeg, 'rebuilt create-Segmentation action should exist').toBeVisible({ timeout: 5_000 });
    // Intended: lock a segment on panel A; attempt to brush it on panel B -> blocked.
  });
});

test.describe('Signal 7 — undo a stroke made on a since-closed panel (A8)', () => {
  test('a brush stroke on a panel that is later closed is still undone correctly', async ({ page }) => {
    await enableMv(page);
    await loadCtAxial300(page);
    const createSeg = page.locator('[data-testid="create-segmentation"]');
    await expect(createSeg, 'rebuilt create-Segmentation action should exist').toBeVisible({ timeout: 5_000 });
    // Intended: brush on a panel; close that panel; undo -> the stroke is undone.
  });
});

test.describe('Signal 13 — inter-slice interpolation round-trips on save (B5)', () => {
  test('interpolated contours appear with the auto-marker and survive save + reload', async ({ page }) => {
    await enableMv(page);
    await loadCtAxial300(page);
    const createStructure = page.locator('[data-testid="create-structure"]');
    await expect(createStructure, 'rebuilt create-Structure action should exist').toBeVisible({ timeout: 5_000 });
    // Intended: draw every fifth axial slice + interpolate; interpolated contours
    // appear immediately on eligible viewports with the auto-marker; save with no
    // further action -> RTSTRUCT contains them; reload -> geometry identical.
  });
});

test.describe('Signal 22 — interpolation provenance badge (B5)', () => {
  test('interpolated contours show an interpolated badge that flips to manual on edit', async ({ page }) => {
    await enableMv(page);
    await loadCtAxial300(page);
    const createStructure = page.locator('[data-testid="create-structure"]');
    await expect(createStructure, 'rebuilt create-Structure action should exist').toBeVisible({ timeout: 5_000 });
    // Intended: each interpolated contour shows the provenance badge
    // (`provenance-badge` = interpolated) + auto-marker; manually editing one
    // flips its badge to `manual` and clears its auto-marker; save/reload
    // preserves provenance where DICOM permits.
  });
});

test.describe('Signal 23 — world-geometry-preserving copy/paste (D6)', () => {
  test('copy a contour on axial and paste on a coronal slice lands at the copied world geometry, active member', async ({ page }) => {
    await enableMv(page);
    await loadCtAxial300(page);
    const createStructure = page.locator('[data-testid="create-structure"]');
    await expect(createStructure, 'rebuilt create-Structure action should exist').toBeVisible({ timeout: 5_000 });
    // Intended: draw + Ctrl-C a contour on an axial slice; scroll a coronal panel
    // and Ctrl-V -> lands at the copied world geometry on the target slice's
    // plane, in the active member (not a new one). Paste into a different-FoR
    // viewport is blocked with a clear error. (Regression guard for prior
    // copy/paste-of-interpolated-contour defects.)
  });
});

test.describe('Signal 29 — voxel-tool roster respects active + lock + overlap (C3)', () => {
  test('each segmentation tool writes/erases correctly; lock blocks at gesture-start', async ({ page }) => {
    await enableMv(page);
    await loadCtAxialAnatomy(page); // intensity-varied: threshold/dynamic-threshold need it
    const createSeg = page.locator('[data-testid="create-segmentation"]');
    await expect(createSeg, 'rebuilt create-Segmentation action should exist').toBeVisible({ timeout: 5_000 });
    // Intended: 2D/3D brush paint; eraser (2D/3D) + all-segment modifier clear;
    // threshold + dynamic-threshold write only in-range voxels; planar + through-
    // volume scissors; sculptor deforms a boundary. Locking the active segment
    // blocks each at gesture-start with a hint.
  });
});

test.describe('Signal 34 — drag/gesture continuity across panels (D4, A7)', () => {
  test('a gesture started in panel A completes in A even if the cursor crosses panel B', async ({ page }) => {
    await enableMv(page);
    await loadCtAxial300(page);
    const createSeg = page.locator('[data-testid="create-segmentation"]');
    await expect(createSeg, 'rebuilt create-Segmentation action should exist').toBeVisible({ timeout: 5_000 });
    // Intended: start a handle drag / brush gesture in A, move across B before
    // release -> completes in A; B never hijacks it; a hotkey that would switch
    // the active viewport mid-gesture is deferred until gesture end.
  });
});

test.describe('Signal 35 — tool affordance + keyboard scoping (D1, D3, D5)', () => {
  test('active viewport shows its indicator; non-meaningful tools are disabled; shortcut scoping is correct', async ({ page }) => {
    await enableMv(page);
    await loadCtAxial300(page);
    const indicator = page.locator('[data-testid="active-viewport-indicator"]');
    await expect(indicator, 'rebuilt active-viewport indicator should exist').toBeVisible({ timeout: 5_000 });
    // Intended: the active (focused) viewport shows its indicator; a tool not
    // meaningful on it renders disabled/no-op (not silently misapplied); global
    // shortcuts (undo/redo, save, active-segment/-tool) fire regardless of focus;
    // view shortcuts (slice, zoom, W/L, rotate) act on the active panel only.
  });
});
