/**
 * Undo Service — SKELETON (Phase 0 scaffolding, annotation rebuild).
 *
 * The eventual home for undo/redo, factored out of segmentationService.ts
 * (which today owns the Cornerstone DefaultHistoryMemo wiring). For this slice
 * it is a thin, INERT facade: it does NOT attach to Cornerstone's history, so
 * it cannot double-handle alongside the existing segmentationService undo path.
 * canUndo/canRedo report false and undo/redo are no-ops until the extraction
 * happens in a later Phase-0 pass (see docs/multiviewport-annotation-design.md
 * and the decomposition order in the plan).
 *
 * Follows the singleton-module + initialize()/dispose() pattern of
 * annotationService.ts.
 */

let initialized = false;

export const undoService = {
  /** Begin tracking. Idempotent. */
  initialize(): void {
    if (initialized) return;
    initialized = true;
    console.log('[undoService] Initialized (skeleton)');
  },

  /** Whether an undo is available. Placeholder until extraction. */
  canUndo(): boolean {
    return false;
  },

  /** Whether a redo is available. Placeholder until extraction. */
  canRedo(): boolean {
    return false;
  },

  /** Undo the last edit. No-op placeholder until extraction. */
  undo(): void {
    /* TODO(annotation-rebuild): extract from segmentationService.ts */
  },

  /** Redo the last undone edit. No-op placeholder until extraction. */
  redo(): void {
    /* TODO(annotation-rebuild): extract from segmentationService.ts */
  },

  /** Test/lifecycle helper. */
  isInitialized(): boolean {
    return initialized;
  },

  /** Stop tracking. Idempotent. */
  dispose(): void {
    if (!initialized) return;
    initialized = false;
    console.log('[undoService] Disposed');
  },
};
