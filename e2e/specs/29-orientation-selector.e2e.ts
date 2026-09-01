/**
 * P1.9 / C2 — the per-viewport orientation selector reformats a volume in place
 * (offline, flag on). Drives the REAL overlay dropdown: load the 128×128×16 axial
 * volume (16 axial slices), switch the panel to Sagittal, and assert the slice
 * counter's TOTAL changes to the reformatted axis (~128, not 16) — i.e. the
 * viewport actually re-oriented. Guards the user's "I can no longer view an axial
 * image in sagittal orientation" regression.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { ensureFixture, enterLocalViewer } from '../helpers/local-fixture';

const sliceTotal = async (page: Page): Promise<number> => {
  const txt = (await page.locator('[data-testid="overlay-field-imageIndex:panel_0"]').textContent())?.trim() ?? '';
  const m = txt.match(/\/\s*(\d+)\s*$/);
  return m ? Number(m[1]) : -1;
};

test('the orientation selector reformats a volume from axial to sagittal (flag on)', async ({ page }: { page: Page }) => {
  await enterLocalViewer(page);

  const files = ensureFixture('ct-axial-300');
  await page.locator('[data-testid="local-import-input"]').setInputFiles(files);
  await expect(page.locator('[data-testid="unified-viewport-element:panel_0"] canvas')).toBeVisible({ timeout: 30_000 });

  // Axial-acquired volume: 16 slices. The orientation dropdown defaults to
  // "Acquisition" (the acquired plane — here axial), so the slice total is 16.
  await expect.poll(() => sliceTotal(page), { timeout: 20_000 }).toBe(16);
  const select = page.locator('[data-testid="orientation-select:panel_0"]');
  await expect(select).toBeVisible();
  await expect(select).toHaveValue('ACQUISITION');

  // Switch to Sagittal ⇒ the volume reformats along the 128-wide axis: the slice
  // total jumps well above the 16 axial slices (proves an in-place reorient).
  await select.selectOption('SAGITTAL');
  await expect(select).toHaveValue('SAGITTAL');
  await expect.poll(() => sliceTotal(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(64);
});
