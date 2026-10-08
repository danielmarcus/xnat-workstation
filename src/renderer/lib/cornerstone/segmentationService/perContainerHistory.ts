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
  /**
   * Route a freshly-pushed memo into its container's undo stack (clears its redo).
   * `containerId` overrides the partition key — callers pass it when the memo's raw
   * `segmentationId` is NOT the user-facing container id (e.g. a multi-layer group's
   * sub-seg `…_layer_N` must be filed under the GROUP id the panel activates, so
   * `canUndo(activeContainerId)` finds it). Falls back to `memo.segmentationId`.
   */
  record(memo: ContainerHistoryMemo, containerId?: string): void;
  /**
   * Replace the newest undo entry of whichever container's newest entry satisfies
   * `condition` — the per-container mirror of Cornerstone 5's
   * `DefaultHistoryMemo.replaceCurrentMemo`, which rewrites the ring in place (no push)
   * when a contour stroke is unioned into existing contours. Returns false if no
   * container's newest entry matches.
   */
  replaceTop(condition: (memo: ContainerHistoryMemo) => boolean, memo: ContainerHistoryMemo): boolean;
  /** Undo the last edit of one container. Returns false if nothing to undo. */
  /** The memo(s) `undo(containerId)` would apply next, without applying them (a group's
   *  memos as an array). */
  peekUndo(containerId: string): ContainerHistoryMemo | ContainerHistoryMemo[] | undefined;
  /** The memo(s) `redo(containerId)` would apply next, without applying them. */
  peekRedo(containerId: string): ContainerHistoryMemo | ContainerHistoryMemo[] | undefined;
  /**
   * Between beginGroup() and endGroup(), everything recorded for a container becomes ONE
   * entry on its stack — undone and redone together (the per-container mirror of
   * Cornerstone's grouped history recording, e.g. a multi-contour paste or delete).
   */
  beginGroup(): void;
  endGroup(): void;
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

/** Several memos recorded as one undo step. */
interface GroupMemo extends ContainerHistoryMemo {
  members: ContainerHistoryMemo[];
}

function isGroup(memo: ContainerHistoryMemo): memo is GroupMemo {
  return Array.isArray((memo as Partial<GroupMemo>).members);
}

function unwrap(memo: ContainerHistoryMemo | undefined): ContainerHistoryMemo | ContainerHistoryMemo[] | undefined {
  return memo && isGroup(memo) ? memo.members : memo;
}

/** A group carries its first memo's identity (segment, label) and replays its members:
 *  undo in reverse order, redo in order. */
function makeGroup(first: ContainerHistoryMemo): GroupMemo {
  const group: GroupMemo = {
    ...(first as Record<string, unknown>),
    members: [first],
    restoreMemo: (undo?: boolean) => {
      const order = undo === false ? group.members : [...group.members].reverse();
      for (const m of order) {
        try {
          m.restoreMemo?.(undo);
        } catch {
          /* one bad member must not stop the rest */
        }
      }
    },
  };
  return group;
}

/** The replacement is the same user operation, so it keeps the identity the original was
 *  filed and labelled under (Cornerstone's union memo carries none). */
function carryIdentity(original: ContainerHistoryMemo, memo: ContainerHistoryMemo): ContainerHistoryMemo {
  const carried = memo as ContainerHistoryMemo & Record<string, unknown>;
  for (const [k, v] of Object.entries(original as Record<string, unknown>)) {
    if (k !== 'restoreMemo' && carried[k] === undefined) carried[k] = v;
  }
  return carried;
}

export function createPerContainerHistory(deps: PerContainerHistoryDeps): PerContainerHistory {
  const capacity = Math.max(100, Math.floor(deps.capacity ?? DEFAULT_CAPACITY));
  const byContainer = new Map<string, Stacks>();
  let grouping = false;
  const openGroups = new Map<string, GroupMemo>();

  function stacksFor(containerId: string): Stacks {
    let s = byContainer.get(containerId);
    if (!s) {
      s = { undo: [], redo: [] };
      byContainer.set(containerId, s);
    }
    return s;
  }

  function record(memo: ContainerHistoryMemo, containerId?: string): void {
    const key = (typeof containerId === 'string' && containerId.length > 0)
      ? containerId
      : memo?.segmentationId;
    if (typeof key !== 'string' || key.length === 0) {
      return; // untagged — cannot be partitioned; remains on the global ring only
    }
    const s = stacksFor(key);
    if (grouping) {
      const open = openGroups.get(key);
      if (open) {
        open.members.push(memo);
        deps.onContainerDirtied(key);
        return;
      }
      memo = makeGroup(memo);
      openGroups.set(key, memo as GroupMemo);
    }
    s.undo.push(memo);
    if (s.undo.length > capacity) {
      s.undo.splice(0, s.undo.length - capacity); // evict oldest cleanly
    }
    s.redo.length = 0; // a fresh edit invalidates redo (standard editor convention)
    deps.onContainerDirtied(key);
  }

  function replaceTop(condition: (memo: ContainerHistoryMemo) => boolean, memo: ContainerHistoryMemo): boolean {
    for (const s of byContainer.values()) {
      const top = s.undo[s.undo.length - 1];
      if (top && isGroup(top)) {
        const i = top.members.findIndex(condition);
        if (i === -1) continue;
        top.members[i] = carryIdentity(top.members[i], memo);
        return true;
      }
      if (!top || !condition(top)) continue;
      // The replacement is the same user operation, so it keeps the identity the
      // original was filed and labelled under (Cornerstone's union memo carries none).
      const carried = memo as ContainerHistoryMemo & Record<string, unknown>;
      for (const [k, v] of Object.entries(top as Record<string, unknown>)) {
        if (k !== 'restoreMemo' && carried[k] === undefined) carried[k] = v;
      }
      s.undo[s.undo.length - 1] = carried;
      return true;
    }
    return false;
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
    replaceTop,
    peekUndo: (id) => { const s = byContainer.get(id); return unwrap(s?.undo[s.undo.length - 1]); },
    peekRedo: (id) => { const s = byContainer.get(id); return unwrap(s?.redo[s.redo.length - 1]); },
    beginGroup: () => { grouping = true; openGroups.clear(); },
    endGroup: () => { grouping = false; openGroups.clear(); },
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
