/**
 * Secure storage for extensions (extension framework X6, design point 10): text values encrypted
 * with the operating system's keychain (Electron safeStorage — faked here), per extension, never
 * written in the clear; refused where the system offers no encryption.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ExtensionSecureStore, type SystemCipher } from '../extensionSecureStorage';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'xw-ext-secure-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

/** A stand-in for safeStorage: reversible, and never the plain text. */
const cipher: SystemCipher = {
  isAvailable: () => true,
  encrypt: (text) => Buffer.from(`enc:${Buffer.from(text).toString('base64').split('').reverse().join('')}`),
  decrypt: (data) => Buffer.from(data.toString().slice(4).split('').reverse().join(''), 'base64').toString(),
};
const allFiles = () => fs.readdirSync(root, { recursive: true }).map(String).filter((f) => fs.statSync(path.join(root, f)).isFile());

describe('ext.secureStorage', () => {
  it('keeps text encrypted, per extension, across restarts', async () => {
    const s = new ExtensionSecureStore(root, cipher).for('org.example.notes');
    await s.set('licence', 'TOP-SECRET-LICENCE');
    expect(await s.get('licence')).toBe('TOP-SECRET-LICENCE');
    expect(await new ExtensionSecureStore(root, cipher).for('org.example.notes').get('licence')).toBe('TOP-SECRET-LICENCE');
    expect(await new ExtensionSecureStore(root, cipher).for('org.example.other').get('licence')).toBeUndefined();
    for (const f of allFiles()) expect(fs.readFileSync(path.join(root, f), 'utf8')).not.toContain('TOP-SECRET');
    expect(await s.keys()).toEqual(['licence']);
    await s.delete('licence');
    expect(await s.get('licence')).toBeUndefined();
  });

  it('only text is kept', async () => {
    const s = new ExtensionSecureStore(root, cipher).for('org.example.notes');
    await expect(s.set('n', 42 as unknown as string)).rejects.toThrow(/text/);
  });

  it('is refused where the system offers no encryption, rather than writing in the clear', async () => {
    const s = new ExtensionSecureStore(root, { ...cipher, isAvailable: () => false }).for('org.example.notes');
    await expect(s.set('licence', 'x')).rejects.toThrow(/not available/);
    await expect(s.get('licence')).rejects.toThrow(/not available/);
    expect(allFiles()).toEqual([]);
  });
});
