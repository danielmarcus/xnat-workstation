/**
 * The contour drawing tools' settings (Live Wire, Spline — branch 6) for the toolbox's
 * controls. The settings live in lib/cornerstone/tools/contourToolSettings, where the
 * Cornerstone tool classes read them; this is the components' only route to them.
 */
import { useSyncExternalStore } from 'react';
import {
  getContourToolSettings,
  setLivewireSettings,
  subscribeContourToolSettings,
  type LivewireSettings,
} from '../lib/cornerstone/tools/contourToolSettings';

export interface ContourToolSettingsModel {
  livewire: LivewireSettings;
  setLivewire(patch: Partial<LivewireSettings>): void;
}

export function useContourToolSettings(): ContourToolSettingsModel {
  const settings = useSyncExternalStore(subscribeContourToolSettings, getContourToolSettings);
  return { livewire: settings.livewire, setLivewire: setLivewireSettings };
}
