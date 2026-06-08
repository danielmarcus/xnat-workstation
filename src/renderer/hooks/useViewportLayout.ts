/**
 * useViewportLayout — bridges the active layout preset (unifiedLayoutStore) to
 * the panel specs + grid dimensions computed by viewportLayoutService, for the
 * unified grid. Hook layer: reads a store + calls a service (§2).
 */
import { useUnifiedLayoutStore } from '../stores/unifiedLayoutStore';
import { viewportLayoutService } from '../lib/cornerstone/viewportLayoutService';

export function useViewportLayout() {
  const preset = useUnifiedLayoutStore((s) => s.preset);
  const setPreset = useUnifiedLayoutStore((s) => s.setPreset);
  return {
    preset,
    setPreset,
    panels: viewportLayoutService.getPresetPanels(preset),
    grid: viewportLayoutService.presetGrid(preset),
  };
}
