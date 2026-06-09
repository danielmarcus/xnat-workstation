/**
 * Unsaved-work banner (Lifecycle L3 / A13 / E5, visual acceptance). When annotation
 * work is left unsaved in a session you've navigated away from, a persistent banner
 * below the toolbar surfaces it (never silently stranded). Drives the REAL banner
 * data path: seed a dirty container tagged to another session + set the active
 * session, then assert the live-store-connected banner renders and dismisses.
 *
 * (The production trigger — session-switch retention, L2 — is the deferred App-flow
 * integration; this verifies the banner + its selector against the real stores.)
 */
import { test, expect } from '../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { loadFixture } from '../helpers/local-fixture';

interface E2EHooks {
  setMultiviewportEnabled: (v: boolean) => void;
  seedRetainedUnsavedSession: (containerSessionId: string, activeSessionId: string) => Promise<string>;
}
type Win = { __XNAT_E2E__: E2EHooks };

test('signal 26: unsaved work retained in another session surfaces a dismissible banner', async ({ page }) => {
  await page.evaluate(() => (window as unknown as Win).__XNAT_E2E__.setMultiviewportEnabled(true));
  await loadFixture(page, 'ct-axial-300', 'panel_0');

  const banner = page.locator('[data-testid="unsaved-work-banner"]');
  // Nothing stranded yet → no banner.
  await expect(banner).toHaveCount(0);

  // A container left dirty in session "CT_BRAIN_01" while we're now viewing "MR_SPINE_02".
  await page.evaluate(() =>
    (window as unknown as Win).__XNAT_E2E__.seedRetainedUnsavedSession('CT_BRAIN_01', 'MR_SPINE_02'),
  );

  // The banner appears and names the stranded session.
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await expect(banner).toContainText('1 unsaved annotation retained in 1 other session');
  await expect(banner).toContainText('CT_BRAIN_01');

  // Dismiss → banner hidden (persistent until the user dismisses it).
  await banner.getByRole('button', { name: 'Dismiss unsaved-work banner' }).click();
  await expect(banner).toHaveCount(0);
});
