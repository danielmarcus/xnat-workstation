/**
 * Bug (user-reported): a locked structure's contours could still be modified by
 * dragging. Root cause: the row "lock" set the Cornerstone segmentation SEGMENT lock
 * (which only gates labelmap/brush editing), but a structure's contours are
 * annotations whose manipulation is gated by ANNOTATION locking — never set. The fix
 * mirrors the segment lock onto the segment's contour annotations.
 *
 * Real affordance: create a structure with a contour, click the member row's lock
 * control, and assert the underlying contour annotation is locked (Cornerstone blocks
 * manipulation of locked annotations).
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../helpers/local-fixture';

interface E2EHooks {
  setMultiviewportEnabled: (v: boolean) => void;
  createTestStructure: (panelId: string, label: string) => Promise<string>;
  createTestContour: (panelId: string, segmentationId: string, segmentIndex?: number, provenance?: string) => string | null;
  getAnnotationLockState: (uid: string) => boolean;
  clearAllContainers: () => void;
}
type Win = { __XNAT_E2E__: E2EHooks };

const cleanSlate = async (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers());
test.beforeEach(({ page }) => cleanSlate(page));
test.afterEach(({ page }) => cleanSlate(page));

test('locking a structure locks its contour annotations (edits blocked)', async ({ page }) => {
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setMultiviewportEnabled(true));
  await loadFixture(page, 'ct-axial-300', 'panel_0');

  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  }
  await expect(panel).toBeVisible({ timeout: 15_000 });

  // Create a structure with one contour on segment 1.
  const segId = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.createTestStructure('panel_0', 'Lesion'));
  const contourUid = await page.evaluate(
    (id) => (window as unknown as Win).__XNAT_E2E__.createTestContour('panel_0', id, 1),
    segId,
  );
  expect(contourUid).toBeTruthy();
  expect(await page.evaluate((u) => (window as unknown as Win).__XNAT_E2E__.getAnnotationLockState(u), contourUid as string)).toBe(false);

  // Lock the structure's member via the real row control.
  await expect(panel.locator('[data-testid^="member-row-"]').first()).toBeVisible({ timeout: 10_000 });
  await panel.getByLabel('Toggle lock').first().click();

  // The underlying contour annotation is now locked — Cornerstone blocks dragging it.
  await expect
    .poll(() => page.evaluate((u) => (window as unknown as Win).__XNAT_E2E__.getAnnotationLockState(u), contourUid as string), { timeout: 10_000 })
    .toBe(true);

  // Unlock → the annotation lock clears too.
  await panel.getByLabel('Toggle lock').first().click();
  await expect
    .poll(() => page.evaluate((u) => (window as unknown as Win).__XNAT_E2E__.getAnnotationLockState(u), contourUid as string), { timeout: 10_000 })
    .toBe(false);
});
