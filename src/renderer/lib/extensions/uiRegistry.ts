/**
 * What extensions have added to the app's UI (extension framework X2 — docs/extension-framework.md,
 * wireframes E1–E7): sidebar tabs, toolbar items, full-window views, Settings pages and commands.
 * The slots render from this store. Everything an extension registers is recorded against it,
 * so stopping the extension (disable, failure, reload) removes all of it — nothing it added
 * outlives it.
 */
import { create } from 'zustand';
import type {
  CommandSpec,
  Dispose,
  ExtensionCommands,
  ExtensionUi,
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
export type CommandEntry = Owned & { id: string; title: string; action: HotkeyAction; run: () => unknown };

interface ExtensionUiState {
  sidebarTabs: SidebarTabEntry[];
  toolbarItems: ToolbarItemEntry[];
  views: ViewEntry[];
  settingsPages: SettingsPageEntry[];
  commands: CommandEntry[];
  /** The full-window view open now, if any. */
  openView: { extId: string; id: string } | null;
}

const EMPTY: ExtensionUiState = { sidebarTabs: [], toolbarItems: [], views: [], settingsPages: [], commands: [], openView: null };

export const useExtensionUiStore = create<ExtensionUiState>(() => ({ ...EMPTY }));

const set = (patch: Partial<ExtensionUiState> | ((s: ExtensionUiState) => Partial<ExtensionUiState>)) =>
  useExtensionUiStore.setState(patch as Partial<ExtensionUiState>);

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
  const c = useExtensionUiStore.getState().commands.find((x) => x.extId === extId && x.id === id);
  if (!c) { console.warn(`[extensions] ${extId} has no command ${id}`); return; }
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
      if (!useExtensionUiStore.getState().views.some((v) => v.extId === extId && v.id === id)) {
        console.warn(`[extensions] ${extId} has no view ${id}`);
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
      const entry: CommandEntry = { ...own, id: spec.id, title: spec.title, action, run: spec.run };
      set((s) => ({ commands: [...s.commands.filter((c) => c.action !== action), entry] }));
      const unbind = hotkeyService.registerExtensionAction(action, spec.keys ?? [], () => executeExtensionCommand(extId, spec.id));
      return trackForExtension(extId, () => {
        unbind();
        set((s) => ({ commands: s.commands.filter((c) => c !== entry) }));
      });
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
  }));
}

/** The command an `ext:` hotkey action names, for labels (Settings › Hotkeys). */
export function commandForAction(action: string): CommandEntry | undefined {
  return useExtensionUiStore.getState().commands.find((c) => c.action === action);
}

export function __resetExtensionUiForTests(): void {
  for (const id of [...owned.keys()]) disposeExtensionUi(id);
  useExtensionUiStore.setState({ ...EMPTY });
}
