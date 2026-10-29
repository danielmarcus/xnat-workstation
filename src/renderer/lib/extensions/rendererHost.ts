/**
 * The renderer half of the extension host (extension framework X1 — docs/extension-framework.md).
 *
 * The main process decides which extensions are active and starts their main parts first; this
 * then imports each active one's renderer part from `xnat-extension://<id>/…` and calls its
 * activate(). A renderer part that fails is reported back, which makes the extension inactive
 * (its main part stops). Stopping runs the other way: renderer part, then main part — and
 * everything the extension added to the UI is removed with it (uiRegistry). The React side —
 * the app's React for extension bundles, the components they draw with — is installed by
 * components/extensions/installExtensionHost before extensions start.
 */
import { EXTENSION_API_VERSION } from '@shared/extensions/manifest';
import type { ExtensionSummary } from '@shared/extensions/types';
import { EXTENSION_TEST_GLOBAL, type ExtensionFiles, type ExtensionStorage, type ExtensionXnat, type GateState, type RendererChannel, type RendererExtensionContext, type RendererPart } from '@shared/extensions/api';
import { useExtensionStore } from '../../stores/extensionStore';
import { createExtensionUiApi, disposeExtensionUi, setExtensionGate, trackForExtension } from './uiRegistry';
import { createStateApi } from './stateApi';

type RendererPartExports = Partial<RendererPart>;

type ExtensionsApi = NonNullable<NonNullable<typeof window.electronAPI>['extensions']>;
type Importer = (url: string) => Promise<unknown>;

/** How long a renderer part's activate() may take. */
const START_LIMIT_MS = 10_000;

const running = new Map<string, RendererPartExports>();
let started: Promise<void> | null = null;
let api: ExtensionsApi | undefined;
let importModule: Importer = (url) => import(/* @vite-ignore */ url);

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Main's answer over IPC, as the value or an Error with main's own message. */
async function unwrap(p: Promise<{ ok: true; value: unknown } | { ok: false; error: string }>): Promise<unknown> {
  const r = await p;
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

/** ext.xnat for a renderer part: every call is made in main (extensionXnat), as this extension. */
function xnatFor(id: string): ExtensionXnat {
  const call = (op: string) => (...args: unknown[]) => unwrap(api!.xnat(id, op, args));
  return {
    user: call('user'),
    request: call('request'),
    getJson: call('getJson'),
    permissions: call('permissions'),
    resourceFiles: call('resourceFiles'),
  } as ExtensionXnat;
}

/** ext.storage for a renderer part: the extension's own store, in main (extensionStorage). */
function storageFor(id: string): ExtensionStorage {
  const call = (op: string) => (...args: unknown[]) => unwrap(api!.storage(id, op, args));
  return { get: call('get'), set: call('set'), delete: call('delete'), keys: call('keys') } as ExtensionStorage;
}

/** ext.files: the system's dialogs, shown by main. */
function filesFor(id: string): ExtensionFiles {
  return {
    open: (options) => unwrap(api!.openFile(id, options)) as ReturnType<ExtensionFiles['open']>,
    save: (options) => unwrap(api!.saveFile(id, options)) as ReturnType<ExtensionFiles['save']>,
  };
}

/** Under a test harness: the running renderer parts' contexts, for their own E2E (R11). */
function listForTests(id: string, ctx: RendererExtensionContext | null): void {
  if (!api?.testing) return;
  const g = globalThis as Record<string, unknown>;
  const list = (g[EXTENSION_TEST_GLOBAL] ??= {}) as Record<string, RendererExtensionContext>;
  if (ctx) list[id] = ctx; else delete list[id];
}

/** Main parts' posts, by extension: one IPC subscription, fanned out. */
const channelListeners = new Map<string, Set<(message: unknown) => void>>();
let channelUnsubscribe: (() => void) | null = null;

function channelFor(id: string): RendererChannel {
  return {
    request: (message) => unwrap(api!.channelRequest(id, message)),
    onMessage(listener) {
      if (!channelListeners.has(id)) channelListeners.set(id, new Set());
      channelListeners.get(id)!.add(listener);
      return trackForExtension(id, () => { channelListeners.get(id)?.delete(listener); });
    },
  };
}
/** An extension's gate as the host applied it (X6), from its summary. */
export function gateOf(s: ExtensionSummary): GateState {
  if (s.state !== 'active') return { active: false, features: [], reason: s.reason };
  const g: GateState = { active: true, features: (s.features ?? []).filter((f) => f.enabled).map((f) => f.id) };
  if (s.tier) g.tier = s.tier;
  return g;
}

/** Publish the list, and apply each running extension's gate to what it shows (live). */
const publish = (list: ExtensionSummary[]) => {
  useExtensionStore.getState().setExtensions(list);
  for (const s of list) {
    if (!s.id) continue;
    setExtensionGate(s.id, s.rendererUrl ? gateOf(s) : null);
  }
};
let changedUnsubscribe: (() => void) | null = null;

async function startRendererPart(s: ExtensionSummary): Promise<ExtensionSummary[] | null> {
  // Active, or inactive by its own gate (still running, for its Settings page): the host says
  // which by giving it a renderer URL.
  if (!api || !s.rendererUrl || !s.id) return null;
  try {
    const mod = (await importModule(s.rendererUrl)) as RendererPartExports & { default?: RendererPartExports };
    const part = typeof mod?.activate === 'function' ? mod : mod?.default;
    if (typeof part?.activate !== 'function') throw new Error(`${s.rendererUrl.split('/').pop()} exports no activate()`);
    const id = s.id;
    const ctx: RendererExtensionContext = {
      id,
      name: s.name,
      version: s.version ?? '',
      apiVersion: EXTENSION_API_VERSION,
      log: (...args) => console.log(`[ext:${id}]`, ...args),
      ...createExtensionUiApi(id, s.name),
      xnat: xnatFor(id),
      channel: channelFor(id),
      ...createStateApi(id),
      storage: storageFor(id),
      files: filesFor(id),
      testing: !!api.testing,
      gate: {
        current: () => {
          const now = useExtensionStore.getState().extensions.find((x) => x.id === id);
          return now ? gateOf(now) : { active: false, features: [] };
        },
        reevaluate: async () => { publish(await api!.reevaluate(id)); },
      },
    };
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`did not finish starting within ${START_LIMIT_MS / 1000} s`)), START_LIMIT_MS);
      Promise.resolve().then(() => part.activate!(ctx)).then(() => { clearTimeout(t); resolve(); }, (e) => { clearTimeout(t); reject(e); });
    });
    running.set(id, part);
    listForTests(id, ctx);
    return null;
  } catch (err) {
    console.warn(`[extensions] ${s.id} did not start: ${errText(err)}`);
    disposeExtensionUi(s.id); // whatever it registered before failing
    return api.rendererFailed(s.id, errText(err));
  }
}

function stopRendererPart(id: string): void {
  const part = running.get(id);
  running.delete(id);
  listForTests(id, null);
  try {
    part?.deactivate?.();
  } catch (err) {
    console.warn(`[extensions] ${id} did not stop cleanly: ${errText(err)}`);
  }
  disposeExtensionUi(id);
}

/**
 * At app start: start the renderer part of every extension the main process started. Once per
 * page — a second call (React's StrictMode runs mount effects twice) waits on the first.
 */
export function startExtensions(opts: { api?: ExtensionsApi; importModule?: Importer } = { api: window.electronAPI?.extensions }): Promise<void> {
  if (started) return started;
  api = opts.api;
  if (opts.importModule) importModule = opts.importModule;
  started = (async () => {
    if (!api) return;
    // Main re-evaluated a gate (sign-in, a licence imported): apply it live.
    changedUnsubscribe = api.onChanged((list) => publish(list));
    channelUnsubscribe = api.onChannelMessage((id, message) => {
      for (const l of [...(channelListeners.get(id) ?? [])]) {
        try { l(message); } catch (err) { console.warn(`[extensions] ${id}: a channel listener failed:`, err); }
      }
    });
    // The gates are applied before the renderer parts start, so nothing locked shows even briefly.
    let list = await api.list();
    publish(list);
    for (const s of list) list = (await startRendererPart(s)) ?? list;
    publish(list);
  })();
  return started;
}

/** Settings › Extensions' Enabled switch. */
export async function setExtensionEnabled(id: string, enabled: boolean): Promise<void> {
  if (!api) return;
  if (!enabled) stopRendererPart(id);
  let list = await api.setEnabled(id, enabled);
  if (enabled) {
    const s = list.find((x) => x.id === id);
    if (s) list = (await startRendererPart(s)) ?? list;
  }
  publish(list);
}

/**
 * "Reload extension" on a failed slot (wireframe E7): stop the renderer part — removing all it
 * added — and start it again.
 */
export async function reloadExtension(id: string): Promise<void> {
  if (!api) return;
  stopRendererPart(id);
  const s = useExtensionStore.getState().extensions.find((x) => x.id === id);
  if (!s) return;
  const failed = await startRendererPart(s);
  if (failed) publish(failed);
}

/** When the window goes away: stop every renderer part. */
export function stopExtensions(): void {
  for (const id of [...running.keys()]) stopRendererPart(id);
}

export function __resetForTests(): void {
  running.clear();
  api = undefined;
  started = null;
  channelUnsubscribe?.();
  channelUnsubscribe = null;
  changedUnsubscribe?.();
  changedUnsubscribe = null;
  channelListeners.clear();
}
