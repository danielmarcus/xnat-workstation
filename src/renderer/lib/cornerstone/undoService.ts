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
 * Phase 2.7a: implementation. The record path is wired from
 * `segmentationService/historyMemo.ts` — when Cornerstone tools push a
 * memo to `DefaultHistoryMemo` and the memo has a `segmentationId` that
 * resolves through `containerBridge` to a containerId, we mirror it
 * here as a `HistoryEntry`. The dispatch path swap (segmentationService.
 * undo/redo → undoService.undo/redo) lands in Phase 2.7b.
 *
 * Concurrency: `record` is synchronous and lock-free. Underlying tool
 * pushes are also synchronous from Cornerstone's perspective — they
 * happen on the main thread inside event handlers. No racing risk.
 */
import {
  UNDO_HISTORY_LIMIT,
  type ContainerHistory,
  type HistoryEntry,
} from '../../types/annotation';

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

// ─── Module state ────────────────────────────────────────────────

const histories = new Map<string, ContainerHistory>();

function getOrCreate(containerId: string): ContainerHistory {
  let h = histories.get(containerId);
  if (!h) {
    h = { containerId, undoStack: [], redoStack: [] };
    histories.set(containerId, h);
  }
  return h;
}

function safeInvoke(label: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.warn(`[undoService] ${label} threw`, err);
  }
}

// ─── Public surface ──────────────────────────────────────────────

export const undoService: UndoService = {
  record(containerId, entry) {
    if (!containerId || !entry) return;
    const h = getOrCreate(containerId);
    h.undoStack.push(entry);
    // Cap depth at UNDO_HISTORY_LIMIT — drop oldest, never newest (per §A8).
    if (h.undoStack.length > UNDO_HISTORY_LIMIT) {
      h.undoStack.splice(0, h.undoStack.length - UNDO_HISTORY_LIMIT);
    }
    // A new edit invalidates the redo stack (standard editor convention).
    if (h.redoStack.length > 0) {
      h.redoStack.length = 0;
    }
  },

  undo(containerId) {
    const h = histories.get(containerId);
    if (!h || h.undoStack.length === 0) return null;
    const entry = h.undoStack.pop()!;
    safeInvoke('invert', entry.invert);
    h.redoStack.push(entry);
    return entry;
  },

  redo(containerId) {
    const h = histories.get(containerId);
    if (!h || h.redoStack.length === 0) return null;
    const entry = h.redoStack.pop()!;
    safeInvoke('apply', entry.apply);
    h.undoStack.push(entry);
    return entry;
  },

  canUndo(containerId) {
    const h = histories.get(containerId);
    return !!h && h.undoStack.length > 0;
  },

  canRedo(containerId) {
    const h = histories.get(containerId);
    return !!h && h.redoStack.length > 0;
  },

  clear(containerId) {
    histories.delete(containerId);
  },

  getHistory(containerId) {
    return histories.get(containerId) ?? null;
  },
};

/** Drop every container's history. Used by tests + service.dispose(). */
export function clearAllHistories(): void {
  histories.clear();
}
