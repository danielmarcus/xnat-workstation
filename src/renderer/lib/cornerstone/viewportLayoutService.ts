/**
 * Viewport Layout Service — SKELETON (Phase 0 scaffolding, annotation rebuild).
 *
 * The eventual home for the multi-viewport grid (rows × cols), per-panel
 * orientation, and crosshair sync. It overlaps with viewerStore.ts today; the
 * rebuild will consolidate layout ownership here. For this slice it is a small,
 * self-contained holder for a grid descriptor plus initialize/dispose, with NO
 * Cornerstone or viewerStore wiring (additive, inert, gated behind multiviewport).
 *
 * Follows the singleton-module + initialize()/dispose() pattern of
 * annotationService.ts.
 */

export interface ViewportLayout {
  rows: number;
  cols: number;
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
