/**
 * The edition the app runs as (branch 9, M6): where its bundled modules are read from, and the
 * publisher keys it trusts — from build/edition/ (development) or the app's resources.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { generateKeyPair, packFiles, signFiles } from '../modules/modulePackage';

const state = vi.hoisted(() => ({ appPath: '', userData: '' }));
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => state.appPath, getPath: () => state.userData },
  ipcMain: { handle: vi.fn() },
  dialog: {},
  BrowserWindow: {},
}));

const dirs: string[] = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'modhandlers-')); dirs.push(d); return d; };
const key = generateKeyPair();
const signed = (id: string) => packFiles(signFiles(new Map([
  ['manifest.json', Buffer.from(JSON.stringify({
    id, name: id, version: '1.0.0', apiVersion: '1.0', runtime: 'wasm-worker', publisher: 'P', license: 'MIT', description: 'd',
    entry: 'module.js', params: [], reads: { image: true, members: 'none' }, writes: { target: 'active', mode: 'add' }, scopes: ['slice'],
  }))],
  ['module.js', Buffer.from('export function run() { return {}; }')],
]), key.privateKeyPem, 'P'));

function writeEdition(trustedKeys: object[]) {
  const dir = path.join(state.appPath, 'build', 'edition');
  fs.mkdirSync(path.join(dir, 'modules'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'edition.json'), JSON.stringify({
    id: 'test', productName: 'Test', appName: 'Test', appId: 'org.example.test', artifactPrefix: 'Test', modules: [], trustedKeys,
  }));
  return dir;
}

beforeEach(() => {
  state.appPath = tmp();
  state.userData = tmp();
  vi.resetModules();
  delete process.env.E2E_TESTING;
  delete process.env.XNAT_E2E_BUNDLED_MODULES;
});
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('the edition the app runs as', () => {
  it('bundled modules come from the edition; the E2E override is honoured only under E2E_TESTING', async () => {
    const dir = writeEdition([]);
    process.env.XNAT_E2E_BUNDLED_MODULES = '/somewhere/else';
    let h = await import('./moduleHandlers');
    expect(h.bundledModulesDir()).toBe(path.join(dir, 'modules'));
    vi.resetModules();
    process.env.E2E_TESTING = '1';
    h = await import('./moduleHandlers');
    expect(h.bundledModulesDir()).toBe('/somewhere/else');
  });

  it('a module signed by a key the edition trusts installs as Verified', async () => {
    writeEdition([{ keyId: key.keyId, publicKey: key.publicKey, name: 'Edition publisher' }]);
    const h = await import('./moduleHandlers');
    expect(h.currentEdition()?.productName).toBe('Test');
    const r = h.moduleStore().install(signed('org.example.trusted'));
    expect(r.ok && r.summary.tier).toBe('verified');
  });

  it('without an edition the app trusts no built-in keys, and names nothing', async () => {
    const h = await import('./moduleHandlers');
    expect(h.currentEdition()).toBeNull();
    expect(h.moduleStore().install(signed('org.example.untrusted'))).toMatchObject({ ok: false, needsConfirmation: true });
  });
});
