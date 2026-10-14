/**
 * The module sandbox (branch 9, M3 — docs/segworks-parity.md §12, design point 3).
 *
 * Each run gets a fresh, hidden, sandboxed renderer process of its own:
 *  - its own in-memory session (no cookies, no cache shared with the app, nothing persisted),
 *    where every request is cancelled except for this module's own files;
 *  - those files served by the `xnat-module://<id>/` protocol from the (re-checked) package, with
 *    a Content-Security-Policy that allows only the module's own scripts and WebAssembly;
 *  - no Node, no preload API beyond receiving its message port, no navigation, no popups, no
 *    permissions.
 * The module talks to the app page over a MessagePort pair (data in, masks out, transferred, not
 * copied through the main process). Stopping a run destroys its process — a module that ignores
 * Cancel cannot keep running.
 */
import { app, BrowserWindow, ipcMain, MessageChannelMain, protocol, session as electronSession, type WebContents } from 'electron';
import { IPC } from '../../shared/ipcChannels';
import * as crypto from 'crypto';
import * as path from 'path';
import { moduleStore } from '../ipc/moduleHandlers';

export const MODULE_SCHEME = 'xnat-module';

/** Must run before the app is ready. */
export function registerModuleScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: MODULE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
}

const CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "connect-src 'self'",
  "worker-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const MIME: Record<string, string> = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json',
  '.html': 'text/html', '.txt': 'text/plain', '.bin': 'application/octet-stream',
};

/** The page that loads the module and relays messages — host code, generated here, never from the package. */
function hostHtml(): string {
  return '<!doctype html><meta charset="utf-8"><title>module</title><script type="module" src="./__host.js"></script>';
}

function hostJs(entry: string): string {
  return `
const send = (m, t) => port && port.postMessage(m, t || []);
let port = null;
let cancelled = false;
const text = (a) => a.map((x) => (typeof x === 'string' ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })())).join(' ');
for (const [name, level] of [['log', 'info'], ['info', 'info'], ['warn', 'warn'], ['error', 'error']]) {
  console[name] = (...a) => send({ type: 'log', level, text: text(a) });
}
window.addEventListener('error', (e) => send({ type: 'log', level: 'error', text: String(e.message) }));
window.addEventListener('unhandledrejection', (e) => send({ type: 'log', level: 'error', text: String(e.reason && e.reason.stack || e.reason) }));
const buffersOf = (v, out = new Set()) => {
  if (v && typeof v === 'object') {
    if (ArrayBuffer.isView(v)) out.add(v.buffer);
    else if (v instanceof ArrayBuffer) out.add(v);
    else for (const k of Object.keys(v)) buffersOf(v[k], out);
  }
  return out;
};
window.addEventListener('message', (e) => {
  if (e.data !== 'xw-port' || !e.ports[0] || port) return;
  port = e.ports[0];
  port.onmessage = async (m) => {
    const msg = m.data;
    if (msg.type === 'cancel') { cancelled = true; return; }
    if (msg.type !== 'run') return;
    const api = {
      progress: (fraction, note) => send({ type: 'progress', fraction: Number(fraction) || 0, text: note ? String(note) : undefined }),
      cancelled: () => cancelled,
      log: (...a) => send({ type: 'log', level: 'info', text: text(a) }),
      warn: (...a) => send({ type: 'log', level: 'warn', text: text(a) }),
      error: (...a) => send({ type: 'log', level: 'error', text: text(a) }),
    };
    try {
      const mod = await import(${JSON.stringify(`./${entry}`)});
      if (typeof mod.run !== 'function') throw new Error('The module exports no run() function');
      const result = await mod.run(msg.input, api);
      send({ type: 'result', result: result ?? {} }, [...buffersOf(result)]);
    } catch (err) {
      send({ type: 'failed', text: String(err && err.stack || err) });
    }
  };
  port.start();
  send({ type: 'ready' });
});
`;
}

interface Run {
  win: BrowserWindow;
  timer: NodeJS.Timeout;
}
const runs = new Map<string, Run>();

/** The longest a run may take before its process is destroyed. */
const RUN_LIMIT_MS = 30 * 60 * 1000;

export function stopModuleRun(runId: string): void {
  const r = runs.get(runId);
  if (!r) return;
  runs.delete(runId);
  clearTimeout(r.timer);
  if (!r.win.isDestroyed()) r.win.destroy();
}

/**
 * Start a sandboxed run of a module for the page `sender`. Its message port arrives on the page
 * as the `modules:run-port` message, tagged with the run id.
 */
export async function startModuleRun(sender: WebContents, id: string): Promise<{ ok: true; runId: string } | { ok: false; reason: string }> {
  const loaded = moduleStore().load(id);
  if (!loaded.ok) return { ok: false, reason: loaded.reason };
  const { files, manifest } = loaded;
  const runId = crypto.randomUUID();
  const host = id;
  const prefix = `${MODULE_SCHEME}://${host}/`;
  const ses = electronSession.fromPartition(`xnat-module-run-${runId}`, { cache: false });
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  // Nothing leaves the sandbox: only this module's own files may be requested.
  ses.webRequest.onBeforeRequest((details, cb) => cb({ cancel: !details.url.startsWith(prefix) }));
  ses.protocol.handle(MODULE_SCHEME, (req) => {
    const url = new URL(req.url);
    if (url.host !== host) return new Response('not found', { status: 404 });
    const rel = decodeURIComponent(url.pathname.replace(/^\//, ''));
    const headers = { 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff' };
    if (rel === '__host.html') return new Response(hostHtml(), { headers: { ...headers, 'Content-Type': 'text/html' } });
    if (rel === '__host.js') return new Response(hostJs(manifest.entry), { headers: { ...headers, 'Content-Type': 'text/javascript' } });
    const data = files.get(rel);
    if (!data || rel === 'signature.json') return new Response('not found', { status: 404, headers });
    return new Response(new Uint8Array(data), { headers: { ...headers, 'Content-Type': MIME[path.extname(rel)] ?? 'application/octet-stream' } });
  });

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      session: ses,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      spellcheck: false,
      preload: path.join(__dirname, 'modulePreload.js'),
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('render-process-gone', () => stopModuleRun(runId));
  const timer = setTimeout(() => stopModuleRun(runId), RUN_LIMIT_MS);
  runs.set(runId, { win, timer });
  sender.once('destroyed', () => stopModuleRun(runId));

  try {
    await win.loadURL(`${prefix}__host.html`);
  } catch (e) {
    stopModuleRun(runId);
    return { ok: false, reason: `The module could not start: ${e instanceof Error ? e.message : String(e)}` };
  }
  const { port1, port2 } = new MessageChannelMain();
  win.webContents.postMessage('xw-port', null, [port1]);
  sender.postMessage(IPC.MODULES_RUN_PORT, { runId }, [port2]);
  return { ok: true, runId };
}

export function registerModuleRunHandlers(): void {
  ipcMain.handle(IPC.MODULES_RUN_START, (e, id: string) => startModuleRun(e.sender, id));
  ipcMain.handle(IPC.MODULES_RUN_STOP, (_e, runId: string) => { stopModuleRun(runId); return { ok: true }; });
  app.on('before-quit', () => { for (const id of [...runs.keys()]) stopModuleRun(id); });
}
