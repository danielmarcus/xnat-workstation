/**
 * Bug (user-reported): after navigating away from a session (loading another scan),
 * a measurement from the previous session stayed in the Annotations panel. SR
 * containers had no session scoping — inActiveSession treats an empty sessionId as
 * "always show", and SR containers always got sessionId ''. Now measurements + their
 * containers carry the authoring session, so the panel scopes them (A13: one study at
 * a time), exactly like SEG/RTSTRUCT.
 *
 * Real affordance: draw a Length while viewing session A → it lists; switch the viewer
 * to session B → it leaves the panel; switch back to A → it returns (retained, scoped).
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../helpers/local-fixture';

interface E2EHooks {
  setActiveUnifiedTool: (toolName: string) => void;
  setViewerSession: (sessionId: string) => void;
  clearAllContainers: () => void;
}
type Win = { __XNAT_E2E__: E2EHooks };

const cleanSlate = async (page: Page) =>
  page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.clearAllContainers());
test.beforeEach(({ page }) => cleanSlate(page));
test.afterEach(({ page }) => cleanSlate(page));

test('a measurement is scoped to its session — it leaves the panel on session switch and returns on switch-back', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');

  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  }
  await expect(panel).toBeVisible({ timeout: 15_000 });

  // Viewing session A: draw a Length → it lists in the panel.
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setViewerSession('SESSION_A'));
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setActiveUnifiedTool('Length'));
  const canvas = page.locator('[data-testid="unified-viewport-element:panel_0"] canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const cy = box!.y + box!.height / 2;
  await page.mouse.move(box!.x + box!.width * 0.35, cy);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.65, cy, { steps: 6 });
  await page.mouse.up();
  await expect(panel.locator('[data-testid^="member-row-"]')).toHaveCount(1, { timeout: 15_000 });

  // Switch the viewer to session B → the session-A measurement leaves the panel.
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setViewerSession('SESSION_B'));
  await expect(panel.locator('[data-testid^="member-row-"]')).toHaveCount(0, { timeout: 10_000 });

  // Switch back to A → it returns (retained in memory, scoped back into the panel).
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setViewerSession('SESSION_A'));
  await expect(panel.locator('[data-testid^="member-row-"]')).toHaveCount(1, { timeout: 10_000 });
});
