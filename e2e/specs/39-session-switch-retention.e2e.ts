/**
 * Session-switch retention (Change 1c / A13, visual acceptance). When the viewer
 * switches to a different XNAT session, dirty containers from the previous session
 * are RETAINED in memory (never silently dropped) while clean ones are unloaded.
 * Drives the REAL segmentationManager.applySessionSwitch + the live panel: the
 * dirty container survives the switch (still listed, still counted unsaved); the
 * clean one is removed.
 */
import { test, expect } from '../fixtures/electron-app';
import { loadFixture } from '../helpers/local-fixture';

interface E2EHooks {
  setMultiviewportEnabled: (v: boolean) => void;
  seedSessionContainer: (sessionId: string, dirty: boolean) => Promise<string>;
  setViewerSession: (sessionId: string) => void;
  applySessionSwitch: (toSessionId: string) => void;
  getSegmentationCount: () => number;
  resetUnifiedSegmentations: () => void;
}
type Win = { __XNAT_E2E__: E2EHooks };

// Isolate from any container/session a prior test left in the worker-scoped app
// (the documented "passes alone, fails combined" cross-test pollution).
test.beforeEach(async ({ page }) => {
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
});

test('Change 1c: switching sessions retains dirty work, unloads clean work', async ({ page }) => {
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setMultiviewportEnabled(true));
  await loadFixture(page, 'ct-axial-300', 'panel_0');

  await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  await expect(panel).toBeVisible({ timeout: 15_000 });

  // We're viewing session A; seed one DIRTY and one CLEAN container, both in A.
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setViewerSession('SESSION_A'));
  const dirtyId = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.seedSessionContainer('SESSION_A', true));
  const cleanId = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.seedSessionContainer('SESSION_A', false));

  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getSegmentationCount()))
    .toBe(2);
  await expect(panel.locator(`[data-testid="container-row-${dirtyId}"]`)).toBeVisible();
  await expect(panel.locator(`[data-testid="container-row-${cleanId}"]`)).toBeVisible();
  await expect(panel.locator('[data-testid="unsaved-count"]')).toHaveText('1');

  // Switch to session B → the dirty A container is retained, the clean A one unloaded.
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.applySessionSwitch('SESSION_B'));

  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getSegmentationCount()))
    .toBe(1);
  await expect(panel.locator(`[data-testid="container-row-${dirtyId}"]`)).toBeVisible(); // retained
  await expect(panel.locator(`[data-testid="container-row-${cleanId}"]`)).toHaveCount(0); // unloaded
  // The unsaved indicator still surfaces the held-over work.
  await expect(panel.locator('[data-testid="unsaved-count"]')).toHaveText('1');
});

test('signal 26: switching the active session re-scopes the panel + surfaces the retained session in the banner', async ({ page }) => {
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setMultiviewportEnabled(true));
  await loadFixture(page, 'ct-axial-300', 'panel_0');

  const panel = page.locator('[data-testid="annotations-side-panel"]');
  // Open the panel idempotently — a prior test in this worker may have left it open
  // (the "Show segmentation panel" button is a toggle).
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  }
  await expect(panel).toBeVisible({ timeout: 15_000 });
  const banner = page.locator('[data-testid="unsaved-sessions-banner"]');

  // Viewing session A; seed a DIRTY container in A. While A is active, it's LISTED in
  // the panel and there's no cross-session banner.
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setViewerSession('SESSION_A'));
  const dirtyId = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.seedSessionContainer('SESSION_A', true));
  await expect(panel.locator(`[data-testid="container-row-${dirtyId}"]`)).toBeVisible();
  await expect(banner).toHaveCount(0);

  // Switch the active session to B: A's dirty container is RETAINED in memory but the
  // panel re-scopes to B (A13: one study at a time) — the held-over row disappears
  // from the panel — and the banner surfaces it instead (immediately, from the
  // in-memory dirty state, no dependency on the auto-save backup timer).
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.applySessionSwitch('SESSION_B'));
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setViewerSession('SESSION_B'));

  await expect(panel.locator(`[data-testid="container-row-${dirtyId}"]`)).toHaveCount(0); // re-scoped out of the panel
  await expect(page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getSegmentationCount())).resolves.toBe(1); // still retained in memory
  await expect(banner).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="unsaved-sessions-banner-text"]')).toContainText('1 session');
});
