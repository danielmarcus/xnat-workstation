/**
 * Per-user storage for extensions (extension framework X5, R8): JSON values by key, kept per
 * extension under the user-data folder — one extension cannot reach another's — surviving a
 * restart, written atomically, with a size limit.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ExtensionStorageStore } from '../extensionStorage';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'xw-ext-storage-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('ext.storage', () => {
  it('keeps JSON values by key, and they survive a restart', async () => {
    const s = new ExtensionStorageStore(root).for('org.example.notes');
    expect(await s.get('missing')).toBeUndefined();
    await s.set('notes', [{ text: 'a' }]);
    await s.set('count', 3);
    expect(await s.get('notes')).toEqual([{ text: 'a' }]);
    expect((await s.keys()).sort()).toEqual(['count', 'notes']);
    await s.delete('count');
    const again = new ExtensionStorageStore(root).for('org.example.notes'); // a new app run
    expect(await again.get('notes')).toEqual([{ text: 'a' }]);
    expect(await again.keys()).toEqual(['notes']);
  });

  it('one extension cannot read another\'s', async () => {
    const store = new ExtensionStorageStore(root);
    await store.for('org.example.a').set('secret', 1);
    expect(await store.for('org.example.b').get('secret')).toBeUndefined();
    expect(await store.for('org.example.b').keys()).toEqual([]);
  });

  it('a stored value is a copy: changing it afterwards changes nothing stored', async () => {
    const s = new ExtensionStorageStore(root).for('org.example.notes');
    const v = { n: 1 };
    await s.set('v', v);
    v.n = 2;
    expect(await s.get('v')).toEqual({ n: 1 });
  });

  it('refuses what JSON cannot hold, an empty key, and more than the limit', async () => {
    const s = new ExtensionStorageStore(root, 1000).for('org.example.notes');
    await expect(s.set('', 1)).rejects.toThrow(/key/);
    await expect(s.set('f', () => 1)).rejects.toThrow(/JSON/);
    await expect(s.set('u', undefined)).rejects.toThrow(/JSON/);
    await expect(s.set('big', 'x'.repeat(2000))).rejects.toThrow(/limit/);
    expect(await s.keys()).toEqual([]);
  });

  it('a damaged file is set aside, not fatal', async () => {
    const store = new ExtensionStorageStore(root);
    await store.for('org.example.notes').set('a', 1);
    const file = fs.readdirSync(root, { recursive: true }).map(String).find((f) => f.endsWith('.json'))!;
    fs.writeFileSync(path.join(root, file), '{ not json');
    const s = new ExtensionStorageStore(root).for('org.example.notes');
    expect(await s.keys()).toEqual([]);
    await s.set('b', 2);
    expect(await s.get('b')).toBe(2);
  });

  it('an id that could escape the folder is refused', () => {
    expect(() => new ExtensionStorageStore(root).for('../evil')).toThrow(/id/);
  });
});
