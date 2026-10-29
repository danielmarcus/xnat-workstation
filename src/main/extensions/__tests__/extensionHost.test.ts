/**
 * The main-process extension host (extension framework X1): which extensions load, which are
 * refused and why, the main part's lifecycle, the user's Enabled switch, and the files the
 * renderer may fetch.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRequire } from 'module';
import { ExtensionHost } from '../extensionHost';
import { EXTENSION_API_VERSION } from '../../../shared/extensions/manifest';

let root: string;
let dir: string;
let settingsFile: string;
const req = createRequire(import.meta.url);
/** require() without the cache, so each test's main.js is read afresh. */
const load = (file: string) => { delete req.cache[req.resolve(file)]; return req(file); };

function ext(folder: string, manifest: Record<string, unknown> | string | null, files: Record<string, string> = {}) {
  const d = path.join(dir, folder);
  fs.mkdirSync(d, { recursive: true });
  if (manifest !== null) fs.writeFileSync(path.join(d, 'extension.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(d, f), body);
}
const manifest = (id: string, extra: Record<string, unknown> = {}) => ({
  id, name: id.split('.').pop(), version: '1.0.0', apiVersion: EXTENSION_API_VERSION, publisher: 'Example Labs', renderer: 'renderer.js', ...extra,
});
/** A main part that records its lifecycle in a file beside it. */
const recordingMain = `const fs = require('fs'); const p = require('path').join(__dirname, 'calls.log');
module.exports = { activate(ext) { fs.appendFileSync(p, 'activate ' + ext.id + ' ' + ext.apiVersion + '\\n'); }, deactivate() { fs.appendFileSync(p, 'deactivate\\n'); } };`;
const calls = (folder: string) => { try { return fs.readFileSync(path.join(dir, folder, 'calls.log'), 'utf8').trim().split('\n'); } catch { return []; } };
const host = (timeoutMs = 2000) => new ExtensionHost({ dir, settingsFile, load, timeoutMs });
const byKey = (h: ExtensionHost) => Object.fromEntries(h.list().map((s) => [s.key, s]));

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'xw-ext-'));
  dir = path.join(root, 'extensions');
  fs.mkdirSync(dir);
  settingsFile = path.join(root, 'extensions.json');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('ExtensionHost — loading', () => {
  it('starts a valid extension: its main part is activated with the host API', async () => {
    ext('notes', manifest('org.example.notes', { main: 'main.js' }), { 'renderer.js': '', 'main.js': recordingMain });
    ext('plain', manifest('org.example.plain'), { 'renderer.js': '' });
    const h = host();
    await h.start();
    const l = byKey(h);
    expect(l['org.example.notes']).toMatchObject({ state: 'active', name: 'notes', version: '1.0.0', publisher: 'Example Labs', rendererUrl: 'xnat-extension://org.example.notes/renderer.js' });
    expect(l['org.example.plain']).toMatchObject({ state: 'active' });
    expect(calls('notes')).toEqual([`activate org.example.notes ${EXTENSION_API_VERSION}`]);
  });

  it('refuses, with the reason, every extension it cannot load — and still loads the rest', async () => {
    ext('no-manifest', null, { 'renderer.js': '' });
    ext('bad-json', '{ not json', { 'renderer.js': '' });
    ext('invalid', { ...manifest('org.example.invalid'), version: 'one' }, { 'renderer.js': '' });
    ext('missing-file', manifest('org.example.missing', { main: 'main.js' }), { 'renderer.js': '' });
    ext('newer-api', manifest('org.example.newer', { apiVersion: '9.0' }), { 'renderer.js': '' });
    ext('first', manifest('org.example.twice'), { 'renderer.js': '' });
    ext('second', manifest('org.example.twice'), { 'renderer.js': '' });
    ext('good', manifest('org.example.good'), { 'renderer.js': '' });
    const h = host();
    await h.start();
    const l = byKey(h);
    expect(l['no-manifest']).toMatchObject({ state: 'refused', id: null, reason: expect.stringMatching(/no extension\.json/i) });
    expect(l['bad-json']).toMatchObject({ state: 'refused', reason: expect.stringMatching(/not valid JSON/) });
    expect(l['org.example.invalid']).toMatchObject({ state: 'refused', name: 'invalid', reason: expect.stringMatching(/version/) }); // its own name, though invalid
    expect(l['org.example.missing']).toMatchObject({ state: 'refused', reason: expect.stringMatching(/main\.js is missing/) });
    expect(l['org.example.newer']).toMatchObject({ state: 'refused', reason: expect.stringMatching(/Needs extension API 9\.0; this app provides/) });
    expect(h.list().filter((s) => s.id === 'org.example.twice').map((s) => s.state).sort()).toEqual(['active', 'refused']);
    expect(l.second).toMatchObject({ state: 'refused', id: 'org.example.twice' }); // keyed by folder: keys stay unique
    expect(h.list().find((s) => s.id === 'org.example.twice' && s.state === 'refused')?.reason).toMatch(/already loaded/);
    expect(l['org.example.good']).toMatchObject({ state: 'active' });
    expect(h.list().filter((s) => s.state === 'refused').every((s) => !s.rendererUrl)).toBe(true);
  });

  it('a main part that throws, lacks activate() or never finishes is inactive with the reason', async () => {
    ext('throws', manifest('org.example.throws', { main: 'main.js' }), { 'renderer.js': '', 'main.js': 'module.exports = { activate() { throw new Error("boom"); } };' });
    ext('rejects', manifest('org.example.rejects', { main: 'main.js' }), { 'renderer.js': '', 'main.js': 'module.exports = { async activate() { throw new Error("no licence"); } };' });
    ext('no-activate', manifest('org.example.noactivate', { main: 'main.js' }), { 'renderer.js': '', 'main.js': 'module.exports = {};' });
    ext('hangs', manifest('org.example.hangs', { main: 'main.js' }), { 'renderer.js': '', 'main.js': 'module.exports = { activate() { return new Promise(() => {}); } };' });
    ext('bad-syntax', manifest('org.example.syntax', { main: 'main.js' }), { 'renderer.js': '', 'main.js': 'module.exports = {' });
    const h = host(100);
    await h.start();
    const l = byKey(h);
    expect(l['org.example.throws']).toMatchObject({ state: 'inactive', reason: 'Failed to start: boom' });
    expect(l['org.example.rejects']).toMatchObject({ state: 'inactive', reason: 'Failed to start: no licence' });
    expect(l['org.example.noactivate']).toMatchObject({ state: 'inactive', reason: expect.stringMatching(/exports no activate\(\)/) });
    expect(l['org.example.hangs']).toMatchObject({ state: 'inactive', reason: expect.stringMatching(/did not finish starting/) });
    expect(l['org.example.syntax']).toMatchObject({ state: 'inactive', reason: expect.stringMatching(/^Failed to start: /) });
    expect(Object.values(l).every((s) => !s.rendererUrl)).toBe(true);
  });

  it('a missing extensions folder is simply no extensions', async () => {
    const h = new ExtensionHost({ dir: path.join(root, 'none'), settingsFile, load });
    await h.start();
    expect(h.list()).toEqual([]);
  });
});

describe('ExtensionHost — the Enabled switch', () => {
  it('disabling deactivates the main part and is remembered; enabling activates it again', async () => {
    ext('notes', manifest('org.example.notes', { main: 'main.js' }), { 'renderer.js': '', 'main.js': recordingMain });
    const h = host();
    await h.start();
    await h.setEnabled('org.example.notes', false);
    expect(byKey(h)['org.example.notes']).toMatchObject({ state: 'disabled' });
    expect(byKey(h)['org.example.notes'].rendererUrl).toBeUndefined();
    expect(calls('notes')).toEqual([expect.stringMatching(/^activate/), 'deactivate']);

    const next = host();
    await next.start();
    expect(byKey(next)['org.example.notes']).toMatchObject({ state: 'disabled' });
    expect(calls('notes')).toHaveLength(2); // not activated while disabled

    await next.setEnabled('org.example.notes', true);
    expect(byKey(next)['org.example.notes']).toMatchObject({ state: 'active' });
    expect(calls('notes').at(-1)).toMatch(/^activate/);
  });

  it('a refused extension cannot be enabled or disabled', async () => {
    ext('newer', manifest('org.example.newer', { apiVersion: '9.0' }), { 'renderer.js': '' });
    const h = host();
    await h.start();
    await h.setEnabled('org.example.newer', false);
    expect(byKey(h)['org.example.newer']).toMatchObject({ state: 'refused' });
  });

  it('a renderer part that fails makes the extension inactive and stops its main part', async () => {
    ext('notes', manifest('org.example.notes', { main: 'main.js' }), { 'renderer.js': '', 'main.js': recordingMain });
    const h = host();
    await h.start();
    await h.rendererFailed('org.example.notes', 'TypeError: x is undefined');
    expect(byKey(h)['org.example.notes']).toMatchObject({ state: 'inactive', reason: 'Failed to start: TypeError: x is undefined' });
    expect(calls('notes').at(-1)).toBe('deactivate');
  });

  it('stopAll deactivates every active main part', async () => {
    ext('notes', manifest('org.example.notes', { main: 'main.js' }), { 'renderer.js': '', 'main.js': recordingMain });
    const h = host();
    await h.start();
    expect(h.hasRunningMainParts()).toBe(true);
    await h.stopAll();
    expect(calls('notes').at(-1)).toBe('deactivate');
    expect(h.hasRunningMainParts()).toBe(false);
  });
});

describe('ExtensionHost — files the renderer may fetch', () => {
  it('serves an active extension\'s own files only', async () => {
    ext('notes', manifest('org.example.notes'), { 'renderer.js': 'export {}', 'style.css': '' });
    ext('newer', manifest('org.example.newer', { apiVersion: '9.0' }), { 'renderer.js': '' });
    fs.writeFileSync(path.join(dir, 'secret.txt'), 'x');
    const h = host();
    await h.start();
    expect(h.fileFor('xnat-extension://org.example.notes/renderer.js')).toBe(path.join(dir, 'notes', 'renderer.js'));
    expect(h.fileFor('xnat-extension://org.example.notes/style.css')).toBe(path.join(dir, 'notes', 'style.css'));
    expect(h.fileFor('xnat-extension://org.example.notes/extension.json')).toBe(path.join(dir, 'notes', 'extension.json'));
    expect(h.fileFor('xnat-extension://org.example.notes/../secret.txt')).toBeNull();
    expect(h.fileFor('xnat-extension://org.example.notes/%2e%2e/secret.txt')).toBeNull();
    expect(h.fileFor('xnat-extension://org.example.notes/nothing.js')).toBeNull();
    expect(h.fileFor('xnat-extension://org.example.newer/renderer.js')).toBeNull();
    expect(h.fileFor('xnat-extension://org.example.other/renderer.js')).toBeNull();
    await h.setEnabled('org.example.notes', false);
    expect(h.fileFor('xnat-extension://org.example.notes/renderer.js')).toBeNull();
  });
});

describe('ExtensionHost — the main part\'s context (X3)', () => {
  const channelMain = `let ext;
module.exports = {
  activate(c) { ext = c; c.channel.handle(async (m) => { if (m === 'boom') throw new Error('handler boom'); if (m === 'push') { c.channel.post({ pushed: true }); return 'pushed'; } return { echo: m, user: await c.xnat.user() }; }); },
};`;
  it('gets ext.xnat; answers the renderer part through the channel and can post to it', async () => {
    ext('notes', manifest('org.example.notes', { main: 'main.js' }), { 'renderer.js': '', 'main.js': channelMain });
    const posted: Array<[string, unknown]> = [];
    const xnat = { user: async () => ({ serverUrl: 'https://xnat.example.org', username: 'dmarcus' }) } as never;
    const h = new ExtensionHost({ dir, settingsFile, load, xnat, post: (id, m) => posted.push([id, m]) });
    await h.start();
    expect(await h.channelRequest('org.example.notes', 'hi')).toEqual({ echo: 'hi', user: { serverUrl: 'https://xnat.example.org', username: 'dmarcus' } });
    expect(await h.channelRequest('org.example.notes', 'push')).toBe('pushed');
    expect(posted).toEqual([['org.example.notes', { pushed: true }]]);
    await expect(h.channelRequest('org.example.notes', 'boom')).rejects.toThrow('handler boom');
  });

  it('a request to an extension that is not running, or has no handler, is refused', async () => {
    ext('notes', manifest('org.example.notes', { main: 'main.js' }), { 'renderer.js': '', 'main.js': channelMain });
    ext('plain', manifest('org.example.plain'), { 'renderer.js': '' });
    const h = new ExtensionHost({ dir, settingsFile, load });
    await h.start();
    await expect(h.channelRequest('org.example.plain', 'hi')).rejects.toThrow(/no main part/);
    await expect(h.channelRequest('org.example.none', 'hi')).rejects.toThrow(/not running/);
    await h.setEnabled('org.example.notes', false);
    await expect(h.channelRequest('org.example.notes', 'hi')).rejects.toThrow(/not running/);
    expect(h.isRunning('org.example.notes')).toBe(false);
    expect(h.isRunning('org.example.plain')).toBe(true);
  });
});
