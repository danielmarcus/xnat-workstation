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

// ─── X3: XNAT, the channel between the parts, navigation, app state ─────────

/** The signed-in user, and the XNAT they are signed in to. */
export interface XnatUser {
  serverUrl: string;
  username: string;
}

export interface XnatRequestInit {
  method?: 'GET' | 'PUT' | 'POST' | 'DELETE';
  /** Query parameters, encoded for you. */
  query?: Record<string, string>;
  body?: string | Uint8Array;
  /** The body's Content-Type. */
  contentType?: string;
}

/** An XNAT response. HTTP errors are responses (check `ok`), not exceptions. */
export interface XnatResponse {
  status: number;
  ok: boolean;
  contentType: string;
  /** The body as text (UTF-8). */
  text: string;
}

export interface XnatResourceFile {
  name: string;
  size: number;
  /** Its path on the server, usable with request(). */
  uri: string;
}

/**
 * XNAT as the signed-in user (R4). Requests go through the app's own session — the extension
 * never sees credentials or cookies — so XNAT's project roles decide what succeeds (design
 * point 8). Paths are server-relative and start with /data/ or /xapi/. A call made while no
 * one is signed in rejects with "Not signed in to XNAT".
 */
export interface ExtensionXnat {
  user(): Promise<XnatUser | null>;
  request(path: string, init?: XnatRequestInit): Promise<XnatResponse>;
  /** GET with format=json; rejects on an HTTP error. */
  getJson<T = unknown>(path: string, query?: Record<string, string>): Promise<T>;
  /** What the signed-in user may do in a project. */
  permissions(projectId: string): Promise<{ read: boolean; write: boolean }>;
  /** The files of a resource, e.g. `/data/experiments/XNAT_E00001/resources/NOTES`. */
  resourceFiles(resourcePath: string): Promise<XnatResourceFile[]>;
}

/** The main part's end of the channel between an extension's two parts (design point 2). */
export interface MainChannel {
  /** Answer the renderer part's requests. One handler; a second replaces the first. */
  handle(handler: (message: unknown) => unknown): Dispose;
  /** Send the renderer part a message (it receives it with onMessage). */
  post(message: unknown): void;
}

/** The renderer part's end of the channel. Messages must be structured-cloneable. */
export interface RendererChannel {
  /** Ask the main part; resolves with what its handler returns (rejects if it throws). */
  request(message: unknown): Promise<unknown>;
  onMessage(listener: (message: unknown) => void): Dispose;
}

/** What the main part's activate() receives. */
export interface MainExtensionContext extends ExtensionContextBase {
  xnat: ExtensionXnat;
  channel: MainChannel;
}

/** An XNAT session, as navigation names it. */
export interface XnatSessionRef {
  projectId: string;
  subjectId: string;
  sessionId: string;
  /** Shown in the browser while it opens; looked up when absent. */
  sessionLabel?: string;
  subjectLabel?: string;
}

/** The XNAT session on screen. */
export interface OpenSession {
  projectId: string;
  subjectId: string;
  sessionId: string;
  sessionLabel: string;
}

export interface ExtensionViewer {
  /** The XNAT session on screen, or null (none, or local files). */
  session(): OpenSession | null;
  /** The active viewport (the one tools and loads target). */
  activeViewport(): { id: string } ;
  /**
   * Open a session exactly as the XNAT browser does — hanging protocol, annotation auto-load,
   * and the unsaved-changes prompt — and learn how it ended: opened, cancelled (the user chose
   * Cancel at the prompt), or failed (with the reason).
   */
  openSession(session: XnatSessionRef, options?: { scanId?: string }): Promise<{ outcome: 'opened' | 'cancelled' | 'failed'; reason?: string }>;
  /** Show a project, subject or session in the XNAT browser without opening it. */
  revealInBrowser(target: { projectId: string; subjectId?: string; sessionId?: string; subjectLabel?: string; sessionLabel?: string }): void;
}

/** An annotation container (a SEG, RTSTRUCT or SR) as extensions see it. */
export interface AnnotationInfo {
  id: string;
  kind: 'SEG' | 'RTSTRUCT' | 'SR';
  label: string;
  /** Unsaved edits. */
  dirty: boolean;
  /** Its scan on XNAT, once saved there. */
  xnatScanId?: string;
  /** Approved containers are edit-locked until the approval is revoked (in the panel). */
  approved: boolean;
  /** The version of its last save or load, for save-conflict detection. */
  versionToken?: string;
  members: Array<{ id: string; label: string }>;
}

/** What `create()` makes: the kind, its label, and its members' names and colours. */
export interface AnnotationTemplate {
  kind: 'SEG' | 'RTSTRUCT' | 'SR';
  label?: string;
  /** SEG / RTSTRUCT only: a Measurement set's members are drawn, not created. */
  members?: Array<{ label: string; color?: [number, number, number] }>;
}

/**
 * Annotations, through the Annotations panel's own actions (R7, X4): every rule the panel
 * applies — approval locks, how a create starts, the save and its conflict detection — applies
 * here too.
 */
export interface ExtensionAnnotations {
  list(): AnnotationInfo[];
  /** The active container and member — the draw target — or null. */
  active(): { annotation: AnnotationInfo; memberId: string } | null;
  /** Make a member active, as clicking its row does (default: the container's first). */
  select(containerId: string, memberId?: string): void;
  /** Create a container on the active viewport from a template; it becomes active. */
  create(template: AnnotationTemplate): Promise<AnnotationInfo>;
  /** Save now, through the normal transport. An approved container is refused, as in the panel. */
  save(containerId: string): Promise<{ outcome: 'saved' | 'conflict' | 'failed'; reason?: string; versionToken?: string }>;
  /** Open an annotation scan (SEG / RTSTRUCT / SR) of a session, as clicking it in the browser does. */
  openScan(session: XnatSessionRef, scanId: string): Promise<{ outcome: 'opened' | 'cancelled' | 'failed'; reason?: string }>;
}

export type ExtensionEventName =
  | 'signedIn'
  | 'signedOut'
  | 'sessionChanged'
  | 'activeViewportChanged'
  | 'activeAnnotationChanged'
  | 'annotationsChanged';

export interface ExtensionEvents {
  /** Called after the change; read the new state with the getters. */
  on(event: ExtensionEventName, listener: () => void): Dispose;
}

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
  xnat: ExtensionXnat;
  channel: RendererChannel;
  viewer: ExtensionViewer;
  annotations: ExtensionAnnotations;
  events: ExtensionEvents;
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
