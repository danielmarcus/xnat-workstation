/**
 * P1.9 / B4 — the per-viewport slice scrollbar scrubs through slices (offline,
 * flag on). Drives the REAL scrollbar (click near the bottom of the track) on a
 * real volume load and asserts the overlay slice counter actually advances — i.e.
 * the viewport scrolled. Guards the user's "there is no scrollbar" gap AND that
 * the scroll is type-aware (volume reformatted axis, not the native index).
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { ensureFixture, enterLocalViewer } from '../helpers/local-fixture';

const sliceIndex = async (page: Page): Promise<number> => {
  const txt = (await page.locator('[data-testid="overlay-field-imageIndex:panel_0"]').textContent())?.trim() ?? '';
  const m = txt.match(/^(\d+)\s*\/\s*16$/);
  return m ? Number(m[1]) : -1;
};

test('the slice scrollbar scrubs the viewport (flag on)', async ({ page }: { page: Page }) => {
  await enterLocalViewer(page);

  const files = ensureFixture('ct-axial-300');
  await page.locator('[data-testid="local-import-input"]').setInputFiles(files);
  await expect(page.locator('[data-testid="unified-viewport-element:panel_0"] canvas')).toBeVisible({ timeout: 30_000 });

  // ct-axial-300 is a 16-slice volume ⇒ the scrollbar is shown (total > 1).
  const scrollbar = page.locator('[data-testid="viewport-scrollbar:panel_0"]');
  await expect(scrollbar).toBeVisible({ timeout: 20_000 });

  // The counter is live ("N / 16"). The volume may open at the center slice, so
  // assert BIDIRECTIONAL scrubbing rather than a fixed start: clicking the top of
  // the track jumps to a low slice, clicking the bottom jumps to a high slice.
  await expect.poll(() => sliceIndex(page), { timeout: 20_000 }).toBeGreaterThan(0);
  const box = await scrollbar.boundingBox();
  if (!box) throw new Error('no scrollbar bounding box');

  // Top of the track ⇒ first slices.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.04);
  await expect.poll(() => sliceIndex(page), { timeout: 20_000 }).toBeLessThanOrEqual(3);

  // Bottom of the track ⇒ last slices (proves the viewport actually scrubbed).
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.96);
  await expect.poll(() => sliceIndex(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(13);
});
