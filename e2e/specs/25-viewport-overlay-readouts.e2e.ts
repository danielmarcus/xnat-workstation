/**
 * P1.9 / B1 — the info overlay renders live readouts from a real load (flag on).
 *
 * Drives the REAL path: load ct-axial-300 → useViewport state-sync reads the
 * viewport (readViewportState, volume branch) → stores → ViewportOverlay renders.
 * Asserts the slice counter shows the correct TOTAL (16 — the volume's slice
 * count, read from the reformatted axis, not a stale/garbage value) and that
 * W/L + zoom readouts appear. No store shortcuts.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { ensureFixture, enterLocalViewer } from '../helpers/local-fixture';

interface E2EHooks { setMultiviewportEnabled: (v: boolean) => void; }
type Win = { __XNAT_E2E__: E2EHooks };

test('viewport overlay shows live slice counter + W/L + zoom on load (flag on)', async ({ page }: { page: Page }) => {
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setMultiviewportEnabled(true));
  await enterLocalViewer(page);

  const files = ensureFixture('ct-axial-300');
  await page.locator('[data-testid="local-import-input"]').setInputFiles(files);
  await expect(page.locator('[data-testid="unified-viewport-element:panel_0"] canvas'))
    .toBeVisible({ timeout: 30_000 });

  // Overlay mounted.
  await expect(page.locator('[data-testid="viewport-overlay:panel_0"]')).toBeVisible();

  // Slice counter shows "N / 16" — total is the volume slice count (ct-axial-300
  // is a 16-slice CT). A stale/garbage total (the "257/21" class of bug) would
  // not match "/ 16". (Default overlay prefs place imageIndex in the bottom-left.)
  await expect
    .poll(
      async () => (await page.locator('[data-testid="overlay-field-imageIndex:panel_0"]').textContent())?.trim() ?? '',
      { timeout: 20_000 },
    )
    .toMatch(/^\d+ \/ 16$/);

  // W/L + zoom readouts render in their configured corners.
  await expect(page.locator('[data-testid="overlay-field-windowLevel:panel_0"]')).toContainText('W:');
  await expect(page.locator('[data-testid="overlay-field-zoom:panel_0"]')).toContainText('Zoom:');

  // Metadata corners populate from the volume's source metadata (the empty-corners
  // bug: a volume viewport's getCurrentImageId() was null, so no metadata flowed;
  // the fix reads the series-level metadata from the volume's source imageIds[0]).
  // ct-axial-300's series description is "CT AXIAL 300 (sphere phantom)".
  await expect
    .poll(
      async () => (await page.locator('[data-testid="overlay-field-seriesDescription:panel_0"]').textContent())?.trim() ?? '',
      { timeout: 20_000 },
    )
    .toContain('CT AXIAL 300');

  // Orientation edge-markers (default prefs: on). Axial ⇒ A (top) / P (bottom) /
  // R (left) / L (right) — the standard radiological convention.
  await expect(page.locator('[data-testid="orientation-marker-top:panel_0"]')).toHaveText('A');
  await expect(page.locator('[data-testid="orientation-marker-bottom:panel_0"]')).toHaveText('P');
  await expect(page.locator('[data-testid="orientation-marker-left:panel_0"]')).toHaveText('R');
  await expect(page.locator('[data-testid="orientation-marker-right:panel_0"]')).toHaveText('L');

  // Scale ruler (default prefs: on). Derived from the camera's true scale → a round
  // mm/cm label (e.g. "5 cm"). Proves the scale wiring produces a valid bar.
  await expect
    .poll(
      async () => (await page.locator('[data-testid="ruler-h-label:panel_0"]').textContent())?.trim() ?? '',
      { timeout: 20_000 },
    )
    .toMatch(/^\d+(\.\d+)?\s*(mm|cm)$/);
});
