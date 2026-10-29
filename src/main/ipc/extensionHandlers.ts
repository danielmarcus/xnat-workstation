/**
 * Extensions in the main process (extension framework X1): where the edition's extensions are,
 * the `xnat-extension://` scheme their renderer parts load from, the IPC Settings › Extensions
 * uses, and stopping main parts at quit.
 */
import { app, ipcMain, protocol, type CustomScheme } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { IPC } from '../../shared/ipcChannels';
import { EXTENSION_SCHEME, ExtensionHost } from '../extensions/extensionHost';

/** The scheme's privileges; main/index.ts registers every privileged scheme in ONE call. */
export const EXTENSION_SCHEME_PRIVILEGES: CustomScheme = { scheme: EXTENSION_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } };

/**
 * The edition's extensions: inside the app archive (`app.asar/extensions/`, so the archive's
 * integrity check covers them — design point 5), or in development the repo's
 * `build/edition/extensions/` (`npm run build:edition`). E2E may point at a folder of its own —
 * only under E2E_TESTING in an unpackaged app, so the environment can never make an ordinary run
 * treat a folder as part of the signed app.
 */
export function extensionsDir(): string {
  const e2e = process.env.E2E_TESTING === '1' && !app.isPackaged ? process.env.XNAT_E2E_EXTENSIONS : undefined;
  return e2e || path.join(app.getAppPath(), ...(app.isPackaged ? ['extensions'] : ['build', 'edition', 'extensions']));
}

const MIME: Record<string, string> = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.cjs': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm',
};

let host: ExtensionHost | null = null;
let ready: Promise<void> = Promise.resolve();

export function registerExtensionHandlers(): void {
  host = new ExtensionHost({ dir: extensionsDir(), settingsFile: path.join(app.getPath('userData'), 'extensions.json') });
  const h = host;
  ready = h.start().catch((err) => console.error('[extensions] start failed:', err));

  // The renderer (file:// in a build, the dev server in development, under COEP) imports
  // extension modules cross-origin, so they are served with CORS and CORP headers.
  protocol.handle(EXTENSION_SCHEME, async (req) => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin', 'X-Content-Type-Options': 'nosniff' };
    await ready;
    const file = h.fileFor(req.url);
    if (!file) return new Response('not found', { status: 404, headers });
    const data = await fs.promises.readFile(file);
    return new Response(new Uint8Array(data), { headers: { ...headers, 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' } });
  });

  ipcMain.handle(IPC.EXTENSIONS_LIST, async () => { await ready; return h.list(); });
  ipcMain.handle(IPC.EXTENSIONS_SET_ENABLED, async (_e, id: string, enabled: boolean) => {
    await ready;
    if (typeof id === 'string') await h.setEnabled(id, !!enabled);
    return h.list();
  });
  ipcMain.handle(IPC.EXTENSIONS_RENDERER_FAILED, async (_e, id: string, reason: string) => {
    await ready;
    if (typeof id === 'string') await h.rendererFailed(id, String(reason).slice(0, 500));
    return h.list();
  });

  // Main parts stop before the app quits (each has the host's time limit to do so). With none
  // running the quit is untouched — an edition without extensions quits exactly as before.
  let stopped = false;
  app.on('before-quit', (e) => {
    if (stopped || !h.hasRunningMainParts()) return;
    e.preventDefault();
    void h.stopAll().finally(() => { stopped = true; app.quit(); });
  });
}
