/**
 * Secure storage for extensions (extension framework X6, design point 10): text values — a
 * licence, a token, activation state — encrypted with the operating system's keychain (Electron
 * safeStorage), one file per extension (`extension-data/<id>/secure.json`), so one extension
 * cannot read another's. Where the system offers no encryption (some Linux desktops) it is
 * refused rather than written in the clear. Main part only: secrets stay out of the renderer.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { ExtensionSecureStorage } from '../../shared/extensions/api';

/** What this needs of Electron's safeStorage. */
export interface SystemCipher {
  isAvailable(): boolean;
  encrypt(text: string): Buffer;
  decrypt(data: Buffer): string;
}

const ID = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export class ExtensionSecureStore {
  constructor(private readonly root: string, private readonly cipher: SystemCipher) {}

  for(extId: string): ExtensionSecureStorage {
    if (!ID.test(extId)) throw new Error(`Not an extension id: ${extId}`);
    const file = path.join(this.root, extId, 'secure.json');
    const cipher = this.cipher;
    const check = () => {
      if (!cipher.isAvailable()) throw new Error('Secure storage is not available: this system offers no encryption for it');
    };
    const read = (): Record<string, string> => {
      try {
        const v = JSON.parse(fs.readFileSync(file, 'utf8'));
        return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
      } catch {
        return {};
      }
    };
    const write = (data: Record<string, string>) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
      fs.renameSync(tmp, file);
    };
    return {
      async get(key) {
        check();
        const v = read()[key];
        return v === undefined ? undefined : cipher.decrypt(Buffer.from(v, 'base64'));
      },
      async set(key, value) {
        check();
        if (typeof key !== 'string' || !key) throw new Error('A key must be a non-empty string');
        if (typeof value !== 'string') throw new Error('Secure storage keeps text only');
        const data = read();
        data[key] = cipher.encrypt(value).toString('base64');
        write(data);
      },
      async delete(key) {
        check();
        const data = read();
        if (!(key in data)) return;
        delete data[key];
        write(data);
      },
      async keys() {
        check();
        return Object.keys(read());
      },
    };
  }
}
