/** Extension state as the main process reports it to the renderer (extension framework X1). */

/**
 * - active: loaded and started (both parts, once the renderer has started its part)
 * - inactive: valid, but did not start — the reason says why (it threw, timed out)
 * - refused: the app would not load it — invalid manifest, missing file, incompatible API
 * - disabled: turned off by the user (Settings › Extensions)
 */
export type ExtensionState = 'active' | 'inactive' | 'refused' | 'disabled';

export interface ExtensionSummary {
  /** The extension's id, or for one refused before its id was known, its folder name. */
  key: string;
  /** Null when the manifest could not be read. */
  id: string | null;
  name: string;
  version?: string;
  publisher?: string;
  description?: string;
  state: ExtensionState;
  reason?: string;
  /** For an active extension: the URL its renderer part loads from. */
  rendererUrl?: string;
}
