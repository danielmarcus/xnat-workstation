import { beforeEach, describe, expect, it } from 'vitest';
import { useAnnotationSelectionStore, selectActiveContainerId } from '../annotationSelectionStore';

/**
 * Rebuild Phase 3, Slice R3.2 — the active-member model (D7.5 / A6; one row state since
 * 2026-10-08).
 *
 * Exactly one member is ACTIVE globally; the active CONTAINER is implicit (the active
 * member's container) and is what drawing writes to (B3) — the value the gesture block
 * (canDrawOnViewport) and toolbar undo (undoContainer) read. A row click activates.
 */
const s = () => useAnnotationSelectionStore.getState();

beforeEach(() => {
  useAnnotationSelectionStore.getState().reset();
});

describe('annotationSelectionStore (active member)', () => {
  it('activate sets the active member; the active container is derived', () => {
    s().activate('seg-1', '2');
    expect(s().activeMember).toEqual({ containerId: 'seg-1', memberId: '2' });
    expect(selectActiveContainerId(s())).toBe('seg-1');
  });

  it('activating another member replaces the active one — there is only one', () => {
    s().activate('seg-1', '1');
    s().activate('seg-2', '1');
    expect(s().activeMember).toEqual({ containerId: 'seg-2', memberId: '1' });
  });

  it('no active member ⇒ no active container (cannot draw, per A6/B3)', () => {
    expect(selectActiveContainerId(s())).toBeNull();
    s().activate('seg-1', '1');
    s().clearActive();
    expect(s().activeMember).toBeNull();
    expect(selectActiveContainerId(s())).toBeNull();
  });

  it('pruneContainer drops the active ref only when its container is removed (lifecycle)', () => {
    s().activate('seg-1', '1');
    s().pruneContainer('seg-2');
    expect(s().activeMember).toEqual({ containerId: 'seg-1', memberId: '1' });
    s().pruneContainer('seg-1');
    expect(s().activeMember).toBeNull();
  });
});
