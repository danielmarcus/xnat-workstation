import { beforeEach, describe, expect, it } from 'vitest';
import { useAnnotationSelectionStore, selectActiveContainerId } from '../annotationSelectionStore';

/**
 * Rebuild Phase 3, Slice R3.2 — active-member + selection model (D7.5 / A6).
 *
 * Exactly one member is ACTIVE globally; the active CONTAINER is implicit (the
 * active member's container) and is what drawing writes to (B3) — this is the
 * value the Phase-2 gesture block (canDrawOnViewport) and toolbar undo
 * (undoContainer) will read once wired at mount (R3.8). SELECTION is an
 * independent multi-member set. Gesture mapping (D7.5): single-click → selectOnly
 * (replace selection, active unchanged); double-click → activate (active + select
 * it); click the active indicator → activateOnly (active, selection unchanged);
 * ctrl/shift-click → toggleSelected.
 */
const s = () => useAnnotationSelectionStore.getState();

beforeEach(() => {
  useAnnotationSelectionStore.getState().reset();
});

describe('annotationSelectionStore (D7.5 active vs selection)', () => {
  it('single-click (selectOnly) replaces the selection without changing the active member', () => {
    s().selectOnly('seg-1', '1');
    expect(s().selection).toEqual([{ containerId: 'seg-1', memberId: '1' }]);
    expect(s().activeMember).toBeNull();
    s().selectOnly('seg-1', '2');
    expect(s().selection).toEqual([{ containerId: 'seg-1', memberId: '2' }]); // replaced
  });

  it('double-click (activate) sets the active member AND selects it; active container is derived', () => {
    s().activate('seg-1', '2');
    expect(s().activeMember).toEqual({ containerId: 'seg-1', memberId: '2' });
    expect(selectActiveContainerId(s())).toBe('seg-1');
    expect(s().isSelected('seg-1', '2')).toBe(true); // activate also selects
  });

  it('clicking the active indicator (activateOnly) changes active without touching the selection set', () => {
    s().toggleSelected('seg-1', '1');
    s().toggleSelected('seg-1', '3');
    expect(s().selection).toHaveLength(2);
    s().activateOnly('seg-2', '1');
    expect(s().activeMember).toEqual({ containerId: 'seg-2', memberId: '1' });
    expect(s().selection).toHaveLength(2); // selection unchanged
    expect(s().isSelected('seg-1', '1')).toBe(true);
    expect(s().isSelected('seg-2', '1')).toBe(false); // active is not the same as selected
  });

  it('ctrl/shift-click (toggleSelected) adds then removes from the selection set; active unchanged', () => {
    s().activateOnly('seg-1', '1');
    s().toggleSelected('seg-2', '1');
    s().toggleSelected('seg-2', '2');
    expect(s().selection).toHaveLength(2);
    s().toggleSelected('seg-2', '1'); // toggle off
    expect(s().isSelected('seg-2', '1')).toBe(false);
    expect(s().isSelected('seg-2', '2')).toBe(true);
    expect(s().activeMember).toEqual({ containerId: 'seg-1', memberId: '1' }); // unchanged
  });

  it('distinguishes identical member ids across different containers (composite key)', () => {
    s().toggleSelected('seg-1', '1');
    expect(s().isSelected('seg-1', '1')).toBe(true);
    expect(s().isSelected('seg-2', '1')).toBe(false); // same memberId, different container
  });

  it('no active member ⇒ no active container (cannot draw, per A6/B3)', () => {
    expect(selectActiveContainerId(s())).toBeNull();
    s().activate('seg-1', '1');
    s().clearActive();
    expect(s().activeMember).toBeNull();
    expect(selectActiveContainerId(s())).toBeNull();
  });

  it('pruneContainer drops active + selection refs for a removed container (lifecycle)', () => {
    s().activate('seg-1', '1');
    s().toggleSelected('seg-2', '1');
    s().toggleSelected('seg-1', '2');
    s().pruneContainer('seg-1');
    expect(s().activeMember).toBeNull(); // active was in seg-1
    expect(s().isSelected('seg-1', '2')).toBe(false);
    expect(s().isSelected('seg-2', '1')).toBe(true); // seg-2 selection survives
  });
});
