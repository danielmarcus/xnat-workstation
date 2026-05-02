/**
 * Tests for the Phase 2.6 container-bridge scaffolding.
 *
 * The bridge has two surfaces:
 *   - Direct API: register / unregister / getContainerId / getContainer /
 *     setDirty / setSaveInFlight / listAll / clearAll / inferContainerKind.
 *   - Event-driven auto-tracking: subscribes to SEGMENTATION_ADDED /
 *     SEGMENTATION_REMOVED via Cornerstone's eventTarget when initialize()
 *     is called.
 *
 * We mock `@cornerstonejs/core` and `@cornerstonejs/tools` so we can
 * dispatch events deterministically without a real Cornerstone engine.
 * The mock's eventTarget is a plain `EventTarget` instance — same shape
 * as Cornerstone's, sufficient for addEventListener/dispatchEvent.
 *
 * Active-segmentation lookups go through `useSegmentationStore`, which is
 * the real store (no mock); we mutate its state directly via setState.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `vi.mock` factories are hoisted to the top of the file, so any state they
// need has to be hoisted too via vi.hoisted(). The mockEventTarget is shared
// between the @cornerstonejs/core mock (so the bridge subscribes to it) and
// the test bodies (so they can dispatch events into it).
const { mockEventTarget } = vi.hoisted(() => ({
  mockEventTarget: new EventTarget(),
}));

vi.mock('@cornerstonejs/core', () => ({
  eventTarget: mockEventTarget,
}));

vi.mock('@cornerstonejs/tools', () => ({
  Enums: {
    Events: {
      SEGMENTATION_ADDED: 'CORNERSTONE_TOOLS_SEGMENTATION_ADDED',
      SEGMENTATION_REMOVED: 'CORNERSTONE_TOOLS_SEGMENTATION_REMOVED',
    },
  },
  segmentation: {
    state: {
      getSegmentation: vi.fn((id: string) => ({ label: `Label of ${id}` })),
    },
  },
}));

// Imports must come AFTER vi.mock declarations.
import {
  clearAll,
  dispose,
  getActiveContainerId,
  getContainer,
  getContainerId,
  getCsSegmentationId,
  inferContainerKind,
  initialize,
  listAll,
  register,
  setDirty,
  setSaveInFlight,
  setVersionToken,
  unregister,
} from './containerBridge';
import { useSegmentationStore } from '../../stores/segmentationStore';

beforeEach(() => {
  clearAll();
  // Reset the store's active segmentation between tests so tests are
  // independent.
  useSegmentationStore.setState({ activeSegmentationId: null });
});

afterEach(() => {
  dispose();
  clearAll();
});

// ─── inferContainerKind ────────────────────────────────────────────────

describe('inferContainerKind', () => {
  it('rtstruct_ prefix → RTSTRUCT', () => {
    expect(inferContainerKind('rtstruct_1234_1')).toBe('RTSTRUCT');
  });

  it('seg_ prefix → SEG', () => {
    expect(inferContainerKind('seg_1234_1')).toBe('SEG');
  });

  it('seg_dicom_ prefix → SEG (DICOM SEG load path)', () => {
    expect(inferContainerKind('seg_dicom_1234_1')).toBe('SEG');
  });

  it('arbitrary id → SEG (default)', () => {
    expect(inferContainerKind('mySegmentation')).toBe('SEG');
  });

  it('empty string → SEG (default)', () => {
    expect(inferContainerKind('')).toBe('SEG');
  });
});

// ─── register / unregister / round-trip ────────────────────────────────

describe('register / unregister', () => {
  it('register returns a containerId', () => {
    const id = register('seg_1');
    expect(id).toMatch(/^container_/);
  });

  it('register is idempotent — same csSegId returns the same containerId', () => {
    const a = register('seg_1');
    const b = register('seg_1');
    expect(a).toBe(b);
  });

  it('register with explicit kind override wins over the prefix heuristic', () => {
    register('seg_999', { kind: 'RTSTRUCT' });
    expect(getContainer(getContainerId('seg_999')!)?.kind).toBe('RTSTRUCT');
  });

  it('register defaults kind from prefix when not specified', () => {
    register('rtstruct_1');
    register('seg_1');
    expect(getContainer(getContainerId('rtstruct_1')!)?.kind).toBe('RTSTRUCT');
    expect(getContainer(getContainerId('seg_1')!)?.kind).toBe('SEG');
  });

  it('register defaults name from cs segmentation label', () => {
    register('seg_1');
    expect(getContainer(getContainerId('seg_1')!)?.name).toBe('Label of seg_1');
  });

  it('register accepts an explicit name', () => {
    register('seg_1', { name: 'My Custom Name' });
    expect(getContainer(getContainerId('seg_1')!)?.name).toBe('My Custom Name');
  });

  it('register throws on empty csSegId', () => {
    expect(() => register('')).toThrow();
  });

  it('Container starts with default approval, dirty=false, saveInFlight=false', () => {
    register('seg_1');
    const c = getContainer(getContainerId('seg_1')!);
    expect(c?.dirty).toBe(false);
    expect(c?.saveInFlight).toBe(false);
    expect(c?.approval.approved).toBe(false);
    expect(c?.versionToken).toBeNull();
    expect(c?.parseError).toBeNull();
    expect(c?.sourceIdentity).toBeNull();
    expect(c?.members).toEqual([]);
  });

  it('unregister drops the bridge entry and the Container', () => {
    const containerId = register('seg_1');
    unregister('seg_1');
    expect(getContainerId('seg_1')).toBeNull();
    expect(getContainer(containerId)).toBeNull();
  });

  it('unregister on absent csSegId is a no-op', () => {
    expect(() => unregister('nope')).not.toThrow();
  });

  it('multiple registrations live independently', () => {
    const a = register('seg_1');
    const b = register('seg_2');
    expect(a).not.toBe(b);
    expect(getContainerId('seg_1')).toBe(a);
    expect(getContainerId('seg_2')).toBe(b);
    expect(listAll()).toHaveLength(2);
  });
});

// ─── ID round-trip ─────────────────────────────────────────────────────

describe('getContainerId / getCsSegmentationId', () => {
  it('round-trips a registered segmentation', () => {
    const containerId = register('seg_1');
    expect(getContainerId('seg_1')).toBe(containerId);
    expect(getCsSegmentationId(containerId)).toBe('seg_1');
  });

  it('returns null on unknown ids', () => {
    expect(getContainerId('seg-unknown')).toBeNull();
    expect(getCsSegmentationId('container-unknown')).toBeNull();
    expect(getContainerId('')).toBeNull();
    expect(getCsSegmentationId('')).toBeNull();
  });

  it('getContainer returns null on unknown id', () => {
    expect(getContainer('container-unknown')).toBeNull();
    expect(getContainer('')).toBeNull();
  });
});

// ─── Active-container resolution ───────────────────────────────────────

describe('getActiveContainerId', () => {
  it('returns null when no active segmentation is set', () => {
    expect(getActiveContainerId()).toBeNull();
  });

  it('resolves the active segmentation through the bridge', () => {
    const containerId = register('seg_1');
    useSegmentationStore.setState({ activeSegmentationId: 'seg_1' });
    expect(getActiveContainerId()).toBe(containerId);
  });

  it('returns null when the active segmentation isn’t in the bridge', () => {
    useSegmentationStore.setState({ activeSegmentationId: 'seg-floating' });
    expect(getActiveContainerId()).toBeNull();
  });
});

// ─── Bookkeeping setters ───────────────────────────────────────────────

describe('setDirty / setSaveInFlight / setVersionToken', () => {
  it('setDirty toggles the flag on the container', () => {
    const containerId = register('seg_1');
    setDirty(containerId, true);
    expect(getContainer(containerId)?.dirty).toBe(true);
    setDirty(containerId, false);
    expect(getContainer(containerId)?.dirty).toBe(false);
  });

  it('setSaveInFlight toggles the flag', () => {
    const containerId = register('seg_1');
    setSaveInFlight(containerId, true);
    expect(getContainer(containerId)?.saveInFlight).toBe(true);
  });

  it('setVersionToken stores the token', () => {
    const containerId = register('seg_1');
    setVersionToken(containerId, 'etag-abc');
    expect(getContainer(containerId)?.versionToken).toBe('etag-abc');
  });

  it('setters on unknown containerId are no-ops', () => {
    expect(() => setDirty('nope', true)).not.toThrow();
    expect(() => setSaveInFlight('nope', true)).not.toThrow();
    expect(() => setVersionToken('nope', 'tok')).not.toThrow();
  });
});

// ─── Event-driven auto-tracking ────────────────────────────────────────

describe('initialize() event subscriptions', () => {
  function fireAdded(segmentationId: string): void {
    mockEventTarget.dispatchEvent(
      new CustomEvent('CORNERSTONE_TOOLS_SEGMENTATION_ADDED', {
        detail: { segmentationId },
      }),
    );
  }
  function fireRemoved(segmentationId: string): void {
    mockEventTarget.dispatchEvent(
      new CustomEvent('CORNERSTONE_TOOLS_SEGMENTATION_REMOVED', {
        detail: { segmentationId },
      }),
    );
  }

  it('SEGMENTATION_ADDED event auto-registers a new container', () => {
    initialize();
    fireAdded('seg_auto_1');
    expect(getContainerId('seg_auto_1')).not.toBeNull();
  });

  it('SEGMENTATION_REMOVED event auto-unregisters', () => {
    initialize();
    fireAdded('seg_auto_1');
    expect(getContainerId('seg_auto_1')).not.toBeNull();
    fireRemoved('seg_auto_1');
    expect(getContainerId('seg_auto_1')).toBeNull();
  });

  it('idempotent on duplicate ADDED events', () => {
    initialize();
    fireAdded('seg_auto_1');
    const first = getContainerId('seg_auto_1');
    fireAdded('seg_auto_1');
    expect(getContainerId('seg_auto_1')).toBe(first);
  });

  it('events with empty segmentationId are ignored', () => {
    initialize();
    fireAdded('');
    expect(listAll()).toHaveLength(0);
  });

  it('initialize() is idempotent — does not double-subscribe', () => {
    initialize();
    initialize();
    fireAdded('seg_auto_1');
    expect(listAll()).toHaveLength(1); // not 2
  });

  it('dispose() removes the listeners and clears state', () => {
    initialize();
    fireAdded('seg_auto_1');
    expect(listAll()).toHaveLength(1);

    dispose();
    expect(listAll()).toHaveLength(0);

    fireAdded('seg_auto_2');
    // Listener removed; no auto-register.
    expect(getContainerId('seg_auto_2')).toBeNull();
  });
});

// ─── clearAll ──────────────────────────────────────────────────────────

describe('clearAll', () => {
  it('drops every entry', () => {
    register('seg_1');
    register('seg_2');
    expect(listAll()).toHaveLength(2);
    clearAll();
    expect(listAll()).toHaveLength(0);
  });
});
