/**
 * Phase-6 cutover parity — clicking a measurement row highlights it on the viewport.
 *
 * The legacy AnnotationListPanel's row click called
 * `annotationService.selectAnnotation(uid)` so the drawn measurement lights up in the
 * image. The rebuilt panel's selection was panel-local only (annotationSelectionStore),
 * so deleting the legacy panel would have silently dropped that behaviour.
 *
 * The row click now SELECTS the annotation through Cornerstone's selection (it used to
 * set `highlighted`, Cornerstone's hover state); the selected look itself is covered
 * by annotations/selected-indicator.
 *
 * Drives the real path: draw a Length, click its member row, read Cornerstone's
 * own selection.
 */
import { test, expect } from '../../fixtures/electron-app';
import { loadFixture } from '../../helpers/local-fixture';

interface E2EHooks {
  setActiveUnifiedTool: (toolName: string) => void;
  getMeasurementCount: () => number;
  getActiveContourSnapshot: (panelId?: string) => { selected: string[] };
  clearAllContainers: () => void;
}
type Win = { __XNAT_E2E__: E2EHooks };

const cleanSlate = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers());
test.beforeEach(({ page }) => cleanSlate(page));
test.afterEach(({ page }) => cleanSlate(page));

test('clicking a measurement row highlights that annotation on the viewport', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');

  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  }
  await expect(panel).toBeVisible({ timeout: 15_000 });

  // Draw TWO Lengths (real tool + real gestures), so the row click is proven to MOVE
  // the selection rather than read whatever the last draw left behind.
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setActiveUnifiedTool('Length'));
  const canvas = page.locator('[data-testid="unified-viewport-element:panel_0"] canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const drawAt = async (yFraction: number) => {
    const y = box!.y + box!.height * yFraction;
    await page.mouse.move(box!.x + box!.width * 0.35, y);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.65, y, { steps: 6 });
    await page.mouse.up();
  };
  await drawAt(0.4);
  await drawAt(0.6);

  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getMeasurementCount()), { timeout: 15_000 })
    .toBe(2);

  const rows = panel.locator('[data-testid^="member-row-"]');
  await expect(rows).toHaveCount(2, { timeout: 10_000 });

  // The FIRST row's annotation UID (member id === annotationUID for measurements).
  const firstUid = (await rows.first().getAttribute('data-testid'))!.replace('member-row-', '');
  const selected = () =>
    page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getActiveContourSnapshot('panel_0').selected);
  expect(await selected()).not.toEqual([firstUid]);

  // Click the first row → the viewport selection moves to it (legacy parity).
  await rows.first().click();
  await expect
    .poll(selected, { timeout: 10_000, message: 'the clicked measurement should become the selected annotation' })
    .toEqual([firstUid]);
});
