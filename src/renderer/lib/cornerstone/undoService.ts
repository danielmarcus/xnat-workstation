/**
 * Undo Service — per-container undo / redo stack management.
 *
 * Per requirement A8 and design §2.7. Domain code (drawing tools, member
 * lifecycle, approval changes) creates HistoryEntry instances and pushes
 * them via `record`. Keyboard shortcuts and the menu invoke `undo`/`redo`
 * which apply the entry's invert/apply closures.
 *
 * Save is **not** an undo barrier. External-change reload (E3 / H6)
 * clears the affected container's history.
 *
 * See docs/multiviewport-annotation-design.md §4.2.
 *
 * Phase 0: skeleton with method shapes only. Implementation lands in
 * Phase 2 when consumers replace scattered Cornerstone HistoryMemo usage.
 */
import type { ContainerHistory, HistoryEntry } from '../../types/annotation';

export interface UndoService {
  /** Push a new entry onto the active container's undo stack; clears redo. */
  record(containerId: string, entry: HistoryEntry): void;

  /**
   * Undo one entry on the given container's stack. Returns the entry that
   * was undone, or null if the stack was empty.
   */
  undo(containerId: string): HistoryEntry | null;

  /**
   * Redo one entry. Returns the entry that was redone, or null if the
   * redo stack was empty.
   */
  redo(containerId: string): HistoryEntry | null;

  /** Whether undo is available for a container. */
  canUndo(containerId: string): boolean;

  /** Whether redo is available for a container. */
  canRedo(containerId: string): boolean;

  /**
   * Clear a container's history. Called by the transport layer on
   * external-change reload (E3 / H6) and by container delete.
   */
  clear(containerId: string): void;

  /**
   * Read the full history for a container. Used by tests and the optional
   * "review history" UX. Returns null if no history exists.
   */
  getHistory(containerId: string): ContainerHistory | null;
}

function notImplemented(method: string): never {
  throw new Error(`[undoService] ${method} not yet implemented (multi-viewport rewrite is in Phase 0)`);
}

export const undoService: UndoService = {
  record: () => notImplemented('record'),
  undo: () => notImplemented('undo'),
  redo: () => notImplemented('redo'),
  canUndo: () => notImplemented('canUndo'),
  canRedo: () => notImplemented('canRedo'),
  clear: () => notImplemented('clear'),
  getHistory: () => notImplemented('getHistory'),
};
