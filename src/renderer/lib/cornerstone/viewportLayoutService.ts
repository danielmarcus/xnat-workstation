/**
 * Viewport Layout Service — SKELETON (Phase 0 scaffolding, annotation rebuild).
 *
 * The eventual home for the multi-viewport grid (rows × cols), per-panel
 * orientation, and crosshair sync. It overlaps with viewerStore.ts today; the
 * rebuild will consolidate layout ownership here. For this slice it is a small,
 * self-contained holder for a grid descriptor plus initialize/dispose, with NO
 * Cornerstone or viewerStore wiring (additive, inert).
 *
 * Follows the singleton-module + initialize()/dispose() pattern of
 * annotationService.ts.
 */

import type { MPRPlane } from '@shared/types/viewer';

export interface ViewportLayout {
  rows: number;
  cols: number;
}

/** Layout presets for the unified viewport grid (Phase 1). */
export type LayoutPreset = 'single' | 'mpr-2x2';

export interface PanelSpec {
  panelId: string;
  /** Reformatted plane for the (volume) panel. */
  orientation: MPRPlane;
  /**
   * Which panel's imageIds this panel renders. For shared layouts (single, MPR)
   * every panel sources 'panel_0' (one volume, reformatted). For a generic grid,
   * each panel sources its OWN id (independent multi-scan panels). Optional on the
   * preset helpers (filled by useViewportLayout); always set by gridPanels.
   */
  sourcePanelId?: string;
}

const DEFAULT_LAYOUT: ViewportLayout = { rows: 1, cols: 1 };

let initialized = false;
let layout: ViewportLayout = { ...DEFAULT_LAYOUT };

function sanitizeDimension(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
}

export const viewportLayoutService = {
  /** Begin tracking. Idempotent. */
  initialize(): void {
    if (initialized) return;
    initialized = true;
    console.log('[viewportLayoutService] Initialized (skeleton)');
  },

  /** Current grid layout (defensive copy). */
  getLayout(): ViewportLayout {
    return { ...layout };
  },

  /** Set the grid layout; dimensions are clamped to >= 1. */
  setLayout(next: ViewportLayout): void {
    layout = {
      rows: sanitizeDimension(next.rows),
      cols: sanitizeDimension(next.cols),
    };
  },

  /** Total number of panels implied by the current layout. */
  getPanelCount(): number {
    return layout.rows * layout.cols;
  },

  /**
   * Panel specs for a layout preset — the unified grid renders one Viewport per
   * spec, all sharing the scan's single volume (P1.1) with per-panel orientation.
   * MPR-2×2: axial + sagittal + coronal + a fourth (axial) slot. (The design's
   * 3D-volume-rendering slot is a later refinement.)
   */
  getPresetPanels(preset: LayoutPreset): PanelSpec[] {
    if (preset === 'mpr-2x2') {
      return [
        { panelId: 'panel_0', orientation: 'AXIAL' },
        { panelId: 'panel_1', orientation: 'SAGITTAL' },
        { panelId: 'panel_2', orientation: 'CORONAL' },
        { panelId: 'panel_3', orientation: 'AXIAL' },
      ];
    }
    return [{ panelId: 'panel_0', orientation: 'AXIAL' }];
  },

  /** Grid dimensions (cols × rows) for a preset. */
  presetGrid(preset: LayoutPreset): { cols: number; rows: number } {
    return preset === 'mpr-2x2' ? { cols: 2, rows: 2 } : { cols: 1, rows: 1 };
  },

  /**
   * Panel specs for a generic rows×cols grid: N = rows*cols INDEPENDENT panels,
   * each axial and sourcing its OWN imageIds (multi-scan comparison — unlike MPR,
   * panels do NOT share one volume). Dimensions clamped to >= 1.
   */
  gridPanels(rows: number, cols: number): PanelSpec[] {
    const r = Math.max(1, Math.floor(rows) || 1);
    const c = Math.max(1, Math.floor(cols) || 1);
    return Array.from({ length: r * c }, (_, i) => ({
      panelId: `panel_${i}`,
      orientation: 'AXIAL' as MPRPlane,
      sourcePanelId: `panel_${i}`,
    }));
  },

  /** Test/lifecycle helper. */
  isInitialized(): boolean {
    return initialized;
  },

  /** Reset to the default layout and stop tracking. Idempotent. */
  dispose(): void {
    layout = { ...DEFAULT_LAYOUT };
    if (!initialized) return;
    initialized = false;
    console.log('[viewportLayoutService] Disposed');
  },
};
