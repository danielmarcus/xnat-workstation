/**
 * #103 item 8: listing and loading do not re-read (re-hash, re-inflate) every module each time.
 * A listing re-reads only what changed on disk (size or mtime); a load inflates only the bundled
 * package it runs. `fs.readFileSync` is counted to see which files were read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';

vi.mock('fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('fs')>();
  const readFileSync = vi.fn(real.readFileSync);
  return { ...real, default: { ...real, readFileSync }, readFileSync };
});

import * as fs from 'fs';
import { ModuleStore } from '../moduleStore';
import { packFiles } from '../modulePackage';

const reads = vi.mocked(fs.readFileSync);
const roots: string[] = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'modcache-')); roots.push(d); return d; };
afterEach(() => { for (const d of roots.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
beforeEach(() => { reads.mockClear(); });

const manifest = (id: string) => ({
  id, name: `Module ${id}`, version: '1.0.0', apiVersion: '1.0', runtime: 'wasm-worker', publisher: 'Example', license: 'MIT', description: 'd',
  entry: 'module.js', params: [], reads: { image: true, members: 'none' }, writes: { target: 'active', mode: 'add' }, scopes: ['slice'],
});
const pkg = (id: string) => packFiles(new Map<string, Buffer>([
  ['manifest.json', Buffer.from(JSON.stringify(manifest(id)))],
  ['module.js', Buffer.from('export function run() { return {}; }')],
]));

/** The module files (installed files, bundled packages) read since the last clear. */
const moduleReads = (root: string, bundled: string) => reads.mock.calls
  .map(([p]) => String(p))
  .filter((p) => (p.startsWith(path.join(root, 'installed')) && !p.endsWith('install.json')) || p.startsWith(bundled));

describe('ModuleStore caching (#103 item 8)', () => {
  it('a second listing reads no module file; a changed file is read (and refused) again', () => {
    const root = tmp(), bundled = tmp();
    fs.writeFileSync(path.join(bundled, 'a.xwmodule'), pkg('org.example.bundled-a'));
    fs.writeFileSync(path.join(bundled, 'b.xwmodule'), pkg('org.example.bundled-b'));
    const s = new ModuleStore(root, bundled);
    expect(s.install(pkg('org.example.one'), { acceptCommunity: true }).ok).toBe(true);
    expect(s.install(pkg('org.example.two'), { acceptCommunity: true }).ok).toBe(true);
    expect(s.list().map((l) => l.status)).toEqual(['ok', 'ok', 'ok', 'ok']);
    reads.mockClear();
    expect(s.list().map((l) => l.status)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(moduleReads(root, bundled), 'nothing re-read').toEqual([]);

    fs.writeFileSync(path.join(root, 'installed', 'org.example.two', 'files', 'module.js'), 'export function run() { /* changed, longer */ }');
    reads.mockClear();
    const listed = Object.fromEntries(s.list().map((l) => [l.status === 'ok' ? l.summary.id : l.id, l.status]));
    expect(listed['org.example.two']).toBe('refused');
    expect(listed['org.example.one']).toBe('ok');
    expect(moduleReads(root, bundled).every((p) => p.includes('org.example.two')), 'only the changed module re-read').toBe(true);
  });

  it('loading a bundled module inflates that package only', () => {
    const root = tmp(), bundled = tmp();
    fs.writeFileSync(path.join(bundled, 'a.xwmodule'), pkg('org.example.bundled-a'));
    fs.writeFileSync(path.join(bundled, 'b.xwmodule'), pkg('org.example.bundled-b'));
    const s = new ModuleStore(root, bundled);
    s.list();
    reads.mockClear();
    expect(s.load('org.example.bundled-b').ok).toBe(true);
    expect(moduleReads(root, bundled)).toEqual([path.join(bundled, 'b.xwmodule')]);
    reads.mockClear();
    expect(s.remove('org.example.bundled-a').ok, 'bundled: cannot be removed').toBe(false);
    expect(s.install(pkg('org.example.three'), { acceptCommunity: true }).ok).toBe(true);
    expect(moduleReads(root, bundled), 'the bundled ids come from the cache').toEqual([]);
  });
});
