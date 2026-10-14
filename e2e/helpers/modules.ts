/**
 * Module package fixtures for E2E (branch 9): built in the test with the app's own packaging and
 * signing code (src/main/modules), written to a temp folder, and handed to the app through its
 * stubbed native file dialog.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ElectronApplication } from '@playwright/test';
import { generateKeyPair, packFiles, signFiles, type ModuleKeyPair } from '../../src/main/modules/modulePackage';

export const FIXTURE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'xw-modules-'));

export const PUBLISHER: ModuleKeyPair = generateKeyPair();
export const PUBLISHER_KEY_FILE = path.join(FIXTURE_DIR, 'publisher.public.json');
fs.writeFileSync(PUBLISHER_KEY_FILE, JSON.stringify({ keyId: PUBLISHER.keyId, publicKey: PUBLISHER.publicKey, name: 'E2E Publisher' }));

export function manifest(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, name: `Module ${id.split('.').pop()}`, version: '1.0.0', apiVersion: '1.0', runtime: 'wasm-worker',
    publisher: 'E2E Publisher', license: 'MIT', description: 'An E2E fixture module', entry: 'module.js',
    params: [], reads: { image: true, members: 'none' }, writes: { target: 'active', mode: 'add' }, scopes: ['slice', 'volume'],
    ...extra,
  };
}

/** Write a package; returns its path. `sign` signs with the E2E publisher key. */
export function buildPackage(name: string, m: object, script: string, opts: { sign?: boolean; extraFiles?: Record<string, string> } = {}): string {
  let files = new Map<string, Buffer>([
    ['manifest.json', Buffer.from(JSON.stringify(m))],
    ['module.js', Buffer.from(script)],
    ...Object.entries(opts.extraFiles ?? {}).map(([k, v]) => [k, Buffer.from(v)] as [string, Buffer]),
  ]);
  if (opts.sign) files = signFiles(files, PUBLISHER.privateKeyPem, 'E2E Publisher');
  const file = path.join(FIXTURE_DIR, `${name}.xwmodule`);
  fs.writeFileSync(file, packFiles(files));
  return file;
}

/** The next native "open file" dialog returns this file. */
export async function stubOpen(app: ElectronApplication, filePath: string) {
  await app.evaluate(({ dialog }, p) => {
    (dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, filePath);
}

/** Forget every installed module and module setting (between tests: one app serves a spec). */
export async function resetModules(app: ElectronApplication) {
  await app.evaluate(({ app: a }) => {
    const fs = process.mainModule!.require('fs') as typeof import('fs');
    const path = process.mainModule!.require('path') as typeof import('path');
    fs.rmSync(path.join(a.getPath('userData'), 'modules'), { recursive: true, force: true });
  });
}

/** The installed copy of a module's file, on disk (to alter it behind the app's back). */
export async function installedFile(app: ElectronApplication, id: string, file: string): Promise<string> {
  return app.evaluate(({ app: a }, [i, f]) => {
    const path = process.mainModule!.require('path') as typeof import('path');
    return path.join(a.getPath('userData'), 'modules', 'installed', i, 'files', f);
  }, [id, file] as const);
}
