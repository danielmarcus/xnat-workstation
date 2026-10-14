/**
 * IPC for modules (branch 9, M2): list, pick-and-inspect, install, remove, enable, trust.
 *
 * A package the user picks (file dialog, or dropped on Settings › Modules) is read and checked
 * here, then held under a short-lived token: the renderer installs it BY TOKEN, never by a path,
 * so renderer code cannot point the installer at an arbitrary file.
 */
import { app, dialog, ipcMain, BrowserWindow } from 'electron';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { IPC } from '../../shared/ipcChannels';
import { BUILTIN_TRUSTED_KEYS, ModuleStore } from '../modules/moduleStore';
import { editionPaths, readEditionInfo, type EditionInfo } from '../modules/edition';
import type { ModuleInspection } from '../../shared/modules/types';

/**
 * The built edition (docs/editions.md): inside the app bundle (resources/edition.json and
 * resources/modules/), or in development the repo's `build/edition/` (`npm run build:edition`).
 * E2E points the bundled modules at a folder of its own — only under E2E_TESTING, so the
 * environment can never make an ordinary run treat a folder as part of the signed app.
 */
function editionDir(): string {
  return app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'build', 'edition');
}

let edition: EditionInfo | null | undefined;
/** The edition this app is (null when none was built — development without `build:edition`). */
export function currentEdition(): EditionInfo | null {
  if (edition === undefined) edition = readEditionInfo(editionPaths(editionDir()).info);
  return edition;
}

export function bundledModulesDir(): string {
  const e2e = process.env.E2E_TESTING === '1' && !app.isPackaged ? process.env.XNAT_E2E_BUNDLED_MODULES : undefined;
  return e2e || editionPaths(editionDir()).modules;
}

let store: ModuleStore | null = null;
export function moduleStore(): ModuleStore {
  if (!store) {
    store = new ModuleStore(path.join(app.getPath('userData'), 'modules'), bundledModulesDir(), [...BUILTIN_TRUSTED_KEYS, ...(currentEdition()?.trustedKeys ?? [])]);
  }
  return store;
}

const MAX_PACKAGE_BYTES = 300 * 2 ** 20;
const pending = new Map<string, { buf: Buffer; at: number }>();
const TOKEN_TTL_MS = 10 * 60 * 1000;

function holdForInstall(buf: Buffer): ModuleInspection {
  const r = moduleStore().inspect(buf);
  if (!r.ok) return { ok: false, reason: r.reason };
  const now = Date.now();
  for (const [t, v] of pending) if (now - v.at > TOKEN_TTL_MS) pending.delete(t);
  const token = crypto.randomUUID();
  pending.set(token, { buf, at: now });
  return { ok: true, token, summary: r.summary, installed: r.installed, allowCommunity: moduleStore().settings().allowCommunity };
}

function readPicked(file: string): Buffer | string {
  const stat = fs.statSync(file);
  if (!stat.isFile()) return 'Not a file';
  if (stat.size > MAX_PACKAGE_BYTES) return 'The package is too large';
  return fs.readFileSync(file);
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function registerModuleHandlers(): void {
  ipcMain.handle(IPC.MODULES_LIST, () => ({ modules: moduleStore().list(), settings: moduleStore().settings() }));

  ipcMain.handle(IPC.MODULES_PICK, async (e): Promise<ModuleInspection> => {
    try {
      const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
      const opts = { properties: ['openFile' as const], filters: [{ name: 'Workstation module', extensions: ['xwmodule'] }] };
      const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true, reason: 'canceled' };
      const buf = readPicked(result.filePaths[0]);
      return typeof buf === 'string' ? { ok: false, reason: buf } : holdForInstall(buf);
    } catch (err) {
      return { ok: false, reason: errMsg(err) };
    }
  });

  ipcMain.handle(IPC.MODULES_INSPECT_DROPPED, (_e, file: string): ModuleInspection => {
    try {
      if (typeof file !== 'string' || !file.endsWith('.xwmodule')) return { ok: false, reason: 'Not a Workstation module (.xwmodule)' };
      const buf = readPicked(file);
      return typeof buf === 'string' ? { ok: false, reason: buf } : holdForInstall(buf);
    } catch (err) {
      return { ok: false, reason: errMsg(err) };
    }
  });

  ipcMain.handle(IPC.MODULES_INSTALL, (_e, token: string, acceptCommunity: boolean) => {
    const held = pending.get(token);
    if (!held) return { ok: false, reason: 'Pick the module again (the selection expired)' };
    const r = moduleStore().install(held.buf, { acceptCommunity: !!acceptCommunity });
    if (r.ok || !('needsConfirmation' in r && r.needsConfirmation)) pending.delete(token);
    return r;
  });

  ipcMain.handle(IPC.MODULES_REMOVE, (_e, id: string) => moduleStore().remove(id));
  ipcMain.handle(IPC.MODULES_SET_ENABLED, (_e, id: string, enabled: boolean) => { moduleStore().setEnabled(id, !!enabled); return { ok: true }; });
  ipcMain.handle(IPC.MODULES_SET_ALLOW_COMMUNITY, (_e, allow: boolean) => { moduleStore().setAllowCommunity(!!allow); return { ok: true }; });
  ipcMain.handle(IPC.MODULES_UNTRUST_KEY, (_e, keyId: string) => { moduleStore().untrustKey(keyId); return { ok: true }; });

  /** Download a module's log (#282): the user picks where; plain text. */
  ipcMain.handle(IPC.MODULES_SAVE_LOG, async (e, text: string, suggested: string) => {
    try {
      const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
      const opts = { defaultPath: `${String(suggested).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'module'}.log.txt`, filters: [{ name: 'Text', extensions: ['txt'] }] };
      const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      fs.writeFileSync(result.filePath, String(text));
      return { ok: true, path: result.filePath };
    } catch (err) {
      return { ok: false, reason: errMsg(err) };
    }
  });

  ipcMain.handle(IPC.MODULES_TRUST_KEY_PICK, async (e) => {
    try {
      const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
      const opts = { properties: ['openFile' as const], filters: [{ name: 'Publisher key', extensions: ['json'] }] };
      const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
      const json = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
      return moduleStore().trustKey(json);
    } catch (err) {
      return { ok: false, reason: `Not a publisher key file: ${errMsg(err)}` };
    }
  });
}
