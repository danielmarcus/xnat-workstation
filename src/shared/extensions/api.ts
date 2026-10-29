/**
 * The extension API as extensions see it (extension framework — docs/extension-framework.md):
 * what each part's activate() receives, and what each part exports. The single source for the
 * host (main and renderer) and the SDK, @nrgxnat/workstation-extension-api. It grows slice by
 * slice — X2 adds UI slots and commands, X3 XNAT and app state, X4 annotations, X5 storage and
 * files, X6 the licence gate — each as a minor version (EXTENSION_API_VERSION).
 */

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

/** What the renderer part's activate() receives. */
export type RendererExtensionContext = ExtensionContextBase;

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
