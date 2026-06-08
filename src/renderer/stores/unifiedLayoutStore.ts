/**
 * Unified layout store (Phase 1) — the active viewport layout for the new
 * (multiviewport) path. Pure reactive state (zustand only); the layout → panel
 * specs mapping is computed by viewportLayoutService and useViewportLayout
 * bridges the two for components. (§2: stores import nothing outward.)
 *
 * Two layout families (per frozen mockup §10 + requirements I2):
 *  - GENERIC GRID (`kind: 'grid'`, rows×cols): N independent panels, each loads
 *    its own scan (multi-scan comparison). This is what the toolbar Layout
 *    dropdown drives (1×1 / 1×2 / 2×1 / 2×2 / custom).
 *  - MPR (`kind: 'mpr-2x2'`): ONE scan reformatted axial/sag/cor (+axial) across
 *    4 panels sharing one volume. A distinct preset reached via openInMpr, NOT
 *    the Layout dropdown.
 */
import { create } from 'zustand';

/** Presets settable by name (the e2e hook + openInMpr). */
export type LayoutPreset = 'single' | 'mpr-2x2';

/** The active unified layout. */
export type UnifiedLayout =
  | { kind: 'single' }
  | { kind: 'mpr-2x2' }
  | { kind: 'grid'; rows: number; cols: number };

interface UnifiedLayoutStore {
  layout: UnifiedLayout;
  /** Set a named preset (single | mpr-2x2). */
  setPreset: (preset: LayoutPreset) => void;
  /** Set a generic rows×cols grid of independent panels (clamped to >= 1). */
  setGrid: (rows: number, cols: number) => void;
}

function clampDim(v: number): number {
  return Number.isFinite(v) ? Math.max(1, Math.floor(v)) : 1;
}

export const useUnifiedLayoutStore = create<UnifiedLayoutStore>((set) => ({
  layout: { kind: 'single' },
  setPreset: (preset) => set({ layout: { kind: preset } }),
  setGrid: (rows, cols) => set({ layout: { kind: 'grid', rows: clampDim(rows), cols: clampDim(cols) } }),
}));
