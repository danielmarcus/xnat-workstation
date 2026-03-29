/**
 * Base Electron Fixture
 *
 * Launches the built Electron app and provides `electronApp` + `page` fixtures.
 * The app must be compiled first (`npm run build`).
 *
 * The `electronApp` fixture is worker-scoped — one Electron instance is shared
 * across all tests in a spec file, avoiding the cost of relaunching for each test.
 */
import { test as base, _electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'path';

export type ElectronFixtures = {
  electronApp: ElectronApplication;
  page: Page;
};

export const test = base.extend<
  { page: Page },
  { electronApp: ElectronApplication }
>({
  // Worker-scoped: one Electron app per spec file
  electronApp: [async ({}, use) => {
    const projectRoot = path.resolve(__dirname, '..', '..');
    const mainEntry = path.join(projectRoot, 'dist', 'main', 'main', 'index.js');

    const app = await _electron.launch({
      args: [mainEntry],
      cwd: projectRoot,
      env: {
        ...process.env,
        // Signal to the app that E2E tests are running (hides window, skips DevTools)
        E2E_TESTING: '1',
        NODE_ENV: 'production',
      },
    });

    await use(app);

    // Force-kill the Electron process tree. A graceful app.close() can hang
    // indefinitely if modal dialogs (e.g. "unsaved annotations") are blocking
    // the quit sequence. process().kill() sends SIGKILL which cannot be blocked.
    const pid = app.process().pid;
    try {
      if (pid) process.kill(pid, 'SIGKILL');
    } catch {
      // Process may already be gone
    }
  }, { scope: 'worker' }],

  // Per-test: get the first window from the shared app
  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await use(page);
  },
});

export { expect } from '@playwright/test';
