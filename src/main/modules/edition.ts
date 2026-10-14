/**
 * Editions (branch 9, M6 — docs/editions.md). An edition is chosen at build time by an edition
 * configuration: its product name and app id, the modules it bundles, the publisher keys it
 * trusts. `npm run build:edition` reads it (the open-source default, `edition.config.json`, or
 * another repository's, named by XNAT_EDITION) and writes `build/edition/`: `edition.json`
 * (what the app and electron-builder read) and `modules/*.xwmodule`; electron-builder ships
 * them as `resources/edition.json` and `resources/modules/`.
 */
import * as fs from 'fs';
import * as path from 'path';
import { keyIdOf } from './modulePackage';
import type { TrustedKey } from '../../shared/modules/types';

export interface EditionConfig {
  id: string;
  productName: string;
  /**
   * The app's short name: the macOS menu, and the user-data folder (so each edition keeps its
   * own settings and installed modules). The open-source edition's is "XNAT" — never change an
   * edition's appName once shipped, or its users' data is left behind.
   */
  appName: string;
  appId: string;
  /** Installer and archive names start with this. */
  artifactPrefix: string;
  /** Module directories (packed) or .xwmodule files (copied), relative to the configuration file. */
  modules: string[];
  /** Publisher keys every copy of this edition trusts (their public.json contents). */
  trustedKeys: TrustedKey[];
  /** electron-builder's `publish` for this edition (default: none, except the open-source one's). */
  publish?: Record<string, unknown> | Array<Record<string, unknown>>;
}

/** What a built edition records for the app and for electron-builder. */
export type EditionInfo = Omit<EditionConfig, 'modules'> & { modules: string[] };

export function validateEdition(raw: unknown): { ok: true; edition: EditionConfig } | { ok: false; errors: string[] } {
  const e = (raw ?? {}) as Record<string, unknown>;
  const errors: string[] = [];
  const str = (k: string, re?: RegExp) => {
    if (typeof e[k] !== 'string' || !(e[k] as string).trim() || (re && !re.test(e[k] as string))) errors.push(`${k}: required${re ? ` (${re})` : ''}`);
  };
  str('id', /^[a-z0-9][a-z0-9-]*$/);
  str('productName');
  str('appName', /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/);
  str('appId', /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/);
  str('artifactPrefix', /^[A-Za-z0-9._-]+$/);
  if (!Array.isArray(e.modules) || !e.modules.every((m) => typeof m === 'string' && m)) errors.push('modules: a list of paths');
  const keys = Array.isArray(e.trustedKeys) ? e.trustedKeys : null;
  if (!keys) errors.push('trustedKeys: a list (may be empty)');
  else keys.forEach((k, i) => {
    const key = k as Partial<TrustedKey>;
    let id = '';
    try { id = typeof key.publicKey === 'string' ? keyIdOf(Buffer.from(key.publicKey, 'base64')) : ''; } catch { /* reported below */ }
    if (!id || id !== key.keyId) errors.push(`trustedKeys[${i}]: keyId must match publicKey (a module:keygen public.json)`);
  });
  if (e.publish !== undefined && (typeof e.publish !== 'object' || e.publish === null)) errors.push('publish: an electron-builder publish configuration, when present');
  return errors.length ? { ok: false, errors } : { ok: true, edition: e as unknown as EditionConfig };
}

export function readEditionConfig(file: string): EditionConfig {
  const r = validateEdition(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (!r.ok) throw new Error(`${file}:\n  ${r.errors.join('\n  ')}`);
  return r.edition;
}

/** The built edition's record (resources/edition.json), or null — the app then trusts no built-in keys. */
export function readEditionInfo(file: string): EditionInfo | null {
  try {
    const info = JSON.parse(fs.readFileSync(file, 'utf8')) as EditionInfo;
    const r = validateEdition(info);
    if (!r.ok) { console.warn(`[edition] ${file} is not valid: ${r.errors.join('; ')}`); return null; }
    return info;
  } catch {
    return null;
  }
}

export const editionPaths = (dir: string) => ({ info: path.join(dir, 'edition.json'), modules: path.join(dir, 'modules') });
