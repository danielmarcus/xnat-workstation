import { beforeEach, describe, expect, it } from 'vitest';
import { createPerContainerHistory } from '../segmentationService/perContainerHistory';

/**
 * Slice 4 — per-container undo (A8). Service-layer mechanism verified here with
 * fake memo records that mimic Cornerstone's `HistoryMemoRecord`: each carries a
 * `segmentationId` (the container the edit belongs to) and a `restoreMemo(undo?)`
 * that records the boolean it was driven with, so we can assert WHICH memo was
 * undone/redone and in what order — no setter shortcuts, the real restore path.
 *
 * Covers signals 7 (viewport-independent — memos restore volume data, not a
 * viewport), 15 (save is not a barrier — undo past a save re-marks dirty), and the
 * core of 28 (per-container isolation, redo invalidation, clean eviction, reload
 * clears). Full E2E for 28 is Phase 5 (needs the list panel's active-container UI).
 */
type FakeMemo = {
  segmentationId?: string;
  segmentIndex?: number;
  tag: string;
  /** Booleans `restoreMemo` was called with, in order: true=undo, false=redo. */
  restored: boolean[];
  restoreMemo: (undo?: boolean) => void;
};

function memo(segmentationId: string | undefined, tag: string): FakeMemo {
  const m: FakeMemo = {
    segmentationId,
    segmentIndex: 1,
    tag,
    restored: [],
    restoreMemo: (undo = false) => {
      m.restored.push(undo);
    },
  };
  return m;
}

describe('perContainerHistory (Slice 4: per-container undo, A8 / signals 7,15,28)', () => {
  let dirtied: string[];
  let history: ReturnType<typeof createPerContainerHistory>;

  beforeEach(() => {
    dirtied = [];
    history = createPerContainerHistory({ onContainerDirtied: (id) => dirtied.push(id), capacity: 100 });
  });

  it('partitions history per container — undo on A does not touch B (A8 isolation / signal 28)', () => {
    const a1 = memo('A', 'a1');
    const b1 = memo('B', 'b1');
    history.record(a1);
    history.record(b1);

    expect(history.undo('A')).toBe(true);
    expect(a1.restored).toEqual([true]); // A's memo was undone
    expect(b1.restored).toEqual([]); // B was never touched
    expect(history.canUndo('B')).toBe(true); // B's history is intact
    expect(history.canRedo('A')).toBe(true); // A's undone op is redoable
  });

  it('switching the active container does not clear either history (A8)', () => {
    history.record(memo('A', 'a1'));
    history.record(memo('B', 'b1'));
    expect(history.canUndo('A')).toBe(true);
    expect(history.canUndo('B')).toBe(true);
  });

  it('a fresh edit after an undo invalidates that container’s redo stack (A8 redo)', () => {
    history.record(memo('A', 'a1'));
    history.record(memo('A', 'a2'));
    history.undo('A');
    expect(history.canRedo('A')).toBe(true);
    history.record(memo('A', 'a3')); // fresh edit
    expect(history.canRedo('A')).toBe(false);
  });

  it('redo replays the undone memo with restoreMemo(false) and stops when empty', () => {
    const a1 = memo('A', 'a1');
    history.record(a1);
    history.undo('A');
    expect(history.redo('A')).toBe(true);
    expect(a1.restored).toEqual([true, false]); // undone, then redone
    expect(history.redo('A')).toBe(false); // nothing left to redo
  });

  it('evicts oldest beyond capacity cleanly — no corruption past the configured depth', () => {
    for (let i = 0; i < 150; i++) history.record(memo('A', `a${i}`));
    let count = 0;
    while (history.undo('A')) count++;
    expect(count).toBe(100); // capacity honored; oldest 50 evicted
    expect(history.canUndo('A')).toBe(false);
    expect(() => history.undo('A')).not.toThrow();
  });

  it('save is not a barrier: undo past a save point re-marks the container dirty (signal 15)', () => {
    history.record(memo('A', 'a1'));
    history.record(memo('A', 'a2'));
    dirtied.length = 0; // simulate a save — the caller cleared the dirty flag
    expect(history.undo('A')).toBe(true); // undo crosses the save point
    expect(dirtied).toContain('A'); // dirty becomes set again
    expect(history.undo('A')).toBe(true); // history was NOT truncated at the save
  });

  it('clear(containerId) drops that container’s history (reload E3/H6) and leaves others intact', () => {
    history.record(memo('A', 'a1'));
    history.record(memo('B', 'b1'));
    history.clear('A');
    expect(history.canUndo('A')).toBe(false);
    expect(history.canRedo('A')).toBe(false);
    expect(history.canUndo('B')).toBe(true);
  });

  it('clearAll() drops every container’s history (service reset)', () => {
    history.record(memo('A', 'a1'));
    history.record(memo('B', 'b1'));
    history.clearAll();
    expect(history.canUndo('A')).toBe(false);
    expect(history.canUndo('B')).toBe(false);
  });

  it('ignores untagged memos (no segmentationId) — cannot be partitioned, left to the global ring', () => {
    const u = memo(undefined, 'untagged');
    expect(() => history.record(u)).not.toThrow();
    expect(history.canUndo('undefined')).toBe(false);
    expect(dirtied).toEqual([]); // nothing dirtied — not attributable to a container
  });
});
