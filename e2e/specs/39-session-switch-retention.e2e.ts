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
}
type Win = { __XNAT_E2E__: E2EHooks };

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

test('signal 26: after switching the active session away, the unsaved-work banner surfaces the retained session', async ({ page }) => {
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setMultiviewportEnabled(true));
  await loadFixture(page, 'ct-axial-300', 'panel_0');

  const banner = page.locator('[data-testid="unsaved-sessions-banner"]');

  // Viewing session A; seed a DIRTY container in A. While A is active, its own
  // unsaved work shows in-panel (not as the cross-session banner).
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setViewerSession('SESSION_A'));
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.seedSessionContainer('SESSION_A', true));
  await expect(banner).toHaveCount(0);

  // Switch the active session to B: A's dirty container is retained in memory; the
  // banner must now surface it — immediately, from the in-memory dirty state, with
  // no dependency on the local-backup auto-save timer having fired.
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.applySessionSwitch('SESSION_B'));
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setViewerSession('SESSION_B'));

  await expect(banner).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="unsaved-sessions-banner-text"]')).toContainText('1 session');
});
