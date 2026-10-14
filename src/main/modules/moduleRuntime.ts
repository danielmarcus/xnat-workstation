/**
 * The module sandbox (branch 9, M3 — docs/segworks-parity.md §12, design point 3).
 *
 * Each run gets a fresh, hidden, sandboxed renderer process of its own:
 *  - in the module sandbox's in-memory session (no cookies, no cache shared with the app,
 *    nothing persisted), where every request is cancelled except for this run's own files;
 *  - those files served by the `xnat-module://<run host>/` protocol from the (re-checked)
 *    package, with a Content-Security-Policy that allows only the module's own scripts and
 *    WebAssembly. Each run has a host — an origin — of its own, so runs share no storage;
 *  - no Node, no preload API beyond receiving its message port, no navigation, no popups, no
 *    permissions.
 * The module talks to the app page over a MessagePort pair (data in, masks out, transferred, not
 * copied through the main process). Stopping a run destroys its process — a module that ignores
 * Cancel cannot keep running.
 *
 * The session is ONE, shared by every run (#103): Electron never frees a partition, so a session
 * per run leaked it — and, through its protocol handler, the package's files (up to 256 MB) —
 * run after run. What a run serves lives in `runs`, and is forgotten (its origin's storage
 * cleared) when the run stops.
 */
import { app, BrowserWindow, ipcMain, MessageChannelMain, protocol, session as electronSession, type Session, type WebContents } from 'electron';
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
// WebRTC is a network channel neither the CSP nor the request filter covers (STUN / TURN
// over UDP): gone before the module loads. There are no frames to fetch it back from.
for (const k of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'RTCSessionDescription', 'RTCIceCandidate',
  'RTCRtpSender', 'RTCRtpReceiver', 'RTCRtpTransceiver', 'RTCDtlsTransport', 'RTCIceTransport', 'RTCSctpTransport', 'RTCCertificate']) {
  try { Object.defineProperty(window, k, { value: undefined, writable: false, configurable: false }); } catch {}
}
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
      try {
        send({ type: 'result', result: result ?? {} }, [...buffersOf(result)]);
      } catch {
        // A view into WebAssembly memory (what an Emscripten / Rust module returns) cannot be
        // transferred: send copies of the arrays instead.
        const copy = (v) => (ArrayBuffer.isView(v) ? v.slice() : v && typeof v === 'object' && !(v instanceof ArrayBuffer) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, copy(x)])) : v);
        const copied = copy(result ?? {});
        send({ type: 'result', result: copied }, [...buffersOf(copied)]);
      }
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
  /** The run's URL host: `xnat-module://<host>/` is its origin. */
  host: string;
  /** The package's files, re-checked when the run started — served from here, never from disk. */
  files: Map<string, Buffer>;
  entry: string;
  win: BrowserWindow;
  timer: NodeJS.Timeout;
  sender: WebContents;
  /** Removes the listeners this run put on the page that started it. */
  unlisten: () => void;
}
const runs = new Map<string, Run>();
/** The live runs by host — what the sandbox session serves. */
const byHost = new Map<string, Run>();

const PARTITION = 'xnat-module-sandbox';
let sandbox: Session | null = null;

/** The one in-memory session every run's process uses: set up once, serving only live runs. */
function sandboxSession(): Session {
  if (sandbox) return sandbox;
  const ses = electronSession.fromPartition(PARTITION, { cache: false });
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  // Nothing leaves the sandbox: a run's page may request only its own run's files.
  ses.webRequest.onBeforeRequest((details, cb) => {
    const run = runForUrl(details.url);
    const own = !!run && (details.webContentsId === undefined || (!run.win.isDestroyed() && run.win.webContents.id === details.webContentsId));
    cb({ cancel: !own });
  });
  ses.protocol.handle(MODULE_SCHEME, (req) => {
    const headers = { 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff' };
    const run = runForUrl(req.url);
    if (!run) return new Response('not found', { status: 404, headers });
    const rel = decodeURIComponent(new URL(req.url).pathname.replace(/^\//, ''));
    if (rel === '__host.html') return new Response(hostHtml(), { headers: { ...headers, 'Content-Type': 'text/html' } });
    if (rel === '__host.js') return new Response(hostJs(run.entry), { headers: { ...headers, 'Content-Type': 'text/javascript' } });
    const data = run.files.get(rel);
    if (!data || rel === 'signature.json') return new Response('not found', { status: 404, headers });
    return new Response(new Uint8Array(data), { headers: { ...headers, 'Content-Type': MIME[path.extname(rel)] ?? 'application/octet-stream' } });
  });
  sandbox = ses;
  return ses;
}

function runForUrl(url: string): Run | undefined {
  try {
    const u = new URL(url);
    return u.protocol === `${MODULE_SCHEME}:` ? byHost.get(u.host) : undefined;
  } catch {
    return undefined;
  }
}

/** The longest a run may take before its process is destroyed. */
const RUN_LIMIT_MS = 30 * 60 * 1000;

/**
 * End a run: destroy its process and tell the page — whatever ended it. `reason` is shown when
 * the page did not ask (a crash, the time limit, the app quitting); a page that is reloading or
 * gone is not told.
 */
export function stopModuleRun(runId: string, reason = 'stopped'): void {
  const r = runs.get(runId);
  if (!r) return;
  runs.delete(runId);
  byHost.delete(r.host);
  // Whatever the page stored (localStorage, IndexedDB, Cache Storage) goes with it.
  void sandbox?.clearStorageData({ origin: `${MODULE_SCHEME}://${r.host}` }).catch(() => {});
  clearTimeout(r.timer);
  r.unlisten();
  if (!r.win.isDestroyed()) r.win.destroy();
  if (!r.sender.isDestroyed()) r.sender.send(IPC.MODULES_RUN_ENDED, { runId, reason });
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
  // Unguessable, and a host of its own: no run can name (or share an origin with) another's.
  const host = `run-${runId}`;
  const prefix = `${MODULE_SCHEME}://${host}/`;
  const ses = sandboxSession();

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
  win.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  // Why the process went, if it did — a crash while the page loads also fails the load, and
  // the crash is the reason to report.
  let gone: string | undefined;
  win.webContents.on('render-process-gone', (_e, d) => {
    gone = `the module's process ended (${d.reason})`;
    stopModuleRun(runId, gone);
  });
  const timer = setTimeout(() => stopModuleRun(runId, 'it ran longer than the 30-minute limit'), RUN_LIMIT_MS);
  // The page that started the run going away — closed, or reloading (Cmd+R, a dev reload) —
  // ends it: nothing could receive its result.
  const onGone = () => stopModuleRun(runId, 'the page went away');
  const onNavigate = (details: { isMainFrame: boolean; isSameDocument: boolean }) => { if (details.isMainFrame && !details.isSameDocument) onGone(); };
  sender.once('destroyed', onGone);
  sender.on('did-start-navigation', onNavigate);
  const unlisten = () => { sender.removeListener('destroyed', onGone); sender.removeListener('did-start-navigation', onNavigate); };
  const run: Run = { host, files, entry: manifest.entry, win, timer, sender, unlisten };
  runs.set(runId, run);
  byHost.set(host, run);

  try {
    await win.loadURL(`${prefix}__host.html`);
  } catch (e) {
    stopModuleRun(runId, 'it could not start');
    if (gone) return { ok: false, reason: `The module stopped: ${gone}` };
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
  app.on('before-quit', () => { for (const id of [...runs.keys()]) stopModuleRun(id, 'the app is quitting'); });
}
