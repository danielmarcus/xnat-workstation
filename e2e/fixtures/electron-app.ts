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
  { page: Page; resetState: void },
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

  // Autouse worker-isolation reset. The worker-scoped Electron app keeps ONE
  // renderer alive across the entire single-worker run, so in-memory state leaks
  // between specs — an open save/discard or conflict dialog, leftover
  // segmentations / measurements / SR containers, a ref-counted shared volume
  // still held, the unified tool-group's tool modes/bindings, a non-default
  // layout. That is the "passes alone, fails combined" pollution.
  //
  // A full renderer RELOAD before every test is the robust clean slate: it
  // re-runs main.tsx, so Cornerstone, the tool group, every Zustand store and
  // every cache are reconstructed from scratch — no need to enumerate (and keep
  // in sync with) each individual pollution vector. The newer annotation specs
  // already self-reset in their own beforeEach; this extends isolation to the
  // whole suite. Offline specs re-enter the viewer (enterLocalViewer) and the
  // live `auth` specs re-detect their main-process session on reload, so both
  // survive it. Defensive: never fails the test on its own.
  resetState: [async ({ electronApp }, use) => {
    try {
      const win = await electronApp.firstWindow();
      await win.reload({ waitUntil: 'domcontentloaded' });
      // The E2E hooks are (re)installed synchronously on renderer boot; wait for
      // them so the first action of the test doesn't race the reload.
      await win
        .waitForFunction(() => !!(window as unknown as { __XNAT_E2E__?: unknown }).__XNAT_E2E__, null, {
          timeout: 15_000,
        })
        .catch(() => {});
    } catch {
      // No window yet — nothing to reset.
    }
    await use();
  }, { auto: true }],
});

export { expect } from '@playwright/test';
