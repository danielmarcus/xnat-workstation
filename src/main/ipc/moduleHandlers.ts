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
import { ModuleStore } from '../modules/moduleStore';
import type { ModuleInspection } from '../../shared/modules/types';

/** Where an edition's bundled modules live: inside the app bundle, or the repo's in development. */
export function bundledModulesDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'modules') : path.join(app.getAppPath(), 'modules', 'bundled');
}

let store: ModuleStore | null = null;
export function moduleStore(): ModuleStore {
  if (!store) store = new ModuleStore(path.join(app.getPath('userData'), 'modules'), bundledModulesDir());
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
