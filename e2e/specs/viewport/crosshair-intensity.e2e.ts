/**
 * Crosshair intensity readout — the overlay's `crosshairIntensity` field samples a
 * REAL voxel value from the loaded volume at the crosshair world point.
 *
 * Drives the real path end to end: load the intensity-varied phantom
 * (ct-axial-anatomy — bone core +1000 HU at the centre, soft tissue +40 HU around
 * it, air −1000 HU outside), select the Crosshairs tool via its real toolbar button,
 * CLICK the centre of the viewport to set the shared world point, then assert the
 * bottom-right overlay shows an "Intensity: <n> HU" readout sampled from the image
 * (getIntensityAtWorld → viewport.getImageData → voxelManager). This is the only
 * check that exercises the real Cornerstone sampling seam — the unit tests mock it.
 *
 * The click→world mapping is DPR-sensitive and not pixel-exact headless (see
 * crosshair-no-crash.e2e), so we do NOT assert the exact HU. We assert a finite HU
 * readout appears (labelled HU for CT) and that the coordinates render beneath it.
 */
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { ensureFixture, enterLocalViewer } from '../../helpers/local-fixture';

test('crosshair intensity readout shows a sampled HU value on a real CT load', async ({ page }: { page: Page }) => {
  await enterLocalViewer(page);

  const files = ensureFixture('ct-axial-anatomy');
  await page.locator('[data-testid="local-import-input"]').setInputFiles(files);
  const canvas = page.locator('[data-testid="unified-viewport-element:panel_0"] canvas');
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-testid="viewport-overlay:panel_0"]')).toBeVisible();

  // Select the real Crosshairs tool (locate by title; the short "Cross" label collides).
  await page.locator('button[title^="Crosshairs"]').click();

  // Click the centre of the viewport to set the shared world point. The centre is
  // comfortably in-bounds, so the sample resolves to a real voxel even though the
  // exact projected point is DPR-dependent.
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no viewport bounding box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  // The intensity field renders a numeric HU readout sampled from the volume.
  const intensity = page.locator('[data-testid="overlay-field-crosshairIntensity:panel_0"]');
  await expect
    .poll(async () => (await intensity.textContent())?.trim() ?? '', { timeout: 20_000 })
    .toMatch(/^Intensity: -?\d+(\.\d+)? HU$/);

  // The coordinates render too (the crosshair field lives just below the intensity).
  await expect(page.locator('[data-testid="overlay-field-crosshair:panel_0"]'))
    .toHaveText(/^-?\d+(\.\d+)?, -?\d+(\.\d+)?, -?\d+(\.\d+)?$/);
});
