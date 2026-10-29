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
import os from 'os';
import fs from 'fs';

export type ElectronFixtures = {
  electronApp: ElectronApplication;
  page: Page;
};

export const test = base.extend<
  { page: Page; resetState: void },
  { electronApp: ElectronApplication; extensionsDir: string | undefined }
>({
  /**
   * The edition's extensions for this spec file's app (docs/extension-framework.md): a folder of
   * extension folders, set with `test.use({ extensionsDir })`. Default: an empty folder, so the
   * app runs as an edition with no extensions.
   */
  extensionsDir: [undefined, { scope: 'worker', option: true }],

  // Worker-scoped: one Electron app per spec file
  electronApp: [async ({ extensionsDir }, use) => {
    const projectRoot = path.resolve(__dirname, '..', '..');
    const mainEntry = path.join(projectRoot, 'dist', 'main', 'main', 'index.js');

    // Launch with an ISOLATED, throwaway user-data-dir. Without this the E2E app
    // shares the real app's profile (~/Library/Application Support/XNAT), so it
    // inherits persisted UI/session state — a collapsed toolbar group, a logged-in
    // session, a remembered layout — which silently breaks specs (e.g. a collapsed
    // annotation group hides the toolbar Undo button) and conflicts with a running
    // `npm run dev` instance (shared profile / Chromium singleton lock). A fresh dir
    // per worker guarantees a clean profile and never touches the user's real data.
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xnat-e2e-profile-'));

    // E2E_EXECUTABLE_PATH runs the same specs against a PACKAGED app (e.g.
    // `release/mac-arm64/XNAT Workstation.app/Contents/MacOS/XNAT Workstation`), whose
    // entry point is baked into its asar — so no main-entry argument. Default: dist/.
    const executablePath = process.env.E2E_EXECUTABLE_PATH;
    // E2E_ELECTRON_ARGS adds Chromium switches, e.g. on a GPU-less Linux host
    // `--enable-unsafe-swiftshader` gives the software WebGL2 Cornerstone needs.
    const extraArgs = (process.env.E2E_ELECTRON_ARGS ?? '').split(/\s+/).filter(Boolean);
    const app = await _electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: [...(executablePath ? [] : [mainEntry]), `--user-data-dir=${userDataDir}`, ...extraArgs],
      cwd: projectRoot,
      env: {
        ...process.env,
        // Signal to the app that E2E tests are running (hides window, skips DevTools)
        E2E_TESTING: '1',
        // An empty folder of bundled modules per worker — tests put an edition's packages in it
        // (helpers/modules.ts); E2E_KEEP_BUNDLED=1 keeps the build's own (packaged-edition check).
        ...(process.env.E2E_KEEP_BUNDLED === '1' ? {} : { XNAT_E2E_BUNDLED_MODULES: fs.mkdtempSync(path.join(os.tmpdir(), 'xnat-e2e-bundled-')) }),
        // The edition's extensions: the spec's, or none (E2E_KEEP_BUNDLED keeps the package's own).
        ...(process.env.E2E_KEEP_BUNDLED === '1' ? {} : { XNAT_E2E_EXTENSIONS: extensionsDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'xnat-e2e-extensions-')) }),
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
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup of the throwaway profile.
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
      // NOTE: no edit-mode reset here. There used to be one, which was a mistake: it
      // forced the mode to fill before every test, so the whole suite was structurally
      // incapable of observing the app's real startup mode — and it shipped defaulting
      // to erase while every spec passed. The mode is session state now (not persisted),
      // so the reload below resets it on its own and nothing needs faking.
      await win.reload({ waitUntil: 'load' });
      // Wait until the renderer has actually BOOTED — not just hit DOMContentLoaded.
      // The E2E hooks install synchronously at module load (main.tsx, BEFORE React
      // mounts), so `__XNAT_E2E__` alone resolves too early: the test's first
      // page.evaluate can then race the tail of the reload ("Execution context was
      // destroyed, most likely because of a navigation"). Also require the React
      // root to have rendered, which only happens once the post-reload render cycle
      // has settled — making the page stable before the test's first action.
      await win
        .waitForFunction(
          () => {
            const w = window as unknown as { __XNAT_E2E__?: unknown };
            const root = document.getElementById('root');
            return !!w.__XNAT_E2E__ && !!root && root.childElementCount > 0;
          },
          null,
          { timeout: 15_000 },
        )
        .catch(() => {});
    } catch {
      // No window yet — nothing to reset.
    }
    await use();
  }, { auto: true }],
});

export { expect } from '@playwright/test';
