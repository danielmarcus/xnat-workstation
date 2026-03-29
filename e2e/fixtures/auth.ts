/**
 * Authenticated Electron Fixture
 *
 * Extends the base electron-app fixture with pre-authentication via
 * the E2E direct-login IPC handler. Auth happens once per worker
 * (spec file), then all tests in that file share the authenticated state.
 *
 * Strategy: authenticate in the main process via directLogin IPC, then
 * reload the page. On reload, the connection store's auto-startup
 * checkSession() detects the valid session and transitions to 'connected'.
 */
import { test as electronTest, expect } from './electron-app';
import { getE2EConfig } from '../helpers/env';
import type { ElectronApplication, Page } from '@playwright/test';

export const test = electronTest.extend<
  { authenticatedPage: Page },
  { authenticatedApp: ElectronApplication }
>({
  // Worker-scoped: authenticate once, share across all tests in the file
  authenticatedApp: [async ({ electronApp }, use) => {
    const config = getE2EConfig();
    const page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Authenticate via the E2E direct-login IPC handler (main process)
    const result = await page.evaluate(
      async ({ url, user, pass }) => {
        return (window as any).electronAPI.e2e.directLogin(url, user, pass);
      },
      { url: config.xnatUrl, user: config.xnatUser, pass: config.xnatPassword },
    );

    if (!result.success) {
      throw new Error(`Direct login failed: ${result.error}`);
    }

    // The main process is now authenticated, but the renderer's connection
    // store still shows 'disconnected'. Reload the page — on startup, the
    // store's checkSession() auto-detects the valid session and transitions
    // to 'connected'. (See connectionStore.ts: auto-detect on module import.)
    await page.reload({ waitUntil: 'domcontentloaded' });

    // Wait for the login form to disappear (checkSession is async)
    await expect(page.locator('[data-testid="login-form"]')).toBeHidden({ timeout: 30_000 });

    await use(electronApp);
  }, { scope: 'worker' }],

  // Per-test: get the page from the already-authenticated app
  authenticatedPage: async ({ authenticatedApp }, use) => {
    const page = await authenticatedApp.firstWindow();
    await use(page);
  },
});

export { expect } from '@playwright/test';
