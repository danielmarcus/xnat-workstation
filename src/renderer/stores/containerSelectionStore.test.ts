/**
 * Tests for the Phase 3.5a containerSelectionStore.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useContainerSelectionStore } from './containerSelectionStore';

beforeEach(() => {
  useContainerSelectionStore.getState().setActive(null);
  useContainerSelectionStore.getState().clearSelection();
  useContainerSelectionStore.getState().setHover(null);
});

afterEach(() => {
  useContainerSelectionStore.getState().setActive(null);
  useContainerSelectionStore.getState().clearSelection();
  useContainerSelectionStore.getState().setHover(null);
});

describe('initial state', () => {
  it('starts with empty selection, no active, no hover', () => {
    const s = useContainerSelectionStore.getState();
    expect(s.activeMemberId).toBeNull();
    expect(s.selectionSet).toEqual(new Set());
    expect(s.hoverMemberId).toBeNull();
  });
});

describe('setActive', () => {
  it('updates the active member', () => {
    useContainerSelectionStore.getState().setActive('m1');
    expect(useContainerSelectionStore.getState().activeMemberId).toBe('m1');
  });

  it('null clears the active member', () => {
    useContainerSelectionStore.getState().setActive('m1');
    useContainerSelectionStore.getState().setActive(null);
    expect(useContainerSelectionStore.getState().activeMemberId).toBeNull();
  });

  it('idempotent on no-op (same value)', () => {
    useContainerSelectionStore.getState().setActive('m1');
    const before = useContainerSelectionStore.getState();
    useContainerSelectionStore.getState().setActive('m1');
    const after = useContainerSelectionStore.getState();
    expect(after.activeMemberId).toBe(before.activeMemberId);
  });

  it('does not affect the selection set', () => {
    useContainerSelectionStore.getState().setSelection('m1');
    useContainerSelectionStore.getState().setActive('m2');
    expect(useContainerSelectionStore.getState().selectionSet).toEqual(new Set(['m1']));
    expect(useContainerSelectionStore.getState().activeMemberId).toBe('m2');
  });
});

describe('setSelection', () => {
  it('replaces selection with a single member', () => {
    useContainerSelectionStore.getState().setSelection('m1');
    expect(useContainerSelectionStore.getState().selectionSet).toEqual(new Set(['m1']));
    useContainerSelectionStore.getState().setSelection('m2');
    expect(useContainerSelectionStore.getState().selectionSet).toEqual(new Set(['m2']));
  });

  it('null clears the selection', () => {
    useContainerSelectionStore.getState().setSelection('m1');
    useContainerSelectionStore.getState().setSelection(null);
    expect(useContainerSelectionStore.getState().selectionSet.size).toBe(0);
  });
});

describe('setSelectionSet', () => {
  it('replaces selection with an arbitrary set', () => {
    useContainerSelectionStore.getState().setSelectionSet(['m1', 'm2', 'm3']);
    expect(useContainerSelectionStore.getState().selectionSet).toEqual(new Set(['m1', 'm2', 'm3']));
  });
});

describe('toggleSelection', () => {
  it('adds a member if not present', () => {
    useContainerSelectionStore.getState().toggleSelection('m1');
    expect(useContainerSelectionStore.getState().selectionSet).toEqual(new Set(['m1']));
  });

  it('removes a member if present', () => {
    useContainerSelectionStore.getState().setSelection('m1');
    useContainerSelectionStore.getState().toggleSelection('m1');
    expect(useContainerSelectionStore.getState().selectionSet.size).toBe(0);
  });

  it('toggle on multiple members produces the union', () => {
    useContainerSelectionStore.getState().toggleSelection('m1');
    useContainerSelectionStore.getState().toggleSelection('m2');
    useContainerSelectionStore.getState().toggleSelection('m3');
    expect(useContainerSelectionStore.getState().selectionSet).toEqual(new Set(['m1', 'm2', 'm3']));
  });

  it('skips empty memberId', () => {
    useContainerSelectionStore.getState().toggleSelection('');
    expect(useContainerSelectionStore.getState().selectionSet.size).toBe(0);
  });
});

describe('clearSelection', () => {
  it('empties the selection set', () => {
    useContainerSelectionStore.getState().setSelectionSet(['m1', 'm2']);
    useContainerSelectionStore.getState().clearSelection();
    expect(useContainerSelectionStore.getState().selectionSet.size).toBe(0);
  });

  it('does not affect the active member', () => {
    useContainerSelectionStore.getState().setActive('m1');
    useContainerSelectionStore.getState().clearSelection();
    expect(useContainerSelectionStore.getState().activeMemberId).toBe('m1');
  });
});

describe('setHover', () => {
  it('updates the hover member', () => {
    useContainerSelectionStore.getState().setHover('m1');
    expect(useContainerSelectionStore.getState().hoverMemberId).toBe('m1');
  });

  it('null clears the hover', () => {
    useContainerSelectionStore.getState().setHover('m1');
    useContainerSelectionStore.getState().setHover(null);
    expect(useContainerSelectionStore.getState().hoverMemberId).toBeNull();
  });

  it('idempotent on no-op (value unchanged)', () => {
    useContainerSelectionStore.getState().setHover('m1');
    useContainerSelectionStore.getState().setHover('m1');
    expect(useContainerSelectionStore.getState().hoverMemberId).toBe('m1');
  });

  it('does not affect active or selection', () => {
    useContainerSelectionStore.getState().setActive('m1');
    useContainerSelectionStore.getState().setSelection('m2');
    useContainerSelectionStore.getState().setHover('m3');

    const s = useContainerSelectionStore.getState();
    expect(s.activeMemberId).toBe('m1');
    expect(s.selectionSet).toEqual(new Set(['m2']));
    expect(s.hoverMemberId).toBe('m3');
  });
});
