/**
 * The module sandbox (SegWorks parity branch 9, M3 — docs/segworks-parity.md §12, design point 3):
 * a module runs in its own hidden, sandboxed process, sees only what it is posted, and can reach
 * nothing else — not the network, not the app's DICOMweb proxy, not Node, not the app's API.
 * Modules are built in the test with the app's own packaging code and installed into the main
 * process's store; runs go through the real runtime (main process, sandbox window, ports).
 */
import * as dgram from 'dgram';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { test, expect } from '../../fixtures/electron-app';
import type { Page } from '@playwright/test';
import { buildPackage, HANDLERS_JS, installDirect, manifest, resetModules, windowCount } from '../../helpers/modules';

type Run = { ok: boolean; result?: Record<string, unknown>; error?: string; logs: Array<{ level: string; text: string }>; progress: number };
type Win = { __XNAT_E2E__: { runModule: (id: string, input: Record<string, unknown>, cancelAfterMs?: number) => Promise<Run> } };

const run = (page: Page, id: string, input: Record<string, unknown> = {}, cancelAfterMs?: number) =>
  page.evaluate(([i, inp, c]) => (window as unknown as Win).__XNAT_E2E__.runModule(i, inp as Record<string, unknown>, c as number | undefined), [id, input, cancelAfterMs] as const);

test.beforeEach(async ({ electronApp, page }) => {
  await resetModules(electronApp);
  await page.reload();
  await page.waitForFunction(() => !!(window as unknown as { __XNAT_E2E__?: unknown }).__XNAT_E2E__);
});

test('a module receives its input, reports progress and logs, returns its result — and its process is gone afterwards', async ({ electronApp, page }) => {
  const file = buildPackage('double', manifest('org.e2e.double'), `
    export async function run(input, api) {
      api.log('got', input.values.length, 'values');
      const out = new Float32Array(input.values.length);
      for (let i = 0; i < out.length; i++) { out[i] = input.values[i] * 2; api.progress((i + 1) / out.length); }
      const data = await (await fetch('./data.json')).json(); // its own files are reachable
      return { out, note: data.note };
    }`, { extraFiles: { 'data.json': JSON.stringify({ note: 'from the package' }) } });
  expect((await installDirect(electronApp, file)).ok).toBe(true);
  const windows = await windowCount(electronApp);
  const r = await run(page, 'org.e2e.double', { values: [1, 2, 3] });
  expect(r.error).toBeUndefined();
  expect(r.ok).toBe(true);
  expect(Object.values(r.result!.out as Record<string, number>)).toEqual([2, 4, 6]);
  expect(r.result!.note).toBe('from the package');
  expect(r.progress).toBe(3);
  expect(r.logs.map((l) => l.text)).toContain('got 3 values');
  await expect.poll(() => windowCount(electronApp)).toBe(windows);
});

test("a hostile module reaches nothing: network, the app's proxy, Node, the app's API, cookies, other origins", async ({ electronApp, page }) => {
  const file = buildPackage('hostile', manifest('org.e2e.hostile'), `
    const tried = {};
    const attempt = async (name, f) => { try { const v = await f(); tried[name] = 'REACHED: ' + String(v).slice(0, 80); } catch (e) { tried[name] = 'blocked'; } };
    export async function run(input, api) {
      await attempt('fetch reachable server', () => fetch(input.target + '/fetch').then((r) => r.status));
      await attempt('fetch internet', () => fetch('https://example.com/').then((r) => r.status));
      await attempt('fetch proxy', () => fetch('http://localhost:8081/').then((r) => r.status));
      await attempt('fetch file', () => fetch('file:///etc/hosts').then((r) => r.status));
      await attempt('xhr', () => new Promise((res, rej) => { const x = new XMLHttpRequest(); x.onload = () => res(x.status); x.onerror = () => rej(new Error('x')); x.open('GET', input.target + '/xhr'); x.send(); }));
      await attempt('websocket', () => new Promise((res, rej) => { const w = new WebSocket('ws://localhost:8081/'); w.onopen = () => res('open'); w.onerror = () => rej(new Error('w')); }));
      await attempt('webrtc', async () => {
        const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:127.0.0.1:' + input.udpPort }] });
        pc.createDataChannel('x');
        await pc.setLocalDescription(await pc.createOffer());
        await new Promise((r) => setTimeout(r, 1500));
        return 'created';
      });
      await attempt('import remote', () => import(input.target + '/x.js'));
      await attempt('eval', () => eval('1 + 1'));
      await attempt('Function', () => new Function('return 2')());
      tried.require = typeof globalThis.require;
      tried.process = typeof globalThis.process;
      tried.electronAPI = typeof globalThis.electronAPI;
      tried.cookie = document.cookie === '' ? 'empty' : 'REACHED: ' + document.cookie;
      await attempt('window.open', () => { const w = window.open('https://example.com/'); if (!w) throw new Error('denied'); return 'opened'; });
      return { tried };
    }`);
  expect((await installDirect(electronApp, file)).ok).toBe(true);
  // A server the test KNOWS is reachable, counting every request it gets: blocked must mean blocked,
  // not "nothing was listening".
  const hits: string[] = [];
  const server = http.createServer((req, res) => { hits.push(req.url ?? ''); res.setHeader('Access-Control-Allow-Origin', '*'); res.end('export default 1;'); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const target = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  expect((await fetch(`${target}/probe`)).status, 'the server is reachable from the test').toBe(200);
  // …and a UDP port for STUN, counting every datagram (WebRTC is a channel neither the CSP nor
  // the request filter covers).
  const udp = dgram.createSocket('udp4');
  const datagrams: number[] = [];
  udp.on('message', (m) => datagrams.push(m.length));
  await new Promise<void>((r) => udp.bind(0, '127.0.0.1', () => r()));
  const udpPort = udp.address().port;
  hits.length = 0;
  const r = await run(page, 'org.e2e.hostile', { target, udpPort });
  server.close();
  udp.close();
  expect(r.error).toBeUndefined();
  expect(hits, 'the sandbox never reached the server').toEqual([]);
  expect(datagrams, 'no STUN datagram left the sandbox').toEqual([]);
  expect(r.result!.tried).toEqual({
    'fetch reachable server': 'blocked',
    'fetch internet': 'blocked', 'fetch proxy': 'blocked', 'fetch file': 'blocked', xhr: 'blocked', websocket: 'blocked', webrtc: 'blocked',
    'import remote': 'blocked', eval: 'blocked', Function: 'blocked',
    require: 'undefined', process: 'undefined', electronAPI: 'undefined', cookie: 'empty', 'window.open': 'blocked',
  });
});

test('Cancel ends the run at once — a result returned afterwards is ignored; a module that ignores Cancel is destroyed', async ({ electronApp, page }) => {
  const polite = buildPackage('polite', manifest('org.e2e.polite'), `
    export async function run(input, api) {
      while (!api.cancelled()) await new Promise((r) => setTimeout(r, 20));
      api.log('stopped cleanly');
      return { stopped: true };
    }`);
  const stubborn = buildPackage('stubborn', manifest('org.e2e.stubborn'), `
    export function run() { for (;;) {} }`);
  await installDirect(electronApp, polite);
  await installDirect(electronApp, stubborn);
  const windows = await windowCount(electronApp);
  const a = await run(page, 'org.e2e.polite', {}, 300);
  expect(a.ok, 'cancelled — though the module went on to return a result').toBe(false);
  expect(a.error).toMatch(/ModuleRunCancelled/);
  await expect.poll(() => windowCount(electronApp)).toBe(windows);
  const t0 = Date.now();
  const b = await run(page, 'org.e2e.stubborn', {}, 300);
  expect(b.ok).toBe(false);
  expect(b.error).toMatch(/ModuleRunCancelled/);
  expect(Date.now() - t0).toBeLessThan(10_000);
  await expect.poll(() => windowCount(electronApp)).toBe(windows); // the runaway process is gone
});

test('a synchronous module cancelled before it returns: its result is ignored', async ({ electronApp, page }) => {
  // It cannot see api.cancelled() before it returns — its result arrives after Cancel.
  await installDirect(electronApp, buildPackage('sync', manifest('org.e2e.sync'), `
    export function run() { const t = Date.now(); while (Date.now() - t < 800) {} return { done: true }; }`));
  const r = await run(page, 'org.e2e.sync', {}, 200);
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/ModuleRunCancelled/);
});

test('a module whose process dies ends the run with the reason — it does not hang', async ({ electronApp, page }) => {
  await installDirect(electronApp, buildPackage('crash', manifest('org.e2e.crash'), `
    export async function run(input, api) { api.log('about to crash'); await new Promise(() => {}); }`));
  const pending = run(page, 'org.e2e.crash');
  // Kill the module's (hidden) process, as an out-of-memory would.
  await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isVisible() && w.webContents.getURL().startsWith('xnat-module://')).length)).toBe(1);
  await electronApp.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().startsWith('xnat-module://')) w.webContents.forcefullyCrashRenderer();
  });
  const r = await pending;
  expect(r.ok).toBe(false);
  expect(r.error).toMatch(/The module stopped: the module's process ended/);
});

test('a module that throws, or exports no run(), fails with the reason', async ({ electronApp, page }) => {
  await installDirect(electronApp, buildPackage('throws', manifest('org.e2e.throws'), `export function run() { throw new Error('bad input'); }`));
  await installDirect(electronApp, buildPackage('norun', manifest('org.e2e.norun'), `export const nothing = 1;`));
  expect((await run(page, 'org.e2e.throws')).error).toMatch(/bad input/);
  expect((await run(page, 'org.e2e.norun')).error).toMatch(/exports no run\(\) function/);
});

test('a disabled or refused module does not start', async ({ electronApp, page }) => {
  await installDirect(electronApp, buildPackage('off', manifest('org.e2e.off'), `export function run() { return {}; }`));
  await electronApp.evaluate((_e, h) => {
    const m = process.mainModule!.require(h) as { moduleStore: () => { setEnabled: (id: string, on: boolean) => void } };
    m.moduleStore().setEnabled('org.e2e.off', false);
  }, HANDLERS_JS);
  expect((await run(page, 'org.e2e.off')).error).toMatch(/disabled/);
  expect((await run(page, 'org.e2e.nowhere')).error).toMatch(/installation record is missing/);
});
