/** Installed and bundled modules (branch 9, M2): install, trust, re-check at every load. */
import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ModuleStore } from '../moduleStore';
import { generateKeyPair, packFiles, signFiles } from '../modulePackage';

const roots: string[] = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'modstore-')); roots.push(d); return d; };
afterEach(() => { for (const d of roots.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

const manifest = (id: string, version = '1.0.0') => ({
  id, name: `Module ${id}`, version, apiVersion: '1.0', runtime: 'wasm-worker', publisher: 'Example', license: 'MIT', description: 'd',
  entry: 'module.js', params: [], reads: { image: true, members: 'none' }, writes: { target: 'active', mode: 'add' }, scopes: ['slice'],
});
const files = (id: string, version?: string) => new Map<string, Buffer>([
  ['manifest.json', Buffer.from(JSON.stringify(manifest(id, version)))],
  ['module.js', Buffer.from('export function run() { return {}; }')],
  ['lib/helper.js', Buffer.from('export const x = 1;')],
]);
const key = generateKeyPair();
const signed = (id: string, version?: string) => packFiles(signFiles(files(id, version), key.privateKeyPem, 'Example'));
const unsigned = (id: string, version?: string) => packFiles(files(id, version));

describe('ModuleStore', () => {
  it('a Verified module installs without confirmation, is listed, enabled and loadable', () => {
    const s = new ModuleStore(tmp());
    expect(s.trustKey({ keyId: key.keyId, publicKey: key.publicKey, name: 'Example' }).ok).toBe(true);
    const r = s.install(signed('org.example.a'));
    expect(r.ok && r.summary.tier).toBe('verified');
    const l = s.list();
    expect(l).toHaveLength(1);
    expect(l[0].status === 'ok' && l[0].summary).toMatchObject({ id: 'org.example.a', tier: 'verified', enabled: true, bundled: false });
    const loaded = s.load('org.example.a');
    expect(loaded.ok && [...loaded.files.keys()].sort()).toEqual(['lib/helper.js', 'manifest.json', 'module.js', 'signature.json']);
  });

  it('a Community module needs confirmation; with it, it installs as Community', () => {
    const s = new ModuleStore(tmp());
    const first = s.install(unsigned('org.example.b'));
    expect(first).toMatchObject({ ok: false, needsConfirmation: true });
    expect(s.list()).toHaveLength(0);
    const ok = s.install(unsigned('org.example.b'), { acceptCommunity: true });
    expect(ok.ok && ok.summary.tier).toBe('community');
  });

  it('with Allow community modules off, Community modules neither install nor load', () => {
    const s = new ModuleStore(tmp());
    s.install(unsigned('org.example.c'), { acceptCommunity: true });
    s.setAllowCommunity(false);
    expect(s.install(unsigned('org.example.d'), { acceptCommunity: true })).toMatchObject({ ok: false, reason: expect.stringMatching(/turned off/) });
    expect(s.load('org.example.c')).toMatchObject({ ok: false, reason: expect.stringMatching(/turned off/) });
  });

  it('a module changed on disk after install is refused — signed or not', () => {
    const s = new ModuleStore(tmp());
    s.trustKey({ keyId: key.keyId, publicKey: key.publicKey });
    s.install(signed('org.example.e'));
    s.install(unsigned('org.example.f'), { acceptCommunity: true });
    const root = (s as unknown as { root: string }).root;
    fs.writeFileSync(path.join(root, 'installed', 'org.example.e', 'files', 'module.js'), 'export function run() { evil(); }');
    fs.writeFileSync(path.join(root, 'installed', 'org.example.f', 'files', 'lib', 'helper.js'), 'export const x = 2;');
    const listed = Object.fromEntries(s.list().map((l) => [l.status === 'ok' ? l.summary.id : l.id, l]));
    expect(listed['org.example.e']).toMatchObject({ status: 'refused', reason: expect.stringMatching(/signature is invalid/) });
    expect(listed['org.example.f']).toMatchObject({ status: 'refused', reason: expect.stringMatching(/changed after it was installed/) });
    expect(s.load('org.example.f').ok).toBe(false);
  });

  it('installing a newer version replaces the old one; remove deletes the files', () => {
    const s = new ModuleStore(tmp());
    s.install(unsigned('org.example.g', '1.0.0'), { acceptCommunity: true });
    const pre = s.inspect(unsigned('org.example.g', '1.1.0'));
    expect(pre.ok && pre.installed).toBe('1.0.0');
    s.install(unsigned('org.example.g', '1.1.0'), { acceptCommunity: true });
    const l = s.list();
    expect(l).toHaveLength(1);
    expect(l[0].status === 'ok' && l[0].summary.version).toBe('1.1.0');
    expect(s.remove('org.example.g').ok).toBe(true);
    expect(s.list()).toHaveLength(0);
  });

  it('disabled modules are listed but do not load', () => {
    const s = new ModuleStore(tmp());
    s.install(unsigned('org.example.h'), { acceptCommunity: true });
    s.setEnabled('org.example.h', false);
    const l = s.list()[0];
    expect(l.status === 'ok' && l.summary.enabled).toBe(false);
    expect(s.load('org.example.h')).toMatchObject({ ok: false, reason: expect.stringMatching(/disabled/) });
  });

  it('bundled modules: listed as Bundled, loadable, cannot be removed or replaced', () => {
    const bundled = tmp();
    fs.writeFileSync(path.join(bundled, 'example.xwmodule'), unsigned('org.example.bundled'));
    const s = new ModuleStore(tmp(), bundled);
    const l = s.list();
    expect(l[0].status === 'ok' && l[0].summary).toMatchObject({ id: 'org.example.bundled', tier: 'bundled', bundled: true });
    expect(s.load('org.example.bundled').ok).toBe(true);
    expect(s.remove('org.example.bundled')).toMatchObject({ ok: false, reason: expect.stringMatching(/disabled, not removed/) });
    expect(s.install(unsigned('org.example.bundled'), { acceptCommunity: true })).toMatchObject({ ok: false, reason: expect.stringMatching(/built into this edition/) });
  });

  it('a trusted key must match its id; untrusting turns Verified back into Community', () => {
    const s = new ModuleStore(tmp());
    expect(s.trustKey({ keyId: '0123456789abcdef', publicKey: key.publicKey })).toMatchObject({ ok: false });
    s.trustKey({ keyId: key.keyId, publicKey: key.publicKey, name: 'Example' });
    s.install(signed('org.example.i'));
    s.untrustKey(key.keyId);
    const l = s.list()[0];
    expect(l.status === 'ok' && l.summary.tier).toBe('community');
  });

  it('a broken install folder is listed as refused — the others still list and load', () => {
    const s = new ModuleStore(tmp());
    s.install(unsigned('org.example.ok'), { acceptCommunity: true });
    s.install(unsigned('org.example.broken'), { acceptCommunity: true });
    const root = (s as unknown as { root: string }).root;
    fs.rmSync(path.join(root, 'installed', 'org.example.broken', 'files'), { recursive: true, force: true });
    const listed = Object.fromEntries(s.list().map((l) => [l.status === 'ok' ? l.summary.id : l.id, l.status]));
    expect(listed).toEqual({ 'org.example.ok': 'ok', 'org.example.broken': 'refused' });
    expect(s.load('org.example.ok').ok).toBe(true);
    expect(s.load('org.example.broken').ok).toBe(false);
  });

  it('with Allow community modules off, installed community modules are listed as refused (not runnable)', () => {
    const s = new ModuleStore(tmp());
    s.install(unsigned('org.example.comm'), { acceptCommunity: true });
    s.setAllowCommunity(false);
    expect(s.list()[0]).toMatchObject({ status: 'refused', reason: expect.stringMatching(/turned off/) });
  });

  it('a refused package is never installed, with its reason', () => {
    const s = new ModuleStore(tmp());
    const bad = new Map(files('org.example.j'));
    bad.set('manifest.json', Buffer.from(JSON.stringify({ ...manifest('org.example.j'), runtime: 'native-process' })));
    expect(s.install(packFiles(bad), { acceptCommunity: true })).toMatchObject({ ok: false, reason: expect.stringMatching(/"native-process"/) });
    expect(s.list()).toHaveLength(0);
  });
});
