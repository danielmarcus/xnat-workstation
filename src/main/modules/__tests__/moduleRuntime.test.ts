/**
 * #103 item 1: runs share ONE sandbox session; what a run serves (its package's files) is
 * forgotten when the run stops. Electron never frees a partition, so a session per run leaked
 * the session and — through its protocol handler — the package's files, run after run.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  type Handler = (req: { url: string }) => Response;
  type Filter = (d: { url: string; webContentsId?: number }, cb: (r: { cancel: boolean }) => void) => void;
  const sessions: Array<{ partition: string; handler: Handler | null; filter: Filter | null; cleared: string[] }> = [];
  const windows: Array<{ url: string; webContents: { id: number } }> = [];
  const crash = { onLoad: false };
  let nextId = 100;
  const fromPartition = (partition: string) => {
    const s = { partition, handler: null as Handler | null, filter: null as Filter | null, cleared: [] as string[] };
    sessions.push(s);
    return {
      setPermissionRequestHandler: () => {},
      setPermissionCheckHandler: () => {},
      webRequest: { onBeforeRequest: (f: Filter) => { s.filter = f; } },
      protocol: { handle: (_scheme: string, f: Handler) => { s.handler = f; } },
      clearStorageData: async (o: { origin?: string }) => { s.cleared.push(o.origin ?? '*'); },
    };
  };
  class BrowserWindow {
    url = '';
    destroyed = false;
    listeners = new Map<string, (...a: unknown[]) => void>();
    webContents = {
      id: nextId++,
      setWindowOpenHandler: () => {},
      setWebRTCIPHandlingPolicy: () => {},
      on: (ev: string, f: (...a: unknown[]) => void) => { this.listeners.set(ev, f); },
      postMessage: () => {},
    };
    constructor() { windows.push(this); }
    async loadURL(u: string) {
      this.url = u;
      if (crash.onLoad) {
        // The process dies while the page loads: Electron reports the crash, then the load fails.
        this.listeners.get('render-process-gone')?.({}, { reason: 'killed' });
        throw new Error("ERR_FAILED (-2) loading '" + u + "'");
      }
    }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
  }
  return { sessions, windows, fromPartition, BrowserWindow, crash };
});

vi.mock('electron', () => ({
  app: { on: () => {} },
  ipcMain: { handle: () => {} },
  protocol: { registerSchemesAsPrivileged: () => {} },
  session: { fromPartition: h.fromPartition },
  BrowserWindow: h.BrowserWindow,
  MessageChannelMain: class { port1 = {}; port2 = {}; },
}));

const FILES: Record<string, Map<string, Buffer>> = {
  'org.example.a': new Map([['module.js', Buffer.from('export const a = 1;')], ['manifest.json', Buffer.from('{}')]]),
  'org.example.b': new Map([['module.js', Buffer.from('export const b = 2;')], ['manifest.json', Buffer.from('{}')]]),
};
vi.mock('../../ipc/moduleHandlers', () => ({
  moduleStore: () => ({
    load: (id: string) => ({ ok: true, manifest: { entry: 'module.js' }, files: FILES[id], tier: 'community' }),
  }),
}));

import { startModuleRun, stopModuleRun } from '../moduleRuntime';

const sender = () => ({
  once: () => {}, on: () => {}, removeListener: () => {}, isDestroyed: () => false, send: () => {}, postMessage: () => {},
}) as never;

const serve = async (url: string) => {
  const s = h.sessions[h.sessions.length - 1];
  const r = s.handler!({ url });
  return { status: r.status, text: await r.text() };
};
const allowed = (url: string, webContentsId?: number) => {
  let cancel = true;
  h.sessions[h.sessions.length - 1].filter!({ url, webContentsId }, (r) => { cancel = r.cancel; });
  return !cancel;
};

describe('module runs (#103 item 1)', () => {
  beforeEach(() => { h.windows.length = 0; });

  it('share one session; a stopped run serves nothing and its storage is cleared', async () => {
    const a = await startModuleRun(sender(), 'org.example.a');
    const b = await startModuleRun(sender(), 'org.example.b');
    if (!a.ok || !b.ok) throw new Error('runs did not start');
    expect(h.sessions, 'one session for every run').toHaveLength(1);
    const [winA, winB] = h.windows;
    const baseA = winA.url.replace(/__host\.html$/, ''), baseB = winB.url.replace(/__host\.html$/, '');
    expect(baseA).not.toBe(baseB); // each run has a host (an origin) of its own

    expect(await serve(`${baseA}module.js`)).toEqual({ status: 200, text: 'export const a = 1;' });
    expect(await serve(`${baseB}module.js`)).toEqual({ status: 200, text: 'export const b = 2;' });
    expect(allowed(`${baseA}module.js`, winA.webContents.id)).toBe(true);
    expect(allowed(`${baseB}module.js`, winA.webContents.id), 'not another run\'s files').toBe(false);
    expect(allowed('https://example.com/', winA.webContents.id)).toBe(false);

    stopModuleRun(a.runId);
    expect((await serve(`${baseA}module.js`)).status, 'forgotten on stop').toBe(404);
    expect(allowed(`${baseA}module.js`, winA.webContents.id)).toBe(false);
    expect(h.sessions[0].cleared).toContain(baseA.replace(/\/$/, ''));
    expect(await serve(`${baseB}module.js`)).toEqual({ status: 200, text: 'export const b = 2;' });

    stopModuleRun(b.runId);
    const c = await startModuleRun(sender(), 'org.example.a');
    expect(c.ok).toBe(true);
    expect(h.sessions, 'still one session').toHaveLength(1);
    if (c.ok) stopModuleRun(c.runId);
  });
});

describe('a run whose process dies while it loads', () => {
  it('reports that the process ended, not that the load failed', async () => {
    h.crash.onLoad = true;
    try {
      const r = await startModuleRun(sender(), 'org.example.a');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/^The module stopped: the module's process ended \(killed\)$/);
    } finally {
      h.crash.onLoad = false;
    }
  });
});
