/**
 * Viewport Layout Service — layout presets for the standard viewport grid.
 *
 * The `ViewportGrid` is the single rendering surface; this service tells
 * App-level wiring which preset to apply (panel count, panel orientations,
 * auto-link). Per design §1.3 / §3.
 *
 * Built-in presets:
 *   - "1×1"             — single panel
 *   - "1×2", "2×1"      — two panels
 *   - "2×2"             — four panels, independent
 *   - "mpr-2×2"         — 2×2 with axial / sagittal / coronal volume panels +
 *                         3D volume rendering panel in the 4th slot
 *   - "custom"          — user-arranged grid, geometry stored on the layout
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

// ─── Built-in preset definitions ─────────────────────────────────

const BUILTIN_PRESETS: LayoutPreset[] = [
  {
    id: '1x1',
    rows: 1,
    cols: 1,
    slots: [],
    autoLink: false,
  },
  {
    id: '1x2',
    rows: 1,
    cols: 2,
    slots: [],
    autoLink: false,
  },
  {
    id: '2x1',
    rows: 2,
    cols: 1,
    slots: [],
    autoLink: false,
  },
  {
    id: '2x2',
    rows: 2,
    cols: 2,
    slots: [],
    autoLink: false,
  },
  {
    id: 'mpr-2x2',
    rows: 2,
    cols: 2,
    slots: [
      { index: 0, orientation: 'AXIAL' },
      { index: 1, orientation: 'SAGITTAL' },
      { index: 2, orientation: 'CORONAL' },
      { index: 3, orientation: '3d' },
    ],
    // Per design §1.3: MPR preset auto-links panels of the same source scan
    // via crosshair sync. The fourth slot (3D rendering) participates in
    // sync but is read-only on the camera side.
    autoLink: true,
  },
  {
    id: 'custom',
    rows: 0,
    cols: 0,
    slots: [],
    autoLink: false,
  },
];

let currentPresetId: LayoutPresetId | null = null;

export const viewportLayoutService: ViewportLayoutService = {
  listPresets() {
    // Return clones so callers can't mutate the canonical definitions.
    return BUILTIN_PRESETS.map((preset) => ({
      ...preset,
      slots: preset.slots.map((slot) => ({ ...slot })),
    }));
  },

  getPreset(id) {
    const preset = BUILTIN_PRESETS.find((p) => p.id === id);
    if (!preset) return null;
    return {
      ...preset,
      slots: preset.slots.map((slot) => ({ ...slot })),
    };
  },

  applyPreset(id) {
    const preset = BUILTIN_PRESETS.find((p) => p.id === id);
    if (!preset) {
      throw new Error(`[viewportLayoutService] Unknown preset: ${id}`);
    }
    // Record the preset id. App.tsx's `handleToggleMPR` reads it to
    // decide whether the MPR toggle should enter or exit; viewportGrid
    // reads `viewerStore.layoutConfig` directly (the layout shape is set
    // separately via `setLayout`).
    currentPresetId = id;
  },

  getCurrentPresetId() {
    return currentPresetId;
  },
};

/** Test-only: reset the recorded preset to null. */
export function _resetCurrentPreset(): void {
  currentPresetId = null;
}
