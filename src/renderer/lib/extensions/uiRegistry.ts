/**
 * What extensions have added to the app's UI (extension framework X2 — docs/extension-framework.md,
 * wireframes E1–E7): sidebar tabs, toolbar items, full-window views, Settings pages and commands.
 * The slots render from this store. Everything an extension registers is recorded against it,
 * so stopping the extension (disable, failure, reload) removes all of it — nothing it added
 * outlives it.
 *
 * X6: what shows is also decided by each extension's gate (its licence, as its main part
 * decided): `visible()` lets through only what the gate allows — a locked feature is absent, not
 * disabled — and the gate changes it live, without the extension registering anything again.
 * Its Settings page stays while it is gated: that is where a licence is entered.
 */
import { create } from 'zustand';
import type {
  CommandSpec,
  Dispose,
  ExtensionCommands,
  ExtensionUi,
  GateState,
  KeyBinding,
  SettingsPageSpec,
  SidebarTabSpec,
  ToolbarItemHandle,
  ToolbarItemSpec,
  ViewSpec,
} from '@shared/extensions/api';
import type { HotkeyAction } from '@shared/types/hotkeys';
import { hotkeyService } from '../hotkeys/hotkeyService';

interface Owned { extId: string; extName: string }
export type SidebarTabEntry = Owned & SidebarTabSpec;
export type ToolbarItemEntry = Owned & { key: string; spec: ToolbarItemSpec };
export type ViewEntry = Owned & ViewSpec;
export type SettingsPageEntry = Owned & SettingsPageSpec;
export type CommandEntry = Owned & { id: string; title: string; action: HotkeyAction; run: () => unknown; keys: KeyBinding[]; feature?: string };

interface ExtensionUiState {
  sidebarTabs: SidebarTabEntry[];
  toolbarItems: ToolbarItemEntry[];
  views: ViewEntry[];
  settingsPages: SettingsPageEntry[];
  commands: CommandEntry[];
  /** The full-window view open now, if any. */
  openView: { extId: string; id: string } | null;
  /** Each extension's gate (X6). None yet: everything shows. */
  gates: Record<string, GateState>;
}

const EMPTY: ExtensionUiState = { sidebarTabs: [], toolbarItems: [], views: [], settingsPages: [], commands: [], openView: null, gates: {} };

export const useExtensionUiStore = create<ExtensionUiState>(() => ({ ...EMPTY }));

const set = (patch: Partial<ExtensionUiState> | ((s: ExtensionUiState) => Partial<ExtensionUiState>)) =>
  useExtensionUiStore.setState(patch as Partial<ExtensionUiState>);

/** Whether the extension's gate lets a contribution show: active, and its feature (if any) enabled. */
export function allows(gates: Record<string, GateState>, extId: string, feature?: string): boolean {
  const g = gates[extId];
  if (!g) return true;
  return g.active && (!feature || g.features.includes(feature));
}

/** The entries of a list that their extensions' gates let show. Settings pages show while running. */
export function visible<T extends Owned>(s: Pick<ExtensionUiState, 'gates' | 'settingsPages'>, list: T[]): T[] {
  if ((list as unknown) === s.settingsPages) return list;
  return list.filter((e) => {
    const feature = (e as { feature?: string }).feature ?? (e as { spec?: { feature?: string } }).spec?.feature;
    return allows(s.gates, e.extId, feature);
  });
}

/** Apply an extension's gate (from its main part, via the host). null: it no longer has one. */
export function setExtensionGate(extId: string, gate: GateState | null): void {
  set((s) => {
    const gates = { ...s.gates };
    if (gate) gates[extId] = gate; else delete gates[extId];
    const open = s.openView;
    const view = open && s.views.find((v) => v.extId === open.extId && v.id === open.id);
    // A view whose feature was just locked closes (the app returns to the viewer).
    const keepOpen = !open || (open.extId !== extId) || (!!view && allows(gates, extId, view.feature));
    return { gates, openView: keepOpen ? open : null };
  });
}

/** The components extensions draw with (`ext.ui.components`), installed from the component layer. */
let components: ExtensionUi['components'] | null = null;
export function setExtensionComponents(c: ExtensionUi['components']): void {
  components = c;
}

/** Every extension's undo functions, run when it stops. */
const owned = new Map<string, Set<Dispose>>();
let nextKey = 0;

/** Record `dispose` against an extension: it runs when the extension stops (or when called). */
export function trackForExtension(extId: string, dispose: Dispose): Dispose {
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    owned.get(extId)?.delete(once);
    dispose();
  };
  if (!owned.has(extId)) owned.set(extId, new Set());
  owned.get(extId)!.add(once);
  return once;
}

/** Run an extension's command; a failure is logged, never thrown into the app. */
export function executeExtensionCommand(extId: string, id: string): void {
  const st = useExtensionUiStore.getState();
  const c = st.commands.find((x) => x.extId === extId && x.id === id);
  if (!c) { console.warn(`[extensions] ${extId} has no command ${id}`); return; }
  if (!allows(st.gates, extId, c.feature)) { console.warn(`[extensions] ${extId}:${id} is not enabled`); return; }
  try {
    void Promise.resolve(c.run()).catch((err) => console.warn(`[extensions] ${extId}:${id} failed:`, err));
  } catch (err) {
    console.warn(`[extensions] ${extId}:${id} failed:`, err);
  }
}

export function closeExtensionView(): void {
  set({ openView: null });
}

/** The ui and commands parts of a renderer part's context. */
export function createExtensionUiApi(extId: string, extName: string): { ui: ExtensionUi; commands: ExtensionCommands } {
  const own = { extId, extName };
  const ui: ExtensionUi = {
    sidebarTab(spec) {
      // One tab per extension (D10): a second replaces the first.
      set((s) => ({ sidebarTabs: [...s.sidebarTabs.filter((t) => t.extId !== extId), { ...own, ...spec }] }));
      return trackForExtension(extId, () => set((s) => ({ sidebarTabs: s.sidebarTabs.filter((t) => !(t.extId === extId && t.component === spec.component)) })));
    },
    toolbarItem(spec): ToolbarItemHandle {
      const key = `${extId}#${nextKey++}`;
      set((s) => ({ toolbarItems: [...s.toolbarItems, { ...own, key, spec: { ...spec } }] }));
      const dispose = trackForExtension(extId, () => set((s) => ({ toolbarItems: s.toolbarItems.filter((t) => t.key !== key) })));
      return {
        update: (patch) => set((s) => ({ toolbarItems: s.toolbarItems.map((t) => (t.key === key ? { ...t, spec: { ...t.spec, ...patch } } : t)) })),
        dispose,
      };
    },
    view(spec) {
      set((s) => ({ views: [...s.views.filter((v) => !(v.extId === extId && v.id === spec.id)), { ...own, ...spec }] }));
      return trackForExtension(extId, () => set((s) => ({
        views: s.views.filter((v) => !(v.extId === extId && v.id === spec.id)),
        openView: s.openView?.extId === extId && s.openView.id === spec.id ? null : s.openView,
      })));
    },
    openView(id) {
      const st = useExtensionUiStore.getState();
      const view = st.views.find((v) => v.extId === extId && v.id === id);
      if (!view) {
        console.warn(`[extensions] ${extId} has no view ${id}`);
        return;
      }
      if (!allows(st.gates, extId, view.feature)) {
        console.warn(`[extensions] ${extId}'s view ${id} is not enabled`);
        return;
      }
      set({ openView: { extId, id } });
    },
    closeView() {
      if (useExtensionUiStore.getState().openView?.extId === extId) closeExtensionView();
    },
    settingsPage(spec) {
      set((s) => ({ settingsPages: [...s.settingsPages.filter((p) => p.extId !== extId), { ...own, ...spec }] }));
      return trackForExtension(extId, () => set((s) => ({ settingsPages: s.settingsPages.filter((p) => !(p.extId === extId && p.component === spec.component)) })));
    },
    get components() {
      if (!components) throw new Error('ext.ui.components are not installed');
      return components;
    },
  };
  const commands: ExtensionCommands = {
    register(spec: CommandSpec) {
      const action = `ext:${extId}:${spec.id}` as const;
      const entry: CommandEntry = { ...own, id: spec.id, title: spec.title, action, run: spec.run, keys: spec.keys ?? [], feature: spec.feature };
      // Its keys are bound by syncKeys — only while its gate allows it.
      set((s) => ({ commands: [...s.commands.filter((c) => c.action !== action), entry] }));
      return trackForExtension(extId, () => set((s) => ({ commands: s.commands.filter((c) => c !== entry) })));
    },
    execute: (id) => executeExtensionCommand(extId, id),
  };
  return { ui, commands };
}

/** Remove everything an extension registered (it stopped). */
export function disposeExtensionUi(extId: string): void {
  for (const d of [...(owned.get(extId) ?? [])]) d();
  owned.delete(extId);
  set((s) => ({
    sidebarTabs: s.sidebarTabs.filter((x) => x.extId !== extId),
    toolbarItems: s.toolbarItems.filter((x) => x.extId !== extId),
    views: s.views.filter((x) => x.extId !== extId),
    settingsPages: s.settingsPages.filter((x) => x.extId !== extId),
    commands: s.commands.filter((x) => x.extId !== extId),
    openView: s.openView?.extId === extId ? null : s.openView,
    gates: Object.fromEntries(Object.entries(s.gates).filter(([id]) => id !== extId)),
  }));
}

/**
 * Bind the keys of exactly the commands whose gates allow them: a command registered, unlocked or
 * re-locked changes its keys at once (a locked feature has no key).
 */
const boundKeys = new Map<CommandEntry, () => void>();
function syncKeys(s: ExtensionUiState): void {
  const wanted = new Set(visible(s, s.commands));
  for (const [entry, unbind] of boundKeys) {
    if (!wanted.has(entry)) { unbind(); boundKeys.delete(entry); }
  }
  for (const entry of wanted) {
    if (!boundKeys.has(entry)) {
      boundKeys.set(entry, hotkeyService.registerExtensionAction(entry.action as `ext:${string}`, entry.keys, () => executeExtensionCommand(entry.extId, entry.id)));
    }
  }
}
useExtensionUiStore.subscribe((s, prev) => { if (s.commands !== prev.commands || s.gates !== prev.gates) syncKeys(s); });

/** The command an `ext:` hotkey action names, for labels (Settings › Hotkeys). */
export function commandForAction(action: string): CommandEntry | undefined {
  return useExtensionUiStore.getState().commands.find((c) => c.action === action);
}

export function __resetExtensionUiForTests(): void {
  for (const id of [...owned.keys()]) disposeExtensionUi(id);
  useExtensionUiStore.setState({ ...EMPTY });
}
