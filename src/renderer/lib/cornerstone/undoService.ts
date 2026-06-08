/**
 * Undo Service (Phase 1) — viewport-independent undo/redo for the unified path.
 *
 * Delegates to Cornerstone's GLOBAL history ring (`DefaultHistoryMemo`). Because
 * the history is global — not bound to any viewport — an edit (e.g. a brush
 * stroke) can be undone even after the panel it was drawn on has been closed
 * (acceptance signal 7). Edits push memos automatically when a tool finishes
 * (`baseTool.doneEditMemo()`), so this service only drives undo/redo + reports
 * availability.
 *
 * Phase-1 scope: the minimal undo needed for signals 6/7. The richer lock-aware
 * history (segmentationService) is reconciled later; on the unified (flag-on)
 * path this is the active undo, so there is no double-handling.
 *
 * Follows the singleton-module + initialize()/dispose() pattern.
 */
import { utilities as csUtilities } from '@cornerstonejs/core';

interface HistoryMemoRing {
  undo?: () => void;
  redo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

/** Lazily resolve the global history ring (absent under the unit-test core mock). */
function getMemoRing(): HistoryMemoRing | undefined {
  return (csUtilities as unknown as { HistoryMemo?: { DefaultHistoryMemo?: HistoryMemoRing } })
    .HistoryMemo?.DefaultHistoryMemo;
}

let initialized = false;

export const undoService = {
  /** Begin tracking. Idempotent. */
  initialize(): void {
    if (initialized) return;
    initialized = true;
    console.log('[undoService] Initialized');
  },

  /** Whether an undo is available in the global history. */
  canUndo(): boolean {
    return !!getMemoRing()?.canUndo;
  },

  /** Whether a redo is available in the global history. */
  canRedo(): boolean {
    return !!getMemoRing()?.canRedo;
  },

  /** Undo the last edit (viewport-independent — works after the source panel closed). */
  undo(): void {
    getMemoRing()?.undo?.();
  },

  /** Redo the last undone edit. */
  redo(): void {
    getMemoRing()?.redo?.();
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
