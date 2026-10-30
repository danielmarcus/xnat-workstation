/**
 * The main-process extension host (extension framework X1 — docs/extension-framework.md).
 *
 * Extensions come from one source today: the edition's `extensions/` folder, inside the app
 * archive (design point 5). Nothing below knows or cares which source an extension came from,
 * so a second one (runtime installation, option b) adds a folder, not a code path.
 *
 * Each extension is checked (manifest, files, API version) and then, unless the user disabled
 * it, its main part is started. The renderer part is started by the renderer, from
 * `xnat-extension://<id>/…`, which serves only an active extension's own files (fileFor).
 * This class holds no Electron imports so it can be tested directly; extensionHandlers wires it.
 */
import * as fs from 'fs';
import * as path from 'path';
import { EXTENSION_API_VERSION, apiCompatible, incompatibleReason, validateExtensionManifest, type ExtensionManifest } from '../../shared/extensions/manifest';
import type { ExtensionState, ExtensionSummary } from '../../shared/extensions/types';
import * as crypto from 'crypto';
import type { ExtensionGate, ExtensionSecureStorage, ExtensionStorage, ExtensionXnat, GateState, MainExtensionContext, MainPart } from '../../shared/extensions/api';
import type { ExtensionStorageStore } from './extensionStorage';
import type { ExtensionSecureStore } from './extensionSecureStorage';

export const EXTENSION_SCHEME = 'xnat-extension';

/**
 * An extension's fingerprint: every file in its folder, by its path there, with its SHA-256. The
 * edition build records it; the host checks it at load (design point 11).
 */
export function digestExtension(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) out[path.relative(dir, full).split(path.sep).join('/')] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    }
  };
  walk(dir);
  return out;
}

type MainPartExports = Partial<MainPart>;

interface Entry {
  key: string;
  dir: string;
  manifest: ExtensionManifest | null;
  /** For a manifest too invalid to keep: its name, if it has one, so Settings can show it. */
  name?: string;
  state: ExtensionState;
  reason?: string;
  main?: MainPartExports;
  /** The main part's channel handler (ext.channel.handle). */
  handler?: (message: unknown) => unknown;
  /** The context its main part was given (evaluate() gets the same). */
  ctx?: MainExtensionContext;
  /** Its gate as applied (X6). */
  gate?: GateState;
  /** Inactive by its own gate: still running (for its Settings page). */
  gated?: boolean;
}

interface Options {
  /** The folder holding one sub-folder per extension. */
  dir: string;
  /** Where the user's choices (disabled extensions) are kept. */
  settingsFile: string;
  /** How a main part is loaded (require). */
  load?: (file: string) => unknown;
  /** How long activate() / deactivate() may take. */
  timeoutMs?: number;
  /** XNAT as the signed-in user (ext.xnat). */
  xnat?: ExtensionXnat;
  /** Delivers a main part's ext.channel.post() to its renderer part. */
  post?: (extId: string, message: unknown) => void;
  /** Per-extension storage (ext.storage). */
  storage?: ExtensionStorageStore;
  /** The app runs under a test harness (ext.testing). */
  testing?: boolean;
  /** Keychain-encrypted storage (ext.secureStorage). */
  secureStore?: ExtensionSecureStore;
  /** Told when an extension's state changes without a call from the renderer (a gate re-evaluated). */
  onChange?: () => void;
  /**
   * The edition record's fingerprints (design point 11). When given, an extension loads only if
   * its files match its own exactly; one the record does not name is not part of the edition.
   */
  digests?: Record<string, Record<string, string>>;
}

const NO_SECURE: ExtensionSecureStorage = new Proxy({} as ExtensionSecureStorage, {
  get: () => () => Promise.reject(new Error('Secure storage is not available')),
});

/** Without a store (tests): every call refused. */
const NO_STORAGE: ExtensionStorage = new Proxy({} as ExtensionStorage, {
  get: () => () => Promise.reject(new Error('Storage is not available')),
});

/** Without XNAT (tests, or before sign-in is wired): no user, and every call refused. */
const NO_XNAT: ExtensionXnat = new Proxy({} as ExtensionXnat, {
  get: (_t, key) => (key === 'user' ? async () => null : () => Promise.reject(new Error('Not signed in to XNAT'))),
});

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} within ${Math.round(ms / 1000) || ms / 1000} s`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export class ExtensionHost {
  private entries: Entry[] = [];
  private readonly load: (file: string) => unknown;
  private readonly timeoutMs: number;

  constructor(private readonly opts: Options) {
    this.load = opts.load ?? ((file) => require(file));
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  /** Discover the extensions and start the main part of every enabled one. */
  async start(): Promise<void> {
    this.entries = this.discover();
    const disabled = this.disabled();
    for (const e of this.entries) {
      if (e.state !== 'active') continue;
      if (disabled.has(e.manifest!.id)) e.state = 'disabled';
      else await this.activate(e);
    }
  }

  list(): ExtensionSummary[] {
    return this.entries.map((e) => ({
      key: e.key,
      id: e.manifest?.id ?? null,
      name: e.manifest?.name ?? e.name ?? e.key,
      version: e.manifest?.version,
      publisher: e.manifest?.publisher,
      description: e.manifest?.description,
      state: e.state,
      reason: e.reason,
      rendererUrl: this.running(e) ? `${EXTENSION_SCHEME}://${e.manifest!.id}/${e.manifest!.renderer}` : undefined,
      gated: !!e.gated,
      tier: e.state === 'active' ? e.gate?.tier : undefined,
      features: e.manifest?.features?.map((f) => ({ id: f.id, name: f.name, enabled: e.state === 'active' && !!e.gate?.features.includes(f.id) })),
      hosts: e.manifest?.hosts,
    }));
  }

  /** The gate an extension's renderer part works under (active, enabled features, tier, reason). */
  gateOf(id: string): GateState | null {
    const e = this.loaded(id);
    if (!e || !this.running(e)) return null;
    return e.gate ?? { active: true, features: (e.manifest?.features ?? []).map((f) => f.id) };
  }

  /** Ask an extension's main part again (ext.gate.reevaluate, or a change of sign-in). */
  async reevaluate(id: string): Promise<void> {
    const e = this.loaded(id);
    const part = e?.main;
    if (!e || !this.running(e) || typeof part?.evaluate !== 'function' || !e.ctx) return;
    try {
      const r = await withTimeout(Promise.resolve().then(() => part.evaluate!(e.ctx!)), this.timeoutMs, 'did not finish checking');
      this.applyGate(e, r);
    } catch (err) {
      this.applyGate(e, { state: 'inactive', reason: `Licence check failed: ${errText(err)}` });
    }
    this.opts.onChange?.();
  }

  /** On sign-in, sign-out and a change of XNAT server: every running main part is asked again. */
  async reevaluateAll(): Promise<void> {
    for (const e of this.entries) if (e.manifest && this.running(e)) await this.reevaluate(e.manifest.id);
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const e = this.loaded(id);
    if (!e) return;
    const disabled = this.disabled();
    if (enabled) disabled.delete(id); else disabled.add(id);
    this.saveDisabled(disabled);
    if (!enabled && e.state !== 'disabled') {
      await this.deactivate(e);
      e.state = 'disabled';
      e.gated = false;
      e.reason = undefined;
    } else if (enabled && e.state === 'disabled') {
      await this.activate(e);
    }
  }

  /** The renderer could not start its part: the extension is inactive, and its main part stops. */
  async rendererFailed(id: string, reason: string): Promise<void> {
    const e = this.loaded(id);
    if (!e || !this.running(e)) return;
    await this.deactivate(e);
    e.state = 'inactive';
    e.gated = false;
    e.reason = `Failed to start: ${reason}`;
  }

  /** Whether the extension is loaded and started (its renderer part may use the host). */
  isRunning(id: string): boolean {
    const e = this.loaded(id);
    return !!e && this.running(e);
  }

  /** The renderer part asks its main part (ext.channel.request). */
  async channelRequest(id: string, message: unknown): Promise<unknown> {
    const e = this.loaded(id);
    if (!e || !this.running(e)) throw new Error(`${id} is not running`);
    if (!e.handler) throw new Error(`${id} has no main part answering requests (ext.channel.handle)`);
    return e.handler(message);
  }

  /** Whether any main part is running (and so has to be stopped at quit). */
  hasRunningMainParts(): boolean {
    return this.entries.some((e) => e.main);
  }

  /** At quit: stop every main part. */
  async stopAll(): Promise<void> {
    await Promise.all(this.entries.filter((e) => this.running(e)).map((e) => this.deactivate(e)));
  }

  /** The file an `xnat-extension://` URL names — only an active extension's own, existing files. */
  fileFor(url: string): string | null {
    let u: URL;
    try { u = new URL(url); } catch { return null; }
    if (u.protocol !== `${EXTENSION_SCHEME}:`) return null;
    const e = this.loaded(u.host);
    if (!e || !this.running(e)) return null;
    let rel: string;
    try { rel = decodeURIComponent(u.pathname).replace(/^\/+/, ''); } catch { return null; }
    const file = path.resolve(e.dir, rel);
    if (!file.startsWith(e.dir + path.sep)) return null;
    try { return fs.statSync(file).isFile() ? file : null; } catch { return null; }
  }

  // ─── internals ───────────────────────────────────────────────

  /** The first file that differs from the record ('' when there is no record for it), or null. */
  private changedFile(dir: string, expected: Record<string, string> | undefined): string | null {
    if (!expected) return '';
    const actual = digestExtension(dir);
    for (const f of [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()) {
      if (expected[f] !== actual[f]) return f;
    }
    return null;
  }

  /** Started and not stopped: active, or inactive by its own gate. */
  private running(e: Entry): boolean {
    return e.state === 'active' || (e.state === 'inactive' && !!e.gated);
  }

  private applyGate(e: Entry, r: unknown): void {
    const declared = (e.manifest?.features ?? []).map((f) => f.id);
    const g = (r && typeof r === 'object' ? r : undefined) as ExtensionGate | undefined;
    if (g?.state === 'inactive') {
      e.state = 'inactive';
      e.gated = true;
      e.reason = String(g.reason || 'Inactive');
      e.gate = { active: false, features: [], reason: e.reason };
      return;
    }
    const named = g?.state === 'active' && Array.isArray(g.features) ? g.features : null;
    e.state = 'active';
    e.gated = false;
    e.reason = undefined;
    e.gate = {
      active: true,
      features: named ? declared.filter((f) => named.includes(f)) : declared,
      tier: g?.state === 'active' && typeof g.tier === 'string' ? g.tier : undefined,
    };
  }

  /** A random id per extension, kept beside its data (never hardware data). */
  private installId(id: string): string {
    const file = path.join(path.dirname(this.opts.settingsFile), 'extension-data', id, 'install-id');
    try {
      const v = fs.readFileSync(file, 'utf8').trim();
      if (v) return v;
    } catch { /* first run */ }
    const v = crypto.randomUUID();
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, v);
    } catch (err) {
      console.warn(`[extensionHost] could not keep ${id}'s install id: ${errText(err)}`);
    }
    return v;
  }

  private loaded(id: string): Entry | undefined {
    return this.entries.find((e) => e.manifest?.id === id && e.state !== 'refused');
  }

  private discover(): Entry[] {
    let folders: string[];
    try {
      folders = fs.readdirSync(this.opts.dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    } catch {
      return [];
    }
    const out: Entry[] = [];
    for (const folder of folders) {
      const dir = path.resolve(this.opts.dir, folder);
      const refuse = (reason: string, manifest: ExtensionManifest | null = null) =>
        out.push({ key: manifest?.id ?? folder, dir, manifest, state: 'refused', reason });
      let raw: unknown;
      try {
        raw = JSON.parse(fs.readFileSync(path.join(dir, 'extension.json'), 'utf8'));
      } catch (err) {
        refuse((err as NodeJS.ErrnoException).code === 'ENOENT' ? 'No extension.json' : 'extension.json is not valid JSON');
        continue;
      }
      const v = validateExtensionManifest(raw);
      if (!v.ok) {
        const r = (raw ?? {}) as { id?: unknown; name?: unknown };
        const id = typeof r.id === 'string' ? r.id : null;
        const name = typeof r.name === 'string' && r.name.trim() ? r.name : undefined;
        out.push({ key: id ?? folder, dir, manifest: null, name, state: 'refused', reason: `Invalid extension.json: ${v.errors.join('; ')}` });
        continue;
      }
      const m = v.manifest;
      const missing = [m.renderer, m.main].find((f) => f && !fs.existsSync(path.join(dir, f)));
      if (missing) { refuse(`${missing} is missing`, m); continue; }
      if (!apiCompatible(m.apiVersion, EXTENSION_API_VERSION)) { refuse(incompatibleReason(m.apiVersion), m); continue; }
      if (this.opts.digests) {
        const changed = this.changedFile(dir, this.opts.digests[m.id]);
        if (changed !== null) { refuse(changed === '' ? 'Not part of this edition' : `Changed after the edition was built: ${changed}`, m); continue; }
      }
      if (out.some((o) => o.manifest?.id === m.id && o.state !== 'refused')) {
        // Keyed by its folder: the id belongs to the one already loaded.
        out.push({ key: folder, dir, manifest: m, state: 'refused', reason: `An extension with the id ${m.id} is already loaded` });
        continue;
      }
      out.push({ key: m.id, dir, manifest: m, state: 'active' });
    }
    return out;
  }

  private async activate(e: Entry): Promise<void> {
    const m = e.manifest!;
    this.applyGate(e, undefined); // no main part, no gate: active, every feature
    if (!m.main) return;
    try {
      const mod = this.load(path.join(e.dir, m.main)) as MainPartExports & { default?: MainPartExports };
      const part = typeof mod?.activate === 'function' ? mod : mod?.default;
      if (typeof part?.activate !== 'function') throw new Error(`${m.main} exports no activate()`);
      const ctx: MainExtensionContext = {
        id: m.id,
        version: m.version,
        apiVersion: EXTENSION_API_VERSION,
        log: (...args) => console.log(`[ext:${m.id}]`, ...args),
        xnat: this.opts.xnat ?? NO_XNAT,
        storage: this.opts.storage?.for(m.id) ?? NO_STORAGE,
        secureStorage: this.opts.secureStore?.for(m.id) ?? NO_SECURE,
        installId: this.installId(m.id),
        gate: { reevaluate: () => this.reevaluate(m.id) },
        testing: !!this.opts.testing,
        channel: {
          handle: (handler) => {
            e.handler = handler;
            return () => { if (e.handler === handler) e.handler = undefined; };
          },
          post: (message) => {
            if (e.state === 'active') this.opts.post?.(m.id, message);
          },
        },
      };
      e.ctx = ctx;
      e.main = part; // before the gate: its handler and evaluate() serve while it is gated too
      const gate = await withTimeout(Promise.resolve().then(() => part.activate!(ctx)), this.timeoutMs, 'did not finish starting');
      this.applyGate(e, gate);
    } catch (err) {
      e.state = 'inactive';
      e.gated = false;
      e.main = undefined;
      e.ctx = undefined;
      e.handler = undefined;
      e.reason = `Failed to start: ${errText(err)}`;
      console.warn(`[extensionHost] ${m.id} did not start: ${errText(err)}`);
    }
  }

  private async deactivate(e: Entry): Promise<void> {
    const part = e.main;
    e.main = undefined;
    e.ctx = undefined;
    e.handler = undefined;
    if (typeof part?.deactivate !== 'function') return;
    try {
      await withTimeout(Promise.resolve().then(() => part.deactivate!()), this.timeoutMs, 'did not finish stopping');
    } catch (err) {
      console.warn(`[extensionHost] ${e.key} did not stop cleanly: ${errText(err)}`);
    }
  }

  private disabled(): Set<string> {
    try {
      const s = JSON.parse(fs.readFileSync(this.opts.settingsFile, 'utf8')) as { disabled?: unknown };
      return new Set(Array.isArray(s.disabled) ? s.disabled.filter((x): x is string => typeof x === 'string') : []);
    } catch {
      return new Set();
    }
  }

  private saveDisabled(disabled: Set<string>): void {
    try {
      fs.mkdirSync(path.dirname(this.opts.settingsFile), { recursive: true });
      fs.writeFileSync(this.opts.settingsFile, JSON.stringify({ disabled: [...disabled].sort() }, null, 2));
    } catch (err) {
      console.warn(`[extensionHost] could not save the extension settings: ${errText(err)}`);
    }
  }
}
