/**
 * Viewport Layout Service — layout presets for the standard viewport grid.
 *
 * Replaces the parallel `MPRViewportGrid` ↔ `ViewportGrid` switch with a
 * layout-preset selector on a single grid. Per design §1.3 / §3.
 *
 * Built-in presets (v1):
 *   - "1×1"             — single panel
 *   - "1×2", "2×1"      — two panels
 *   - "2×2"             — four panels, independent
 *   - "MPR-2×2"         — 2×2 with axial / sagittal / coronal volume panels +
 *                         3D volume rendering panel in the 4th slot
 *   - "custom"          — user-arranged grid, geometry stored on the layout
 *
 * Phase 0: skeleton. Layout-preset rendering integrates in Phase 1 alongside
 * the viewport unification work.
 */
import type { ViewportOrientation } from '@shared/types/viewer';

export type LayoutPresetId = '1x1' | '1x2' | '2x1' | '2x2' | 'mpr-2x2' | 'custom';

export interface LayoutPanelSlot {
  /** Index in row-major order. */
  index: number;
  /** Orientation hint for this slot; viewports are still chosen by stack-eligibility. */
  orientation: ViewportOrientation | '3d' | 'free';
}

export interface LayoutPreset {
  id: LayoutPresetId;
  rows: number;
  cols: number;
  /** Pre-defined slots for opinionated presets (MPR-2×2). Empty for custom layouts. */
  slots: LayoutPanelSlot[];
  /** True if all panels in this preset should auto-link via crosshair sync (per source scan + FoR). */
  autoLink: boolean;
}

export interface ViewportLayoutService {
  /** Read all built-in presets in display order. */
  listPresets(): LayoutPreset[];

  /** Look up a preset by id, or null if unknown. */
  getPreset(id: LayoutPresetId): LayoutPreset | null;

  /**
   * Apply a preset to the active grid. Routes through viewportService /
   * containerService to instantiate the right viewports.
   */
  applyPreset(id: LayoutPresetId): void;

  /** Currently applied preset id, or null if a custom layout is active. */
  getCurrentPresetId(): LayoutPresetId | null;
}

function notImplemented(method: string): never {
  throw new Error(`[viewportLayoutService] ${method} not yet implemented (multi-viewport rewrite is in Phase 0)`);
}

export const viewportLayoutService: ViewportLayoutService = {
  listPresets: () => notImplemented('listPresets'),
  getPreset: () => notImplemented('getPreset'),
  applyPreset: () => notImplemented('applyPreset'),
  getCurrentPresetId: () => notImplemented('getCurrentPresetId'),
};
