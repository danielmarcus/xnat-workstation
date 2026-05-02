/**
 * Tests for the per-container undo service (Phase 2.7a).
 *
 * Pure-logic module: no Cornerstone, no DOM, no stores. The HistoryEntry
 * objects carry their own apply/invert closures, which we instrument with
 * spies to verify dispatch.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearAllHistories,
  undoService,
} from './undoService';
import type { HistoryEntry } from '../../types/annotation';
import { UNDO_HISTORY_LIMIT } from '../../types/annotation';

afterEach(() => {
  clearAllHistories();
});

function makeEntry(
  description = 'Entry',
  scopeMemberIds: string[] = [],
): HistoryEntry & { applySpy: ReturnType<typeof vi.fn>; invertSpy: ReturnType<typeof vi.fn> } {
  const applySpy = vi.fn();
  const invertSpy = vi.fn();
  return {
    description,
    apply: applySpy,
    invert: invertSpy,
    scopeMemberIds,
    at: Date.now(),
    applySpy,
    invertSpy,
  } as HistoryEntry & {
    applySpy: ReturnType<typeof vi.fn>;
    invertSpy: ReturnType<typeof vi.fn>;
  };
}

describe('undoService.record', () => {
  it('appends to the container’s undo stack', () => {
    const e = makeEntry();
    undoService.record('A', e);
    expect(undoService.getHistory('A')?.undoStack).toHaveLength(1);
  });

  it('clears the redo stack when a new entry is recorded (standard editor convention)', () => {
    undoService.record('A', makeEntry('first'));
    undoService.undo('A'); // moves first → redoStack
    expect(undoService.canRedo('A')).toBe(true);

    undoService.record('A', makeEntry('second'));
    expect(undoService.canRedo('A')).toBe(false);
  });

  it('caps undo depth at UNDO_HISTORY_LIMIT, dropping oldest first (§A8)', () => {
    for (let i = 0; i < UNDO_HISTORY_LIMIT + 5; i++) {
      undoService.record('A', makeEntry(`entry ${i}`));
    }
    const history = undoService.getHistory('A')!;
    expect(history.undoStack).toHaveLength(UNDO_HISTORY_LIMIT);
    // Oldest dropped: the surviving entries are entry 5..104.
    expect(history.undoStack[0].description).toBe('entry 5');
    expect(history.undoStack[history.undoStack.length - 1].description).toBe(
      `entry ${UNDO_HISTORY_LIMIT + 4}`,
    );
  });

  it('ignores empty containerId and null entry', () => {
    undoService.record('', makeEntry());
    undoService.record('A', null as unknown as HistoryEntry);
    expect(undoService.getHistory('')).toBeNull();
    expect(undoService.getHistory('A')).toBeNull();
  });
});

describe('undoService.undo / redo', () => {
  it('returns null when undo stack is empty', () => {
    expect(undoService.undo('A')).toBeNull();
  });

  it('returns null when redo stack is empty', () => {
    expect(undoService.redo('A')).toBeNull();
  });

  it('undo pops the top entry, calls invert, and moves it to redo', () => {
    const e = makeEntry('only');
    undoService.record('A', e);
    const popped = undoService.undo('A');
    expect(popped).toBe(e);
    expect(e.invertSpy).toHaveBeenCalledOnce();
    expect(e.applySpy).not.toHaveBeenCalled();
    expect(undoService.canUndo('A')).toBe(false);
    expect(undoService.canRedo('A')).toBe(true);
  });

  it('redo pops the top redo entry, calls apply, and moves it back', () => {
    const e = makeEntry();
    undoService.record('A', e);
    undoService.undo('A');
    const popped = undoService.redo('A');
    expect(popped).toBe(e);
    expect(e.applySpy).toHaveBeenCalledOnce();
    expect(undoService.canUndo('A')).toBe(true);
    expect(undoService.canRedo('A')).toBe(false);
  });

  it('catches throws from invert/apply and continues (logs to console.warn)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const e: HistoryEntry = {
      description: 'bad',
      apply: () => { throw new Error('apply boom'); },
      invert: () => { throw new Error('invert boom'); },
      scopeMemberIds: [],
      at: Date.now(),
    };
    undoService.record('A', e);
    // Should not propagate.
    expect(() => undoService.undo('A')).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockClear();
    // Entry should still have moved to redoStack.
    expect(() => undoService.redo('A')).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('canUndo / canRedo report stack non-emptiness', () => {
    expect(undoService.canUndo('A')).toBe(false);
    expect(undoService.canRedo('A')).toBe(false);

    undoService.record('A', makeEntry());
    expect(undoService.canUndo('A')).toBe(true);

    undoService.undo('A');
    expect(undoService.canUndo('A')).toBe(false);
    expect(undoService.canRedo('A')).toBe(true);

    undoService.redo('A');
    expect(undoService.canUndo('A')).toBe(true);
    expect(undoService.canRedo('A')).toBe(false);
  });
});

describe('undoService — per-container isolation (§A8)', () => {
  it('edits in container A do not affect container B’s stack', () => {
    undoService.record('A', makeEntry('a1'));
    undoService.record('A', makeEntry('a2'));
    undoService.record('B', makeEntry('b1'));

    expect(undoService.getHistory('A')?.undoStack).toHaveLength(2);
    expect(undoService.getHistory('B')?.undoStack).toHaveLength(1);
  });

  it('undoing in A does not pop from B’s stack', () => {
    const a1 = makeEntry('a1');
    const b1 = makeEntry('b1');
    undoService.record('A', a1);
    undoService.record('B', b1);

    undoService.undo('A');
    expect(a1.invertSpy).toHaveBeenCalledOnce();
    expect(b1.invertSpy).not.toHaveBeenCalled();
    expect(undoService.canUndo('A')).toBe(false);
    expect(undoService.canUndo('B')).toBe(true);
  });

  it('clear(A) does not affect B', () => {
    undoService.record('A', makeEntry());
    undoService.record('B', makeEntry());

    undoService.clear('A');
    expect(undoService.getHistory('A')).toBeNull();
    expect(undoService.canUndo('B')).toBe(true);
  });
});

describe('undoService — save-is-not-an-undo-barrier (§A8)', () => {
  it('a "save" event does not clear undo history; the user can undo past a save point', () => {
    // Save is implicit; the service has no save concept by design. Verify
    // that recording continues to work after arbitrary external operations
    // without history loss.
    const e1 = makeEntry('pre-save');
    const e2 = makeEntry('post-save');
    undoService.record('A', e1);
    // Imagine a save happens here — service should not be touched.
    undoService.record('A', e2);

    expect(undoService.getHistory('A')?.undoStack).toHaveLength(2);
    undoService.undo('A');
    undoService.undo('A');
    expect(e2.invertSpy).toHaveBeenCalledOnce();
    expect(e1.invertSpy).toHaveBeenCalledOnce();
  });

  it('clear() is the explicit way to drop history (used by E3 external-change reload)', () => {
    undoService.record('A', makeEntry());
    undoService.clear('A');
    expect(undoService.canUndo('A')).toBe(false);
  });
});

describe('undoService.getHistory', () => {
  it('returns null for a container with no history', () => {
    expect(undoService.getHistory('nope')).toBeNull();
  });

  it('returns the live ContainerHistory object', () => {
    const e = makeEntry();
    undoService.record('A', e);
    const h = undoService.getHistory('A');
    expect(h?.containerId).toBe('A');
    expect(h?.undoStack[0]).toBe(e);
  });
});
