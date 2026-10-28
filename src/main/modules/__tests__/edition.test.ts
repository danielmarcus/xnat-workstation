/** Edition configurations (branch 9, M6): what a valid one needs, and what is refused. */
import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { validateEdition } from '../edition';
import { generateKeyPair } from '../modulePackage';

const ok = { id: 'my-edition', productName: 'My Product', appName: 'MyProduct', appId: 'com.example.my-product', artifactPrefix: 'My-Product', modules: ['modules/a'], trustedKeys: [] };

describe('validateEdition', () => {
  it('accepts the repository\'s own configurations', () => {
    for (const f of ['edition.config.json', 'e2e/fixtures/edition/test-edition.json']) {
      expect(validateEdition(JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../..', f), 'utf8'))).ok, f).toBe(true);
    }
  });

  it('reports every missing or malformed field', () => {
    const r = validateEdition({ id: 'Bad Id', appId: 'nodots', modules: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) for (const k of ['id', 'productName', 'appName', 'appId', 'artifactPrefix', 'modules', 'trustedKeys']) expect(r.errors.join('\n')).toMatch(new RegExp(`^${k}:`, 'm'));
  });

  it('a trusted key must be a real key whose id matches it', () => {
    const k = generateKeyPair();
    expect(validateEdition({ ...ok, trustedKeys: [{ keyId: k.keyId, publicKey: k.publicKey, name: 'P' }] }).ok).toBe(true);
    expect(validateEdition({ ...ok, trustedKeys: [{ keyId: '0123456789abcdef', publicKey: k.publicKey }] }).ok).toBe(false);
    expect(validateEdition({ ...ok, trustedKeys: [{ keyId: k.keyId, publicKey: 'not a key' }] }).ok).toBe(false);
  });

  it('publish, when present, is an object', () => {
    expect(validateEdition({ ...ok, publish: { provider: 'generic', url: 'https://example.org' } }).ok).toBe(true);
    expect(validateEdition({ ...ok, publish: 'github' }).ok).toBe(false);
  });
});
