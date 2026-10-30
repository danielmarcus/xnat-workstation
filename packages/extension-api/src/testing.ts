/**
 * `@nrgxnat/workstation-extension-api/testing` — run an extension's own E2E with Playwright
 * against a built XNAT Workstation (extension framework X5, R11 — docs/extension-framework.md).
 *
 * The app runs as under the core's own E2E (E2E_TESTING=1): `ext.testing` is true, so an
 * extension can swap its services for fakes, and every running extension's renderer context is
 * reachable from the test (`extension(page, id).evaluate(...)`) — the test drives the real API,
 * not a copy of it.
 *
 *   const run = await launchWorkstation({ mainEntry: '<core>/dist/main/main/index.js', extensionsDir: 'dist' });
 *   await extension(run.page, 'org.example.notes').waitUntilRunning();
 *   expect(await extension(run.page, 'org.example.notes').evaluate((ext) => ext.storage.keys())).toEqual([]);
 *   await run.close();
 *
 * Against a packaged edition pass `executablePath`: its extensions are the ones built into it
 * (an unpackaged app takes them from `extensionsDir`, which a packaged one ignores).
 */
import { _electron, type ElectronApplication, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EXTENSION_TEST_GLOBAL, type RendererExtensionContext } from '../../../src/shared/extensions/api';

export interface LaunchOptions {
  /** An unpackaged core: its built main entry (`<core>/dist/main/main/index.js`). */
  mainEntry?: string;
  /** Or a packaged app's executable. */
  executablePath?: string;
  /** For an unpackaged core: the folder of extension folders to load. */
  extensionsDir?: string;
  /** A user-data folder (default: a fresh one, removed by close()). Reuse one to test a restart. */
  userDataDir?: string;
  /** More environment for the app. */
  env?: Record<string, string>;
}

export interface WorkstationRun {
  app: ElectronApplication;
  page: Page;
  userDataDir: string;
  /** Close the app (and remove the user-data folder this created). */
  close(): Promise<void>;
}

export async function launchWorkstation(options: LaunchOptions): Promise<WorkstationRun> {
  if (!options.mainEntry === !options.executablePath) throw new Error('Give exactly one of mainEntry and executablePath');
  const ownData = !options.userDataDir;
  const userDataDir = options.userDataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'xw-extension-e2e-'));
  const app = await _electron.launch({
    ...(options.executablePath ? { executablePath: options.executablePath } : {}),
    // E2E_TESTING (below) also makes ext.secureStorage use Chromium's stand-in keychain: a test
    // never touches the user's real keychain, and a test build is never stopped by a prompt.
    args: [...(options.mainEntry ? [path.resolve(options.mainEntry)] : []), `--user-data-dir=${userDataDir}`],
    env: {
      ...(process.env as Record<string, string>),
      E2E_TESTING: '1',
      NODE_ENV: 'production',
      ...(options.extensionsDir ? { XNAT_E2E_EXTENSIONS: path.resolve(options.extensionsDir) } : {}),
      ...options.env,
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return {
    app,
    page,
    userDataDir,
    async close() {
      await app.close().catch(() => {});
      if (ownData) fs.rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

const TEST_GLOBAL = EXTENSION_TEST_GLOBAL;

/** An extension in the running app, as its E2E reaches it. */
export function extension(page: Page, id: string) {
  return {
    /** Wait until its renderer part is running (activate() finished). */
    async waitUntilRunning(timeoutMs = 15_000): Promise<void> {
      await page.waitForFunction(
        ({ g, id }) => !!(window as unknown as Record<string, Record<string, unknown> | undefined>)[g]?.[id],
        { g: TEST_GLOBAL, id },
        { timeout: timeoutMs },
      );
    },
    /**
     * Run `fn(ext, arg)` in the app with the extension's own renderer context and return its
     * (structured-cloneable) result. `fn` is sent as source: it cannot close over test variables
     * — pass them as `arg`.
     */
    async evaluate<T, A = undefined>(fn: (ext: RendererExtensionContext, arg: A) => T | Promise<T>, arg?: A): Promise<T> {
      return page.evaluate(async ({ g, id, src, arg }) => {
        const ctx = (window as unknown as Record<string, Record<string, unknown> | undefined>)[g]?.[id];
        if (!ctx) throw new Error(`${id} is not running`);
        return (0, eval)(`(${src})`)(ctx, arg);
      }, { g: TEST_GLOBAL, id, src: fn.toString(), arg: arg as A });
    },
  };
}

/**
 * Enter the viewer without signing in (local files), so the sidebar, toolbar and Settings — the
 * extension slots — are on screen. Uses the core's own E2E hook.
 */
export async function openViewer(page: Page): Promise<void> {
  await page.waitForFunction(() => typeof (window as unknown as { __XNAT_E2E__?: { enterLocalViewer?: unknown } }).__XNAT_E2E__?.enterLocalViewer === 'function');
  await page.evaluate(() => (window as unknown as { __XNAT_E2E__: { enterLocalViewer: () => void } }).__XNAT_E2E__.enterLocalViewer());
  await page.getByTitle('Open settings').waitFor();
}
