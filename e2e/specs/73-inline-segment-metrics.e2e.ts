/**
 * Inline per-segment metrics in the member row (frozen mockup §3 — "86 cm³").
 *
 * The compute path (`segmentationService.getSegmentStatistics`) already existed and
 * fed the kebab CSV export, but nothing surfaced it in the panel: a SEG member row's
 * metric slot was always blank. This drives the real path — create a SEG from the
 * panel header, paint with the real brush on the real canvas — and asserts the row
 * shows a volume once the statistics settle.
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../helpers/local-fixture';

interface E2EHooks {
  setActiveUnifiedTool: (toolName: string) => void;
  setUnifiedBrushSize: (size: number) => void;
  getPaintedVoxelCount: () => number;
  clearAllContainers: () => void;
}
type Win = { __XNAT_E2E__: E2EHooks };

const hook = <T,>(page: Page, fn: keyof E2EHooks, ...args: unknown[]): Promise<T> =>
  page.evaluate(
    ([name, a]) => (window as unknown as Win).__XNAT_E2E__[name as keyof E2EHooks](...(a as [])),
    [fn, args] as const,
  ) as Promise<T>;

test.beforeEach(({ page }) => hook(page, 'clearAllContainers'));
test.afterEach(({ page }) => hook(page, 'clearAllContainers'));

test('a painted segment shows its volume inline in the member row', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');

  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  }
  await expect(panel).toBeVisible({ timeout: 15_000 });

  // Real create → container + default member, both named through the two-step flow.
  await panel.getByRole('button', { name: 'New Segmentation (SEG)' }).click();
  await expect(panel.getByLabel('Rename container')).toBeVisible({ timeout: 15_000 });
  await panel.getByLabel('Rename container').press('Enter');
  await expect(panel.getByLabel('Rename member')).toBeVisible({ timeout: 10_000 });
  await panel.getByLabel('Rename member').press('Enter');

  const memberRow = panel.locator('[data-testid^="member-row-"]').first();
  await expect(memberRow).toBeVisible({ timeout: 10_000 });
  // Nothing painted yet → no metric.
  await expect(memberRow).not.toContainText('cm³');
  await expect(memberRow).not.toContainText('mm³');

  // Paint with the real brush across the centre of the image.
  await hook(page, 'setActiveUnifiedTool', 'Brush');
  await hook(page, 'setUnifiedBrushSize', 20);
  const canvas = page.locator('[data-testid="unified-viewport-element:panel_0"] canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const cx = box!.x + box!.width / 2;
  const cy = box!.y + box!.height / 2;
  await page.mouse.move(cx - 40, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 40, cy, { steps: 10 });
  await page.mouse.up();

  await expect
    .poll(() => hook<number>(page, 'getPaintedVoxelCount'), { timeout: 15_000 })
    .toBeGreaterThan(0);

  // The row now carries the segment's volume (statistics are debounced ~700ms).
  await expect(memberRow).toContainText(/\d+(\.\d)?\s(cm³|mm³)/, { timeout: 20_000 });
});
