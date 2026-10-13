/**
 * Settings of the contour drawing tools — Live Wire and Spline (SegWorks parity branch 6,
 * docs/segworks-parity.md §10) — shared by the Structure tools and Contour Fill's boundary
 * modes.
 *
 * Plain module state with a subscription, not a store: the tool classes are registered
 * with Cornerstone during init and read these at the moment they need them, so they stay
 * free of the store / service graph (as semiAutoBridge does for the Smart tools). The
 * toolbox's controls read and write them through useContourToolSettings.
 */
import { DEFAULT_LIVEWIRE_COST, type LivewireCostOptions } from '../../segmentation/contours/livewireCost';

export interface LivewireSettings extends LivewireCostOptions {
  /** Basic = Cornerstone's own cost; Advanced = the weighted cost of #75–79. */
  mode: 'basic' | 'advanced';
  /** How close (screen px) a click must be to the first anchor to close the contour (#80). */
  closeTolerancePx: number;
  /** Chaikin passes applied to the closed contour when it is committed (#81); 0 = none. */
  commitSmoothing: number;
}

export const DEFAULT_LIVEWIRE_SETTINGS: LivewireSettings = {
  ...DEFAULT_LIVEWIRE_COST,
  mode: 'basic',
  closeTolerancePx: 10, // Cornerstone's own click distance
  commitSmoothing: 0,
};

export interface ContourToolSettings {
  livewire: LivewireSettings;
}

let settings: ContourToolSettings = { livewire: { ...DEFAULT_LIVEWIRE_SETTINGS } };
const listeners = new Set<() => void>();

export function getContourToolSettings(): ContourToolSettings {
  return settings;
}

export function setLivewireSettings(patch: Partial<LivewireSettings>): void {
  settings = { ...settings, livewire: { ...settings.livewire, ...patch } };
  for (const l of listeners) l();
}

export function subscribeContourToolSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Back to the defaults (E2E isolation and "Reset"). */
export function resetContourToolSettings(): void {
  settings = { livewire: { ...DEFAULT_LIVEWIRE_SETTINGS } };
  for (const l of listeners) l();
}
