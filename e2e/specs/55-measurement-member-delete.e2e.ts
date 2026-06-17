/**
 * SR-B — measurement member controls operate on the Cornerstone annotation (by UID).
 *
 * Bug (live CNDA review): the member-row controls (delete/lock/rename/visibility)
 * did `Number(memberId)` and bailed unless it was a positive integer — SEG
 * segment-index semantics. Measurement member ids are annotation UIDs (strings), so
 * every control silently no-op'd; measurements could not be deleted. This drives the
 * REAL affordance: draw a Length → click the member's Delete → the measurement is
 * actually removed (member row gone + Cornerstone measurement count back to 0).
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../helpers/local-fixture';

interface E2EHooks {
  setMultiviewportEnabled: (v: boolean) => void;
  setActiveUnifiedTool: (toolName: string) => void;
  getMeasurementCount: () => number;
  clearAllAnnotations: () => void;
}
type Win = { __XNAT_E2E__: E2EHooks };

// Isolate from any measurement a prior spec left in the worker-scoped app (specs
// run in the same Electron worker — "passes alone, fails combined" otherwise).
test.beforeEach(async ({ page }) => {
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllAnnotations());
});

test('SR-B: deleting a measurement member removes the real annotation', async ({ page }) => {
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setMultiviewportEnabled(true));
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  // Open idempotently — the toggle may already be open from a prior spec in the worker.
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  }
  await expect(panel).toBeVisible({ timeout: 15_000 });

  // Draw a Length (real gesture).
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setActiveUnifiedTool('Length'));
  const canvas = page.locator('[data-testid="unified-viewport-element:panel_0"] canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const cy = box!.y + box!.height / 2;
  await page.mouse.move(box!.x + box!.width * 0.35, cy);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.65, cy, { steps: 6 });
  await page.mouse.up();

  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getMeasurementCount()), { timeout: 15_000 })
    .toBe(1);
  const member = panel.locator('[data-testid^="member-row-"]');
  await expect(member).toHaveCount(1);

  // Delete the measurement member via the real row control.
  await member.getByLabel('Delete member').click();

  // The Cornerstone annotation is actually gone (not just hidden) + the row is removed.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getMeasurementCount()), { timeout: 10_000 })
    .toBe(0);
  await expect(panel.locator('[data-testid^="member-row-"]')).toHaveCount(0);
});
