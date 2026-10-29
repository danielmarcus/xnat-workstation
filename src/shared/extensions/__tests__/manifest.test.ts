/** The extension manifest (extension framework X1 — docs/extension-framework.md): what loads, what is refused and why. */
import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { EXTENSION_API_VERSION, apiCompatible, validateExtensionManifest } from '../manifest';

const valid = {
  id: 'org.example.session-notes',
  name: 'Session notes',
  version: '1.2.0',
  apiVersion: EXTENSION_API_VERSION,
  publisher: 'Example Labs',
  renderer: 'renderer.js',
  main: 'main.js',
};

describe('validateExtensionManifest', () => {
  it('accepts the repository\'s example extension, built for this API', () => {
    const file = path.resolve(__dirname, '../../../../extensions/examples/session-notes/extension.json');
    const r = validateExtensionManifest(JSON.parse(fs.readFileSync(file, 'utf8')));
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(apiCompatible(r.manifest.apiVersion, EXTENSION_API_VERSION)).toBe(true);
  });

  it('accepts a valid manifest, with or without a main part', () => {
    expect(validateExtensionManifest(valid)).toMatchObject({ ok: true, manifest: { id: valid.id } });
    const { main: _main, ...rendererOnly } = valid;
    expect(validateExtensionManifest({ ...rendererOnly, description: 'Notes on the open session' })).toMatchObject({ ok: true });
  });

  it.each([
    ['not an object', null, /manifest/],
    ['an id that is not reverse-DNS', { ...valid, id: 'notes' }, /id/],
    ['an upper-case id', { ...valid, id: 'Org.Example.Notes' }, /id/],
    ['a missing name', { ...valid, name: ' ' }, /name/],
    ['a version that is not semver', { ...valid, version: '1.2' }, /version/],
    ['an apiVersion that is not major.minor', { ...valid, apiVersion: 'latest' }, /apiVersion/],
    ['a missing publisher', { ...valid, publisher: undefined }, /publisher/],
    ['a missing renderer entry', { ...valid, renderer: undefined }, /renderer/],
    ['an entry outside the package', { ...valid, renderer: '../renderer.js' }, /renderer/],
    ['an absolute entry', { ...valid, main: '/tmp/main.js' }, /main/],
    ['a renderer entry that is not .js', { ...valid, renderer: 'renderer.ts' }, /renderer/],
    ['an unknown field (a typo, or a newer API)', { ...valid, contribute: {} }, /unknown field "contribute"/],
  ])('refuses %s, naming the field', (_label, raw, reason) => {
    const r = validateExtensionManifest(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('; ')).toMatch(reason);
  });
});

describe('apiCompatible', () => {
  it('from 1.0 on: the same major, and a host minor at least the one built for', () => {
    expect(apiCompatible('1.2', '1.4')).toBe(true);
    expect(apiCompatible('1.4', '1.4')).toBe(true);
    expect(apiCompatible('1.5', '1.4')).toBe(false);
    expect(apiCompatible('2.0', '1.4')).toBe(false);
    expect(apiCompatible('1.0', '2.0')).toBe(false);
  });

  it('before 1.0 every minor may break, so it must match exactly', () => {
    expect(apiCompatible('0.1', '0.1')).toBe(true);
    expect(apiCompatible('0.1', '0.2')).toBe(false);
    expect(apiCompatible('0.2', '0.1')).toBe(false);
  });

  it('this host is compatible with itself', () => {
    expect(apiCompatible(EXTENSION_API_VERSION, EXTENSION_API_VERSION)).toBe(true);
  });
});
