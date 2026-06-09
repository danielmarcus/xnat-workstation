/**
 * Per-container undo/redo history (A8).
 *
 * Cornerstone's `DefaultHistoryMemo` is a single GLOBAL ring — every tool pushes
 * its edit memo there, so a plain `undo()` pops whichever edit happened last,
 * regardless of which container (SEG / RTSTRUCT / SR object) it belonged to. A8
 * requires undo to be **per-container**: undoing in container A must not touch
 * container B, and switching the active container must not clear either's history.
 *
 * This manager partitions edits by their resolved `segmentationId` (the container
 * the memo belongs to — set by the push-hook's `enrichHistoryMemoRecord`). It does
 * NOT replace the global ring; it is fed additively by the same push-hook
 * ({@link UndoHistory.installHistoryMemoTracking}). Driving undo/redo here calls the
 * memo's own `restoreMemo(undo)` — the exact operation the global ring would run —
 * so a memo is replayed identically whether the source viewport is still open
 * (signal 7: viewport-independent, because a memo restores VOLUME/annotation data,
 * not a viewport).
 *
 * Semantics (A8):
 *  - **Isolation**: separate undo+redo stacks per container id.
 *  - **Redo invalidation**: a fresh edit clears that container's redo stack.
 *  - **Save is not a barrier**: saving never truncates a stack; every record/undo/
 *    redo re-marks the container dirty via {@link PerContainerHistoryDeps.onContainerDirtied}
 *    so an undo that crosses a save point sets the dirty flag again (signal 15).
 *  - **Reload clears**: {@link clear} drops one container's history (E3 / H6).
 *  - **Bounded depth**: each stack keeps at most `capacity` entries (≥100); the
 *    oldest evict cleanly with no corruption.
 *
 * Untagged memos (no `segmentationId` — not attributable to a container) are
 * ignored here and remain only on the global ring.
 *
 * The toolbar/keyboard undo wiring to the ACTIVE container is Phase 3 (it needs the
 * list panel that designates the active container); this slice builds and verifies
 * the mechanism at the service layer.
 */

/** Minimal shape of a Cornerstone history memo this manager drives. */
export interface ContainerHistoryMemo {
  segmentationId?: string;
  restoreMemo?: (undo?: boolean) => void;
}

export interface PerContainerHistoryDeps {
  /**
   * Called whenever a container's state changes through this manager (record /
   * undo / redo). Wired to the per-container dirty flag so undo past a save point
   * re-marks dirty (signal 15). Save is NOT a barrier — this fires on every op.
   */
  onContainerDirtied(containerId: string): void;
  /** Max entries per container undo stack (≥100). Default 200 (matches the ring). */
  capacity?: number;
}

export interface PerContainerHistory {
  /** Route a freshly-pushed memo into its container's undo stack (clears its redo). */
  record(memo: ContainerHistoryMemo): void;
  /** Undo the last edit of one container. Returns false if nothing to undo. */
  undo(containerId: string): boolean;
  /** Redo the last undone edit of one container. Returns false if nothing to redo. */
  redo(containerId: string): boolean;
  canUndo(containerId: string): boolean;
  canRedo(containerId: string): boolean;
  /** Depth inspection (tests / UI badges). */
  depth(containerId: string): { undo: number; redo: number };
  /** Drop one container's history (reload / external replace — E3 / H6). */
  clear(containerId: string): void;
  /** Drop all history (service reset). */
  clearAll(): void;
}

const DEFAULT_CAPACITY = 200;

interface Stacks {
  undo: ContainerHistoryMemo[];
  redo: ContainerHistoryMemo[];
}

export function createPerContainerHistory(deps: PerContainerHistoryDeps): PerContainerHistory {
  const capacity = Math.max(100, Math.floor(deps.capacity ?? DEFAULT_CAPACITY));
  const byContainer = new Map<string, Stacks>();

  function stacksFor(containerId: string): Stacks {
    let s = byContainer.get(containerId);
    if (!s) {
      s = { undo: [], redo: [] };
      byContainer.set(containerId, s);
    }
    return s;
  }

  function record(memo: ContainerHistoryMemo): void {
    const containerId = memo?.segmentationId;
    if (typeof containerId !== 'string' || containerId.length === 0) {
      return; // untagged — cannot be partitioned; remains on the global ring only
    }
    const s = stacksFor(containerId);
    s.undo.push(memo);
    if (s.undo.length > capacity) {
      s.undo.splice(0, s.undo.length - capacity); // evict oldest cleanly
    }
    s.redo.length = 0; // a fresh edit invalidates redo (standard editor convention)
    deps.onContainerDirtied(containerId);
  }

  function undo(containerId: string): boolean {
    const s = byContainer.get(containerId);
    if (!s || s.undo.length === 0) return false;
    const memo = s.undo.pop()!;
    try {
      memo.restoreMemo?.(true);
    } catch {
      /* a single bad memo must not corrupt the stack */
    }
    s.redo.push(memo);
    deps.onContainerDirtied(containerId); // save is not a barrier — re-mark dirty
    return true;
  }

  function redo(containerId: string): boolean {
    const s = byContainer.get(containerId);
    if (!s || s.redo.length === 0) return false;
    const memo = s.redo.pop()!;
    try {
      memo.restoreMemo?.(false);
    } catch {
      /* ignore */
    }
    s.undo.push(memo);
    deps.onContainerDirtied(containerId);
    return true;
  }

  return {
    record,
    undo,
    redo,
    canUndo: (id) => (byContainer.get(id)?.undo.length ?? 0) > 0,
    canRedo: (id) => (byContainer.get(id)?.redo.length ?? 0) > 0,
    depth: (id) => {
      const s = byContainer.get(id);
      return { undo: s?.undo.length ?? 0, redo: s?.redo.length ?? 0 };
    },
    clear: (id) => {
      byContainer.delete(id);
    },
    clearAll: () => byContainer.clear(),
  };
}
