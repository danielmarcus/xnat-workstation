/**
 * Installed and bundled modules (branch 9, M2 — docs/segworks-parity.md §12).
 *
 *   <root>/settings.json                 trusted publisher keys, Allow community, Enabled per id
 *   <root>/installed/<id>/files/…        the package's files, as unpacked
 *   <root>/installed/<id>/install.json   version, digest, tier and signer recorded at install
 *   <bundledDir>/*.xwmodule              an edition's modules, inside the signed app bundle
 *
 * Installed modules live in the user's data folder, never in the app bundle (so installing one
 * never touches the app's code signature). Every listing and every load re-checks the files: the
 * M1 checks (manifest, entry, compatibility, signature, trust), and the digest recorded at
 * install — so a module changed on disk afterwards is refused. (The digest in install.json is
 * not itself signed: for an unsigned module, whoever can write the folder can rewrite both —
 * docs/module-security.md.)
 *
 * The checks are cached (#103): a listing re-reads and re-hashes only a module whose files
 * changed on disk (size or mtime) since it was last checked, or whose trust changed, and a
 * bundled package is inflated only when it changed. A load (a run) always re-reads and re-hashes
 * the installed module it runs, and inflates only the bundled package it runs.
 */
import * as fs from 'fs';
import * as path from 'path';
import { checkFiles, keyIdOf, readPackage, type ModuleTier, type PackageResult, type SignatureInfo } from './modulePackage';
import type { ModuleManifest } from '../../shared/modules/manifest';
import type { ModuleListing, ModuleSettings, ModuleSummary, TrustedKey } from '../../shared/modules/types';

export type { ModuleListing, ModuleSettings, ModuleSummary, TrustedKey };

/** Keys every build trusts; an edition adds its own (edition.json's trustedKeys — docs/editions.md). */
export const BUILTIN_TRUSTED_KEYS: TrustedKey[] = [];

const DEFAULT_SETTINGS: ModuleSettings = { allowCommunity: true, trustedKeys: [], enabled: {} };
const safeId = (id: string) => /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/.test(id);

/** A check's outcome without the files — what a listing needs; the files stay on disk. */
type Checked =
  | { ok: true; manifest: ModuleManifest; digest: string; signature: SignatureInfo; tier: ModuleTier }
  | { ok: false; reason: string; manifest?: ModuleManifest };

const withoutFiles = (r: PackageResult): Checked => {
  if (!r.ok) return r;
  const { files: _files, ...rest } = r;
  return rest;
};

/** Size and mtime of every file under `dir` (as readTree would read them): a change to any shows. */
function treeStamp(dir: string): string {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) { const st = fs.statSync(full); out.push(`${path.relative(dir, full)}\0${st.size}\0${st.mtimeMs}`); }
    }
  };
  walk(dir);
  return out.join('\n');
}

function fileStamp(file: string): string {
  const st = fs.statSync(file);
  return `${st.size}\0${st.mtimeMs}`;
}

function readTree(dir: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isSymbolicLink()) continue; // never written by install; ignored if planted
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) out.set(path.relative(dir, full).split(path.sep).join('/'), fs.readFileSync(full));
    }
  };
  walk(dir);
  return out;
}

export class ModuleStore {
  /** Checks of bundled packages, by file name. */
  private readonly bundledCache = new Map<string, { stamp: string; result: Checked }>();
  /** Checks of installed modules, by id. */
  private readonly installedCache = new Map<string, { stamp: string; result: Checked }>();

  constructor(private readonly root: string, private readonly bundledDir: string | null = null, private readonly builtinKeys: TrustedKey[] = BUILTIN_TRUSTED_KEYS) {}

  private get settingsFile() { return path.join(this.root, 'settings.json'); }
  private get installedDir() { return path.join(this.root, 'installed'); }

  settings(): ModuleSettings {
    try {
      const s = JSON.parse(fs.readFileSync(this.settingsFile, 'utf8')) as Partial<ModuleSettings>;
      return { ...DEFAULT_SETTINGS, ...s, enabled: { ...(s.enabled ?? {}) }, trustedKeys: [...(s.trustedKeys ?? [])] };
    } catch {
      return { ...DEFAULT_SETTINGS, enabled: {}, trustedKeys: [] };
    }
  }

  private save(s: ModuleSettings): void {
    fs.mkdirSync(this.root, { recursive: true });
    fs.writeFileSync(this.settingsFile, JSON.stringify(s, null, 2));
  }

  /** The keys the app trusts — matched by the whole key, not only its id (modulePackage). */
  private trustedKeys(): TrustedKey[] {
    return [...this.builtinKeys, ...this.settings().trustedKeys];
  }

  private summary(r: Extract<Checked, { ok: true }>, bundled: boolean): ModuleSummary {
    const m = r.manifest;
    return {
      id: m.id, name: m.name, version: m.version, publisher: m.publisher, description: m.description, license: m.license,
      tier: r.tier, signature: r.signature, reads: m.reads, writes: m.writes, bundled,
      enabled: this.settings().enabled[m.id] ?? true, manifest: m,
    };
  }

  /** Check a package before installing it: what it is, who signed it, what it reads and writes. */
  inspect(buf: Buffer): { ok: true; summary: ModuleSummary; installed: string | null } | { ok: false; reason: string } {
    const r = readPackage(buf, this.trustedKeys());
    if (!r.ok) return { ok: false, reason: r.reason };
    const existing = this.list().find((l) => l.status === 'ok' && l.summary.id === r.manifest.id);
    return { ok: true, summary: this.summary(r, false), installed: existing?.status === 'ok' ? existing.summary.version : null };
  }

  /**
   * Install (or replace) a module. Community modules need `acceptCommunity` — the UI's
   * confirmation — and are refused outright while Allow community modules is off.
   */
  install(buf: Buffer, opts: { acceptCommunity?: boolean } = {}): { ok: true; summary: ModuleSummary } | { ok: false; reason: string; needsConfirmation?: boolean } {
    const r = readPackage(buf, this.trustedKeys());
    if (!r.ok) return { ok: false, reason: r.reason };
    const id = r.manifest.id;
    if (!safeId(id)) return { ok: false, reason: 'invalid module id' };
    if (this.bundledIds().has(id)) return { ok: false, reason: `${r.manifest.name} is built into this edition and cannot be replaced` };
    if (r.tier === 'community') {
      if (!this.settings().allowCommunity) return { ok: false, reason: 'Community modules are turned off (Settings › Modules)' };
      if (!opts.acceptCommunity) return { ok: false, reason: 'Community modules need confirmation', needsConfirmation: true };
    }
    const dir = path.join(this.installedDir, id);
    const tmp = path.join(this.installedDir, `.${id}.${process.pid}.${Date.now()}`);
    fs.mkdirSync(path.join(tmp, 'files'), { recursive: true });
    try {
      for (const [name, data] of r.files) {
        const target = path.join(tmp, 'files', ...name.split('/'));
        if (!target.startsWith(path.join(tmp, 'files') + path.sep)) throw new Error(`unsafe path ${name}`);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, data);
      }
      fs.writeFileSync(path.join(tmp, 'install.json'), JSON.stringify({
        id, version: r.manifest.version, digest: r.digest, tier: r.tier, keyId: r.signature.keyId ?? null, installedAt: new Date().toISOString(),
      }, null, 2));
      fs.rmSync(dir, { recursive: true, force: true });
      this.installedCache.delete(id);
      fs.renameSync(tmp, dir);
    } catch (e) {
      fs.rmSync(tmp, { recursive: true, force: true });
      return { ok: false, reason: `Could not install: ${e instanceof Error ? e.message : String(e)}` };
    }
    return { ok: true, summary: this.summary(r, false) };
  }

  /** The edition's packages, checked — each inflated only when it is new or changed on disk. */
  private bundledChecks(): Array<{ file: string; result: Checked }> {
    if (!this.bundledDir || !fs.existsSync(this.bundledDir)) return [];
    const files = fs.readdirSync(this.bundledDir).filter((f) => f.endsWith('.xwmodule')).sort();
    for (const f of [...this.bundledCache.keys()]) if (!files.includes(f)) this.bundledCache.delete(f);
    return files.map((file) => {
      const full = path.join(this.bundledDir!, file);
      let stamp: string;
      try {
        stamp = fileStamp(full);
      } catch (e) {
        return { file, result: { ok: false, reason: `It cannot be read (${e instanceof Error ? e.message : String(e)})` } };
      }
      const hit = this.bundledCache.get(file);
      if (hit?.stamp === stamp) return { file, result: hit.result };
      const result = withoutFiles(readPackage(fs.readFileSync(full), [], { bundled: true }));
      this.bundledCache.set(file, { stamp, result });
      return { file, result };
    });
  }

  private bundledIds(): Set<string> {
    return new Set(this.bundledChecks().flatMap(({ result }) => (result.ok ? [result.manifest.id] : [])));
  }

  /** Re-check one installed module's files: read and hash them all (every load does). */
  private checkInstalled(id: string): PackageResult {
    const dir = path.join(this.installedDir, id);
    let record: { digest?: string } = {};
    try {
      record = JSON.parse(fs.readFileSync(path.join(dir, 'install.json'), 'utf8'));
    } catch {
      return { ok: false, reason: 'The installation record is missing' };
    }
    let files: Map<string, Buffer>;
    try {
      files = readTree(path.join(dir, 'files'));
    } catch (e) {
      // One broken folder (an interrupted remove, permissions) must not break every listing.
      return { ok: false, reason: `Its files cannot be read (${e instanceof Error ? e.message : String(e)})` };
    }
    const result = checkFiles(files, this.trustedKeys());
    if (result.ok && result.digest !== record.digest) {
      return { ok: false, reason: 'Its files were changed after it was installed', manifest: result.manifest };
    }
    return result;
  }

  /** What a listing needs of an installed module: the cached check while nothing it depends on changed. */
  private checkedInstalled(id: string): Checked {
    const dir = path.join(this.installedDir, id);
    let stamp: string | null;
    try {
      // Taken BEFORE reading: a change made while the files are read shows at the next listing.
      stamp = `${treeStamp(path.join(dir, 'files'))}\n${fileStamp(path.join(dir, 'install.json'))}\n${JSON.stringify(this.trustedKeys())}`;
    } catch {
      stamp = null; // unreadable: checkInstalled says why
    }
    const hit = this.installedCache.get(id);
    if (stamp !== null && hit?.stamp === stamp) return hit.result;
    const result = withoutFiles(this.checkInstalled(id));
    if (stamp !== null) this.installedCache.set(id, { stamp, result });
    else this.installedCache.delete(id);
    return result;
  }

  list(): ModuleListing[] {
    const out: ModuleListing[] = [];
    for (const { file, result: r } of this.bundledChecks()) {
      out.push(r.ok ? { status: 'ok', summary: this.summary(r, true) } : { status: 'refused', id: file, reason: r.reason, bundled: true });
    }
    const bundled = new Set(out.flatMap((l) => (l.status === 'ok' ? [l.summary.id] : [])));
    if (fs.existsSync(this.installedDir)) {
      for (const id of fs.readdirSync(this.installedDir).filter((d) => !d.startsWith('.')).sort()) {
        if (!safeId(id) || bundled.has(id)) continue;
        const result = this.checkedInstalled(id);
        if (result.ok && result.tier === 'community' && !this.settings().allowCommunity) {
          out.push({ status: 'refused', id, name: result.manifest.name, reason: 'Community modules are turned off (Settings › Modules)', bundled: false });
          continue;
        }
        out.push(result.ok ? { status: 'ok', summary: this.summary(result, false) } : { status: 'refused', id, name: result.manifest?.name, reason: result.reason, bundled: false });
      }
    }
    return out;
  }

  /** The files of an enabled, valid module, re-checked now — for the runtime (M3). */
  load(id: string): { ok: true; manifest: ModuleManifest; files: Map<string, Buffer>; tier: ModuleTier } | { ok: false; reason: string } {
    if (!safeId(id)) return { ok: false, reason: 'invalid module id' };
    if (this.settings().enabled[id] === false) return { ok: false, reason: 'The module is disabled' };
    const bundled = this.bundledChecks().find(({ result }) => result.ok && result.manifest.id === id);
    if (bundled) {
      // Inflated now, from the package itself: only this one.
      const r = readPackage(fs.readFileSync(path.join(this.bundledDir!, bundled.file)), [], { bundled: true });
      if (r.ok && r.manifest.id === id) return { ok: true, manifest: r.manifest, files: r.files, tier: 'bundled' };
      return { ok: false, reason: r.ok ? 'The bundled package changed' : r.reason };
    }
    const result = this.checkInstalled(id);
    if (!result.ok) return { ok: false, reason: result.reason };
    if (result.tier === 'community' && !this.settings().allowCommunity) return { ok: false, reason: 'Community modules are turned off' };
    return { ok: true, manifest: result.manifest, files: result.files, tier: result.tier };
  }

  remove(id: string): { ok: boolean; reason?: string } {
    if (!safeId(id)) return { ok: false, reason: 'invalid module id' };
    if (this.bundledIds().has(id)) return { ok: false, reason: 'Built into this edition: it can be disabled, not removed' };
    fs.rmSync(path.join(this.installedDir, id), { recursive: true, force: true });
    this.installedCache.delete(id);
    const s = this.settings();
    delete s.enabled[id];
    this.save(s);
    return { ok: true };
  }

  setEnabled(id: string, enabled: boolean): void {
    const s = this.settings();
    s.enabled[id] = enabled;
    this.save(s);
  }

  setAllowCommunity(allow: boolean): void {
    const s = this.settings();
    s.allowCommunity = allow;
    this.save(s);
  }

  /** Trust a publisher key (its public.json from `module:keygen`). The id must match the key. */
  trustKey(k: { keyId?: unknown; publicKey?: unknown; name?: unknown }): { ok: true; key: TrustedKey } | { ok: false; reason: string } {
    if (typeof k.publicKey !== 'string' || typeof k.keyId !== 'string') return { ok: false, reason: 'Not a publisher key file' };
    let id: string;
    try {
      id = keyIdOf(Buffer.from(k.publicKey, 'base64'));
    } catch {
      return { ok: false, reason: 'The key cannot be read' };
    }
    if (id !== k.keyId) return { ok: false, reason: 'The key id does not match the key' };
    const key: TrustedKey = { keyId: id, publicKey: k.publicKey, name: typeof k.name === 'string' && k.name ? k.name.slice(0, 100) : `Key ${id}` };
    const s = this.settings();
    s.trustedKeys = [...s.trustedKeys.filter((x) => x.keyId !== id), key];
    this.save(s);
    return { ok: true, key };
  }

  untrustKey(keyId: string): void {
    const s = this.settings();
    s.trustedKeys = s.trustedKeys.filter((k) => k.keyId !== keyId);
    this.save(s);
  }
}
