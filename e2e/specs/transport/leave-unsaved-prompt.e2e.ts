/**
 * Leave-with-unsaved-work prompt (proposal §4.2) — the inversion of the A13/Change 1c
 * retention this file used to assert.
 *
 * Retention kept dirty containers from the session being left alive in memory forever:
 * listed in the panel, rendering in no viewport, identified by a scan-id badge that is
 * blank for exactly that work because it is only populated once saved. The user's
 * summary: "impossible to tell which previous image it is associated with."
 *
 * The rule now is prompt-then-unload — Save · Discard · Cancel — and nothing stays
 * loaded that renders nowhere. Re-opening the scan reloads it
 * (transport/scan-click-autoload covers that half).
 *
 * Drives the REAL guard (`leaveGuard.guardLoad`, the exact call App.loadFromXnatScan
 * makes), the real dialog and the real unload. The hook is the production entry point
 * with the production arguments, not a shortcut past it.
 */
import { test, expect } from '../../fixtures/electron-app';
import { loadFixture } from '../../helpers/local-fixture';

interface E2EHooks {
  seedSessionContainer: (sessionId: string, dirty: boolean) => Promise<string>;
  setViewerSession: (sessionId: string) => void;
  guardLoad: (
    load: { viewportId: string | null; toSessionId: string; fromSessionId: string | null },
    leavingLabel?: string,
  ) => Promise<'proceed' | 'cancel'>;
  getSegmentationCount: () => number;
  resetUnifiedSegmentations: () => void;
}
type Win = { __XNAT_E2E__: E2EHooks; __guard?: Promise<'proceed' | 'cancel'> };

/** Start the guard WITHOUT awaiting it — it blocks on the dialog the test then drives. */
async function startGuard(page: import('@playwright/test').Page, toSessionId: string) {
  await page.evaluate((to) => {
    const w = window as unknown as Win;
    w.__guard = w.__XNAT_E2E__.guardLoad(
      { viewportId: null, toSessionId: to, fromSessionId: 'SESSION_A' },
      'MR_SESSION_A',
    );
  }, toSessionId);
}
const guardResult = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as Win).__guard!);

// Isolate from any container/session a prior test left in the worker-scoped app
// (the documented "passes alone, fails combined" cross-test pollution).
test.beforeEach(async ({ page }) => {
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.resetUnifiedSegmentations());
});

test('leaving a session with unsaved work prompts, naming the annotation', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  await expect(panel).toBeVisible({ timeout: 15_000 });

  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setViewerSession('SESSION_A'));
  const dirtyId = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.seedSessionContainer('SESSION_A', true));
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.seedSessionContainer('SESSION_A', false));
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getSegmentationCount()))
    .toBe(2);

  await startGuard(page, 'SESSION_B');

  // The prompt names what is being left AND which annotation — the identity the old
  // held-over row could not show.
  await expect(page.locator('[data-testid="leave-unsaved-dialog"]')).toContainText('MR_SESSION_A');
  await expect(page.locator(`[data-testid="leave-unsaved-entry-${dirtyId}"]`)).toBeVisible();
  // The CLEAN container is not in the prompt — there is nothing to lose.
  expect(await page.locator('[data-testid^="leave-unsaved-entry-"]').count()).toBe(1);

  // Cancel aborts the switch and drops nothing.
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(guardResult(page)).resolves.toBe('cancel');
  await expect(page.locator('[data-testid="leave-unsaved-dialog"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getSegmentationCount())).toBe(2);
  await expect(panel.locator(`[data-testid="container-row-${dirtyId}"]`)).toBeVisible();
});

test('discarding unloads the orphans — nothing stays loaded that renders nowhere', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  const panel = page.locator('[data-testid="annotations-side-panel"]');
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: 'Show segmentation panel' }).click();
  }
  await expect(panel).toBeVisible({ timeout: 15_000 });

  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setViewerSession('SESSION_A'));
  const dirtyId = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.seedSessionContainer('SESSION_A', true));
  const cleanId = await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.seedSessionContainer('SESSION_A', false));
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getSegmentationCount()))
    .toBe(2);

  await startGuard(page, 'SESSION_B');
  await expect(page.locator('[data-testid="leave-unsaved-dialog"]')).toBeVisible();
  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(guardResult(page)).resolves.toBe('proceed');

  // BOTH go: the dirty one because the user discarded it, the clean one because it was
  // never at risk. Neither is retained — this is the behaviour that replaced retention.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getSegmentationCount()))
    .toBe(0);
  await expect(panel.locator(`[data-testid="container-row-${dirtyId}"]`)).toHaveCount(0);
  await expect(panel.locator(`[data-testid="container-row-${cleanId}"]`)).toHaveCount(0);

  // ...and with nothing held over, the cross-session unsaved banner has nothing to say.
  await expect(page.locator('[data-testid="unsaved-sessions-banner"]')).toHaveCount(0);
});

test('a load that orphans nothing never prompts (GH #75 holds by construction)', async ({ page }) => {
  await loadFixture(page, 'ct-axial-300', 'panel_0');
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setViewerSession('SESSION_A'));
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.seedSessionContainer('SESSION_A', true));

  // Same session, loading into a viewport the container does not render on.
  const result = await page.evaluate(() =>
    (window as unknown as Win).__XNAT_E2E__.guardLoad({
      viewportId: 'panel_3',
      toSessionId: 'SESSION_A',
      fromSessionId: 'SESSION_A',
    }),
  );
  expect(result).toBe('proceed');
  await expect(page.locator('[data-testid="leave-unsaved-dialog"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.getSegmentationCount())).toBe(1);
});
