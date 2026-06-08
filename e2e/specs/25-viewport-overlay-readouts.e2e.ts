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
  // not match "/ 16".
  await expect
    .poll(
      async () => (await page.locator('[data-testid="overlay-image-index:panel_0"]').textContent())?.trim() ?? '',
      { timeout: 20_000 },
    )
    .toMatch(/^\d+ \/ 16$/);

  // W/L + zoom readouts render.
  await expect(page.locator('[data-testid="overlay-wl:panel_0"]')).toContainText('W:');
  await expect(page.locator('[data-testid="overlay-zoom:panel_0"]')).toContainText('Zoom:');

  // Metadata corners populate from the volume's source metadata (the empty-corners
  // bug: a volume viewport's getCurrentImageId() was null, so no metadata flowed;
  // the fix reads the series-level metadata from the volume's source imageIds[0]).
  // ct-axial-300's series description is "CT AXIAL 300 (sphere phantom)".
  await expect
    .poll(
      async () => (await page.locator('[data-testid="overlay-series-desc:panel_0"]').textContent())?.trim() ?? '',
      { timeout: 20_000 },
    )
    .toContain('CT AXIAL 300');
});
