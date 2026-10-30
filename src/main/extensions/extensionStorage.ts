/**
 * Per-user storage for extensions (extension framework X5, R8 — docs/extension-framework.md):
 * JSON values by key, one file per extension under the user-data folder
 * (`extension-data/<id>/storage.json`), so one extension cannot reach another's. Writes are
 * atomic (a temporary file, then a rename) and the whole store is capped. Not for secrets: the
 * keychain-backed secure store is X6's.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { ExtensionStorage } from '../../shared/extensions/api';

/** The default cap on one extension's stored JSON. */
export const STORAGE_LIMIT_BYTES = 5 * 2 ** 20;

const ID = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export class ExtensionStorageStore {
  constructor(private readonly root: string, private readonly limitBytes = STORAGE_LIMIT_BYTES) {}

  for(extId: string): ExtensionStorage {
    if (!ID.test(extId)) throw new Error(`Not an extension id: ${extId}`);
    const file = path.join(this.root, extId, 'storage.json');
    const limit = this.limitBytes;

    const read = (): Record<string, unknown> => {
      let text: string;
      try { text = fs.readFileSync(file, 'utf8'); } catch { return {}; }
      try {
        const v = JSON.parse(text);
        if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
      } catch { /* damaged — set aside below */ }
      console.warn(`[extensionStorage] ${extId}: storage.json was damaged; set aside as storage.damaged.json`);
      try { fs.renameSync(file, path.join(path.dirname(file), 'storage.damaged.json')); } catch { /* best effort */ }
      return {};
    };

    const write = (data: Record<string, unknown>) => {
      const text = JSON.stringify(data);
      if (Buffer.byteLength(text) > limit) throw new Error(`Storage limit reached (${Math.round(limit / 1024)} KB for an extension)`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, text);
      fs.renameSync(tmp, file);
    };

    return {
      async get<T>(key: string) {
        const v = read()[key];
        return (v === undefined ? undefined : structuredClone(v)) as T | undefined;
      },
      async set(key: string, value: unknown) {
        if (typeof key !== 'string' || !key) throw new Error('A storage key must be a non-empty string');
        let json: string | undefined;
        try { json = JSON.stringify(value); } catch { json = undefined; }
        if (json === undefined || typeof value === 'function') throw new Error(`The value for "${key}" cannot be stored as JSON`);
        const data = read();
        data[key] = JSON.parse(json);
        write(data);
      },
      async delete(key: string) {
        const data = read();
        if (!(key in data)) return;
        delete data[key];
        write(data);
      },
      async keys() {
        return Object.keys(read());
      },
    };
  }
}
