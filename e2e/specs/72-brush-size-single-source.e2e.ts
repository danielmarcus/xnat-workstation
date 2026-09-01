/**
 * Phase-6 cutover item 5 — brush size has ONE source of truth.
 *
 * Before: three disconnected stores. The panel slider kept its own local hook
 * state and wrote the UNIFIED tool group; the `[` / `]` hotkeys wrote
 * segmentationStore + `segmentationService.setBrushSize`, which targets the
 * LEGACY tool group (`xnatToolGroup_primary`) — a group with no viewports since
 * P1.8d, so the hotkeys changed nothing the user could see. `viewerStore.brushSize`
 * was dead.
 *
 * This drives the real hotkeys and reads Cornerstone's actual brush radius on the
 * unified group, plus the panel slider's rendered value (both must agree).
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../helpers/local-fixture';

interface E2EHooks {
  getUnifiedBrushSize: () => number | null;
  clearAllContainers: () => void;
}
type Win = { __XNAT_E2E__: E2EHooks };

const brushRadius = (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getUnifiedBrushSize());

test.beforeEach(({ page }) => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers()));

test('the [ and ] hotkeys and the panel slider share one brush size', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');

  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  }
  await expect(panel).toBeVisible({ timeout: 15_000 });

  // A SEG container + member makes the toolbox (and its brush slider) live.
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await expect(panel.getByLabel('Rename container')).toBeVisible({ timeout: 15_000 });
  await panel.getByLabel('Rename container').press('Enter');
  await expect(panel.getByLabel('Rename member')).toBeVisible({ timeout: 10_000 });
  await panel.getByLabel('Rename member').press('Enter');

  const slider = panel.getByLabel('Brush size');
  await expect(slider).toBeVisible({ timeout: 10_000 });

  const start = await brushRadius(page);
  expect(start).not.toBeNull();
  expect(Number(await slider.inputValue())).toBe(start);

  // ']' increases the size by 2 — on the group the brush actually runs on.
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(']');
  await expect.poll(() => brushRadius(page), { timeout: 10_000 }).toBe(start! + 2);
  // …and the panel slider reflects it (same store, not a private copy).
  await expect.poll(async () => Number(await slider.inputValue()), { timeout: 10_000 }).toBe(start! + 2);

  // '[' decreases it again.
  await page.keyboard.press('[');
  await expect.poll(() => brushRadius(page), { timeout: 10_000 }).toBe(start);
  await expect.poll(async () => Number(await slider.inputValue()), { timeout: 10_000 }).toBe(start);

  // Driving the slider moves the real brush too.
  await slider.fill('19');
  await expect.poll(() => brushRadius(page), { timeout: 10_000 }).toBe(19);
  // …and the hotkeys continue from the slider's value (one source of truth).
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(']');
  await expect.poll(() => brushRadius(page), { timeout: 10_000 }).toBe(21);
});
