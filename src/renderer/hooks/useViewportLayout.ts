/**
 * useViewportLayout — bridges the active unified layout (unifiedLayoutStore) to
 * the panel specs + grid dimensions for the unified grid. Hook layer: reads a
 * store + calls a service (§2).
 *
 * Resolves each panel's `sourcePanelId` (which panel's imageIds it renders):
 *  - generic grid → each panel sources its OWN id (independent multi-scan panels)
 *  - single / MPR → every panel sources 'panel_0' (one shared volume, reformatted)
 */
import { useUnifiedLayoutStore } from '../stores/unifiedLayoutStore';
import { viewportLayoutService } from '../lib/cornerstone/viewportLayoutService';
import type { MPRPlane } from '@shared/types/viewer';

/** The 3D panel of the “2D + 3D QC” layout. */
export const QC_3D_PANEL_ID = 'panel_qc3d';

export interface ResolvedPanel {
  panelId: string;
  orientation: MPRPlane;
  sourcePanelId: string;
  /** Open in the scan's NATIVE plane (single / generic grid). False only for the
   *  MPR preset, whose panels are fixed to their designated ortho planes. */
  preferNative: boolean;
  /** Render as a 3D volume rendering instead of a slice (C5c — MPR's 4th slot). */
  render3d: boolean;
  /** Fills the whole viewport area, over the other panels (the QC layout's expanded 3D view). */
  expanded?: boolean;
}

export function useViewportLayout(): {
  layout: ReturnType<typeof useUnifiedLayoutStore.getState>['layout'];
  setPreset: ReturnType<typeof useUnifiedLayoutStore.getState>['setPreset'];
  setGrid: ReturnType<typeof useUnifiedLayoutStore.getState>['setGrid'];
  panels: ResolvedPanel[];
  grid: { rows: number; cols: number };
} {
  const layout = useUnifiedLayoutStore((s) => s.layout);
  const setPreset = useUnifiedLayoutStore((s) => s.setPreset);
  const setGrid = useUnifiedLayoutStore((s) => s.setGrid);

  let panels: ResolvedPanel[];
  let grid: { rows: number; cols: number };

  if (layout.kind === 'qc-3d') {
    // “2D + 3D QC”: the source panel keeps its id (and so its viewport state); the 3D
    // view beside it renders the same scan.
    panels = [
      { panelId: layout.source, orientation: 'AXIAL', sourcePanelId: layout.source, preferNative: true, render3d: false },
      { panelId: QC_3D_PANEL_ID, orientation: 'CORONAL', sourcePanelId: layout.source, preferNative: false, render3d: true, expanded: !!layout.expanded },
    ];
    grid = { rows: 1, cols: 2 };
  } else if (layout.kind === 'grid') {
    // Independent panels — each sources its own imageIds (multi-scan). Each opens
    // in its scan's native plane.
    panels = viewportLayoutService.gridPanels(layout.rows, layout.cols).map((p) => ({
      panelId: p.panelId,
      orientation: p.orientation,
      sourcePanelId: p.sourcePanelId ?? p.panelId,
      preferNative: true,
      render3d: false,
    }));
    grid = { rows: layout.rows, cols: layout.cols };
  } else {
    // single | mpr-2x2 — all panels reformat ONE scan (sourced from panel_0).
    // Single opens in the scan's native plane; MPR pins each panel to its preset.
    const preset = layout.kind;
    const isMpr = preset === 'mpr-2x2';
    panels = viewportLayoutService.getPresetPanels(preset).map((p) => ({
      panelId: p.panelId,
      orientation: p.orientation,
      sourcePanelId: 'panel_0',
      preferNative: !isMpr,
      render3d: p.render3d === true,
    }));
    const g = viewportLayoutService.presetGrid(preset);
    grid = { rows: g.rows, cols: g.cols };
  }

  return { layout, setPreset, setGrid, panels, grid };
}
