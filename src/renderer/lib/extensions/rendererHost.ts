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
import type { RendererExtensionContext, RendererPart } from '@shared/extensions/api';
import { useExtensionStore } from '../../stores/extensionStore';
import { createExtensionUiApi, disposeExtensionUi } from './uiRegistry';

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
const publish = (list: ExtensionSummary[]) => useExtensionStore.getState().setExtensions(list);

async function startRendererPart(s: ExtensionSummary): Promise<ExtensionSummary[] | null> {
  if (!api || s.state !== 'active' || !s.rendererUrl || !s.id) return null;
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
    };
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`did not finish starting within ${START_LIMIT_MS / 1000} s`)), START_LIMIT_MS);
      Promise.resolve().then(() => part.activate!(ctx)).then(() => { clearTimeout(t); resolve(); }, (e) => { clearTimeout(t); reject(e); });
    });
    running.set(id, part);
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
    let list = await api.list();
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
}
