/**
 * The extension API as extensions see it (extension framework — docs/extension-framework.md):
 * what each part's activate() receives, and what each part exports. The single source for the
 * host (main and renderer) and the SDK, @nrgxnat/workstation-extension-api. It grows slice by
 * slice — X2 adds UI slots and commands, X3 XNAT and app state, X4 annotations, X5 storage and
 * files, X6 the licence gate — each as a minor version (EXTENSION_API_VERSION).
 */
import type { ComponentType, ReactNode } from 'react';

/**
 * Where the host puts its React for extension bundles (design point 4): the SDK's `react` and
 * `react/jsx-runtime` modules read it, so an extension renders with the app's own React.
 */
export const EXTENSION_HOST_GLOBAL = '__xnatWorkstationExtensionHost';

/** Common to both parts' contexts. */
export interface ExtensionContextBase {
  /** The extension's id (its manifest's). */
  id: string;
  /** The extension's version (its manifest's). */
  version: string;
  /** The API this host implements, major.minor. */
  apiVersion: string;
  /** Logs with the extension's id as prefix. */
  log: (...args: unknown[]) => void;
}

/** What the main part's activate() receives. */
export type MainExtensionContext = ExtensionContextBase;

/** Undoes a registration. Everything an extension registered is also undone when it stops. */
export type Dispose = () => void;

/** A key, as Settings › Hotkeys writes it: `{ key: 'n' }`, `{ key: 'n', modifiers: { shift: true } }`. */
export interface KeyBinding {
  key: string;
  modifiers?: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean };
}

/** A UI part an extension draws: a React component (the app's React — design point 4). */
export type SlotComponent = ComponentType;

/** The tab beside Browse in the sidebar (wireframe E1). One per extension. */
export interface SidebarTabSpec {
  title: string;
  component: SlotComponent;
}

/**
 * The item left of Annotate · Tags · Settings in the toolbar (wireframe E2). The host draws the
 * button, so it looks and collapses like the toolbar's own; the extension decides its text, when
 * it shows, and what a click does — run a command, or open a popover it draws.
 */
export interface ToolbarItemSpec {
  /** Short text; hidden (moved to the tooltip) when the toolbar narrows. */
  label: string;
  /** A one- or two-character glyph shown always, e.g. "📝". */
  icon?: string;
  /** Tooltip; the extension's name is added to it. */
  title?: string;
  /** Default true. */
  visible?: boolean;
  /** A command of this extension to run on click. */
  command?: string;
  /** Or a popover to open on click. */
  popover?: SlotComponent;
}

export interface ToolbarItemHandle {
  update(spec: Partial<ToolbarItemSpec>): void;
  dispose: Dispose;
}

/** A full-window view (wireframe E3): over the viewer and side panels, under the toolbar. */
export interface ViewSpec {
  id: string;
  title: string;
  component: SlotComponent;
}

/** The extension's page in Settings, under Settings › Extensions (wireframe E4). */
export interface SettingsPageSpec {
  component: SlotComponent;
}

/** A command: found in the ⌘K finder, bindable in Settings › Hotkeys (wireframe E6). */
export interface CommandSpec {
  /** Unique within the extension. */
  id: string;
  title: string;
  run: () => unknown;
  /**
   * The key(s) it asks for. A key the app already uses is not taken: the command is left
   * unbound and Settings › Hotkeys shows the clash. N and ⇧N are kept free for extensions.
   */
  keys?: KeyBinding[];
}

export interface ExtensionUi {
  sidebarTab(spec: SidebarTabSpec): Dispose;
  toolbarItem(spec: ToolbarItemSpec): ToolbarItemHandle;
  view(spec: ViewSpec): Dispose;
  /** Open one of this extension's views (closing any other full-window view). */
  openView(id: string): void;
  /** Close the full-window view, if this extension's is open. */
  closeView(): void;
  settingsPage(spec: SettingsPageSpec): Dispose;
  /** Components drawn the app's way. */
  components: {
    Button: ComponentType<{ onClick?: () => void; disabled?: boolean; primary?: boolean; title?: string; children?: ReactNode }>;
    /** A modal dialog under the app's modal rules (role="dialog", Esc closes). */
    Dialog: ComponentType<{ title: string; onClose: () => void; children?: ReactNode }>;
  };
}

export interface ExtensionCommands {
  register(spec: CommandSpec): Dispose;
  /** Run one of this extension's commands. */
  execute(id: string): void;
}

/** What the renderer part's activate() receives. */
export interface RendererExtensionContext extends ExtensionContextBase {
  /** The extension's name (its manifest's). */
  name: string;
  ui: ExtensionUi;
  commands: ExtensionCommands;
}

/**
 * A part's exports. activate() may be async; if it throws, rejects or takes longer than 10 s
 * the extension is Inactive, with the error as its reason. deactivate() runs when the user
 * disables the extension, when its other part fails, and at quit (the main part) or when the
 * window goes away (the renderer part).
 */
export interface ExtensionPart<Ctx> {
  activate: (ext: Ctx) => unknown;
  deactivate?: () => unknown;
}

/** main.js: a CommonJS module exporting these (module.exports = { activate, deactivate }). */
export type MainPart = ExtensionPart<MainExtensionContext>;

/** renderer.js: an ES module exporting these (export function activate…). */
export type RendererPart = ExtensionPart<RendererExtensionContext>;
