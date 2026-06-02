/**
 * cursorMetricsStore — per-viewport cursor read-out for the overlay
 * fields added in spec §9.1 (`cursorHU`, `cursorCoords`).
 *
 * Map of panelId → metrics. A panel's entry is set on mousemove
 * inside its viewport element and cleared on mouseleave. The
 * `cursorTracker` service (lib/cornerstone/cursorTracker.ts) drives
 * the writes; the `ViewportOverlay` consumes via the hook below.
 *
 * Pure Zustand store; no React imports. Equality is intentionally
 * `Object.is` per slot — callers re-render on every mousemove for
 * the panel they care about.
 */
import { create } from 'zustand';

export interface CursorMetrics {
  /** Canvas-space coordinates (px) within the viewport element. */
  canvasX: number;
  canvasY: number;
  /** Patient-space LPS coordinates (mm) — null when the conversion isn't available. */
  world: [number, number, number] | null;
  /** Hounsfield units (CT) or signal intensity (other modalities). null when unavailable. */
  hu: number | null;
  /** Source modality (e.g. 'CT', 'MR') — drives whether to label the value "HU" or just the raw intensity. */
  modality: string | null;
}

interface CursorMetricsStore {
  /** panelId → metrics. Missing entry = not hovering. */
  metrics: Record<string, CursorMetrics | undefined>;
  set: (panelId: string, value: CursorMetrics) => void;
  clear: (panelId: string) => void;
  clearAll: () => void;
}

export const useCursorMetricsStore = create<CursorMetricsStore>((set) => ({
  metrics: {},
  set: (panelId, value) =>
    set((state) => ({ metrics: { ...state.metrics, [panelId]: value } })),
  clear: (panelId) =>
    set((state) => {
      if (state.metrics[panelId] === undefined) return state;
      const next = { ...state.metrics };
      delete next[panelId];
      return { metrics: next };
    }),
  clearAll: () => set({ metrics: {} }),
}));

/** Lightweight selector for the overlay — returns the entry or null. */
export function useCursorMetricsForPanel(panelId: string): CursorMetrics | null {
  return useCursorMetricsStore((s) => s.metrics[panelId] ?? null);
}
