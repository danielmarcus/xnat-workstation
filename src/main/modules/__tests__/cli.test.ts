/** Module authoring CLI (branch 9, M1): keygen → pack (signed) → verify, and its refusals. */
import { afterAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runCli } from '../cli';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xwmodule-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const MANIFEST = { id: 'org.example.t', name: 'T', version: '1.0.0', apiVersion: '1.0', runtime: 'wasm-worker', publisher: 'Example', license: 'MIT', description: 'd', entry: 'module.js', params: [], reads: { image: true, members: 'none' }, writes: { target: 'active', mode: 'add' }, scopes: ['slice'] };

describe('module CLI', () => {
  it('keygen, pack signed, verify: Verified with the key trusted, Community without; a bad package is refused (exit 1)', () => {
    const out: string[] = [];
    const log = (s: string) => out.push(s);
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      fs.mkdirSync('mod');
      fs.writeFileSync('mod/manifest.json', JSON.stringify(MANIFEST));
      fs.writeFileSync('mod/module.js', 'export function run() { return {}; }');
      expect(runCli(['keygen', 'k', '--publisher', 'Example Labs'], log)).toBe(0);
      expect(runCli(['pack', 'mod', 'a.xwmodule', '--key', 'k.private.pem', '--signer', 'Someone Else'], log)).toBe(0);
      expect(runCli(['verify', 'a.xwmodule', '--trust', 'k.public.json'], log)).toBe(0);
      expect(out.join('\n')).toMatch(/VERIFIED/);
      // Named by the trusted key's public.json, not by signature.json's unsigned signer (#103 item 5).
      expect(out.join('\n')).toMatch(/\(Example Labs\)/);
      expect(out.join('\n')).not.toMatch(/Someone Else/);
      out.length = 0;
      expect(runCli(['verify', 'a.xwmodule'], log)).toBe(0);
      expect(out.join('\n')).toMatch(/COMMUNITY/);
      expect(out.join('\n')).not.toMatch(/Someone Else/);
      fs.writeFileSync('mod/manifest.json', JSON.stringify({ ...MANIFEST, runtime: 'native-process' }));
      expect(runCli(['pack', 'mod', 'b.xwmodule'], log)).toBe(1);
      expect(out.join('\n')).toMatch(/"native-process"/);
      expect(fs.existsSync('b.xwmodule')).toBe(false);
    } finally {
      process.chdir(cwd);
    }
  });
});
