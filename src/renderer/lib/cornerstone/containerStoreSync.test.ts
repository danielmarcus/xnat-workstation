/**
 * Tests for the Phase 3.2a bridge → containerStore sync layer.
 *
 * Verifies that every mutation that goes through `containerBridge`
 * propagates to `useContainerStore` as an immutable snapshot, in either
 * direction (add / update / remove / bulk-clear).
 *
 * The sync subscribes to bridge mutations via `containerBridge.subscribe`;
 * we drive the bridge through its public API and observe the store.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEventTarget } = vi.hoisted(() => ({
  mockEventTarget: new EventTarget(),
}));

vi.mock('@cornerstonejs/core', () => ({
  eventTarget: mockEventTarget,
}));

// Mutable cs segmentation state the tests can mutate to simulate
// "the brush created a new segment" / "user renamed segment 2" / etc.
const csSegState = vi.hoisted(() => ({
  segmentations: new Map<string, { label?: string; segments?: Record<number, { label?: string }> }>(),
}));

vi.mock('@cornerstonejs/tools', () => ({
  Enums: {
    Events: {
      SEGMENTATION_ADDED: 'CS_SEGMENTATION_ADDED',
      SEGMENTATION_REMOVED: 'CS_SEGMENTATION_REMOVED',
      SEGMENTATION_MODIFIED: 'CS_SEGMENTATION_MODIFIED',
    },
  },
  segmentation: {
    state: {
      getSegmentation: vi.fn((id: string) => csSegState.segmentations.get(id) ?? { label: id }),
      getViewportIdsWithSegmentation: vi.fn(() => []),
    },
    config: {
      color: {
        getSegmentIndexColor: vi.fn(() => undefined),
      },
    },
    segmentLocking: {
      isSegmentIndexLocked: vi.fn(() => false),
    },
  },
}));

import * as containerBridge from './containerBridge';
import * as containerStoreSync from './containerStoreSync';
import { useContainerStore } from '../../stores/containerStore';
import { containerService } from './containerService';

beforeEach(() => {
  containerStoreSync.dispose();
  containerBridge.clearChangeListeners();
  containerBridge.clearAll();
  useContainerStore.getState()._replaceAll(new Map());
  csSegState.segmentations.clear();
});

afterEach(() => {
  containerStoreSync.dispose();
  containerBridge.clearChangeListeners();
  containerBridge.clearAll();
  useContainerStore.getState()._replaceAll(new Map());
  csSegState.segmentations.clear();
});

function fireSegmentationModified(csSegId: string): void {
  mockEventTarget.dispatchEvent(
    new CustomEvent('CS_SEGMENTATION_MODIFIED', { detail: { segmentationId: csSegId } }),
  );
}

describe('initial sync', () => {
  it('seeds the store with whatever the bridge already has at initialize() time', () => {
    containerBridge.register('seg_1', { name: 'A' });
    containerBridge.register('seg_2', { name: 'B' });
    containerStoreSync.initialize();

    const containers = useContainerStore.getState().containers;
    expect(containers.size).toBe(2);
  });

  it('initialize() is idempotent', () => {
    containerStoreSync.initialize();
    containerStoreSync.initialize();
    containerBridge.register('seg_1');
    expect(useContainerStore.getState().containers.size).toBe(1);
  });
});

describe('register / unregister propagation', () => {
  it('register on the bridge surfaces in the store', () => {
    containerStoreSync.initialize();
    containerBridge.register('seg_1', { name: 'New' });

    const containerId = containerBridge.getContainerId('seg_1')!;
    expect(useContainerStore.getState().containers.get(containerId)?.name).toBe('New');
  });

  it('unregister on the bridge drops the entry from the store', () => {
    containerStoreSync.initialize();
    const containerId = containerBridge.register('seg_1');
    expect(useContainerStore.getState().containers.has(containerId)).toBe(true);

    containerBridge.unregister('seg_1');
    expect(useContainerStore.getState().containers.has(containerId)).toBe(false);
  });
});

describe('bookkeeping setter propagation', () => {
  it('setDirty flips the store snapshot', () => {
    containerStoreSync.initialize();
    const containerId = containerBridge.register('seg_1');

    containerBridge.setDirty(containerId, true);
    expect(useContainerStore.getState().containers.get(containerId)?.dirty).toBe(true);

    containerBridge.setDirty(containerId, false);
    expect(useContainerStore.getState().containers.get(containerId)?.dirty).toBe(false);
  });

  it('setSaveInFlight surfaces in the store', () => {
    containerStoreSync.initialize();
    const containerId = containerBridge.register('seg_1');
    containerBridge.setSaveInFlight(containerId, true);
    expect(useContainerStore.getState().containers.get(containerId)?.saveInFlight).toBe(true);
  });

  it('setVersionToken surfaces in the store', () => {
    containerStoreSync.initialize();
    const containerId = containerBridge.register('seg_1');
    containerBridge.setVersionToken(containerId, 'v-abc');
    expect(useContainerStore.getState().containers.get(containerId)?.versionToken).toBe('v-abc');
  });

  it('idempotent setDirty does not push a duplicate snapshot (identity unchanged)', () => {
    containerStoreSync.initialize();
    const containerId = containerBridge.register('seg_1');
    containerBridge.setDirty(containerId, true);
    const before = useContainerStore.getState().containers.get(containerId);
    containerBridge.setDirty(containerId, true); // idempotent
    const after = useContainerStore.getState().containers.get(containerId);
    expect(after).toBe(before); // same object reference
  });
});

describe('containerService mutation propagation', () => {
  it('renameContainer surfaces the new name in the store', () => {
    containerStoreSync.initialize();
    const containerId = containerBridge.register('seg_1', { name: 'Original' });

    containerService.renameContainer(containerId, 'Renamed');
    expect(useContainerStore.getState().containers.get(containerId)?.name).toBe('Renamed');
    expect(useContainerStore.getState().containers.get(containerId)?.dirty).toBe(true);
  });

  it('approveContainer surfaces approved=true', () => {
    containerStoreSync.initialize();
    const containerId = containerBridge.register('seg_1');
    containerService.approveContainer(containerId, 'dr.smith');
    const c = useContainerStore.getState().containers.get(containerId);
    expect(c?.approval.approved).toBe(true);
    expect(c?.approval.reviewerName).toBe('dr.smith');
  });

  it('revokeApproval surfaces approved=false + audit history', () => {
    containerStoreSync.initialize();
    const containerId = containerBridge.register('seg_1');
    containerService.approveContainer(containerId, 'a');
    containerService.revokeApproval(containerId, 'b');
    const c = useContainerStore.getState().containers.get(containerId);
    expect(c?.approval.approved).toBe(false);
    expect(c?.approval.history).toHaveLength(2);
  });
});

describe('clearAll bulk event', () => {
  it('clearAll on the bridge drops every entry from the store', () => {
    containerStoreSync.initialize();
    containerBridge.register('seg_1');
    containerBridge.register('seg_2');
    expect(useContainerStore.getState().containers.size).toBe(2);

    containerBridge.clearAll();
    expect(useContainerStore.getState().containers.size).toBe(0);
  });
});

describe('snapshot immutability', () => {
  it('mutating the bridge’s Container after read does not affect the store snapshot', () => {
    containerStoreSync.initialize();
    const containerId = containerBridge.register('seg_1', { name: 'A' });
    const snapshot = useContainerStore.getState().containers.get(containerId)!;

    // Mutate the bridge's Container directly (simulating a code path that
    // mutates without calling notifyChange — the snapshot taken before
    // the mutation should be unaffected).
    const live = containerBridge.getContainer(containerId)!;
    live.name = 'Mutated bridge';

    // Snapshot still has the old name (sync only fires on notifyChange).
    expect(snapshot.name).toBe('A');
  });
});

describe('dispose lifecycle', () => {
  it('dispose stops propagating bridge changes to the store', () => {
    containerStoreSync.initialize();
    containerBridge.register('seg_1');
    expect(useContainerStore.getState().containers.size).toBe(1);

    containerStoreSync.dispose();
    expect(useContainerStore.getState().containers.size).toBe(0);

    // Subsequent bridge mutations should not surface (listener removed).
    containerBridge.register('seg_2');
    expect(useContainerStore.getState().containers.size).toBe(0);
  });

  it('dispose is idempotent', () => {
    containerStoreSync.initialize();
    containerStoreSync.dispose();
    expect(() => containerStoreSync.dispose()).not.toThrow();
  });
});

// ─── Phase 3.2b — Cornerstone segment → Member auto-sync ───────────────

describe('member auto-sync on SEGMENTATION_MODIFIED', () => {
  it('rebuilds Container.members[] from cs segments when a SEGMENTATION_MODIFIED event fires', () => {
    csSegState.segmentations.set('seg_1', {
      label: 'My SEG',
      segments: {
        1: { label: 'Tumor' },
        2: { label: 'Edema' },
      },
    });
    containerStoreSync.initialize();
    const containerId = containerBridge.register('seg_1');
    fireSegmentationModified('seg_1');

    const c = useContainerStore.getState().containers.get(containerId)!;
    expect(c.members).toHaveLength(2);
    expect(c.members.map((m) => m.name)).toEqual(['Tumor', 'Edema']);
    expect(c.members.map((m) => m.segmentIndex)).toEqual([1, 2]);
    expect(c.members.every((m) => m.csSegmentationId === 'seg_1')).toBe(true);
  });

  it('preserves Member identity (id + createdAt) across rebuilds when segmentIndex is unchanged', () => {
    csSegState.segmentations.set('seg_1', {
      segments: { 1: { label: 'Original' } },
    });
    containerStoreSync.initialize();
    const containerId = containerBridge.register('seg_1');
    fireSegmentationModified('seg_1');
    const before = useContainerStore.getState().containers.get(containerId)!.members[0];

    // Rename in cs state.
    csSegState.segmentations.set('seg_1', {
      segments: { 1: { label: 'Renamed' } },
    });
    fireSegmentationModified('seg_1');
    const after = useContainerStore.getState().containers.get(containerId)!.members[0];

    expect(after.id).toBe(before.id);
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.name).toBe('Renamed');
    expect(after.modifiedAt).toBeGreaterThanOrEqual(before.modifiedAt);
  });

  it('drops removed segments and keeps survivors stable', () => {
    csSegState.segmentations.set('seg_1', {
      segments: {
        1: { label: 'A' },
        2: { label: 'B' },
        3: { label: 'C' },
      },
    });
    containerStoreSync.initialize();
    const containerId = containerBridge.register('seg_1');
    fireSegmentationModified('seg_1');
    expect(useContainerStore.getState().containers.get(containerId)!.members).toHaveLength(3);

    // Remove segment 2 in cs state.
    csSegState.segmentations.set('seg_1', {
      segments: {
        1: { label: 'A' },
        3: { label: 'C' },
      },
    });
    fireSegmentationModified('seg_1');
    const after = useContainerStore.getState().containers.get(containerId)!.members;
    expect(after).toHaveLength(2);
    expect(after.map((m) => m.segmentIndex)).toEqual([1, 3]);
  });

  it('orders members by segmentIndex (default order per §B7)', () => {
    csSegState.segmentations.set('seg_1', {
      segments: {
        3: { label: 'Third' },
        1: { label: 'First' },
        2: { label: 'Second' },
      },
    });
    containerStoreSync.initialize();
    const containerId = containerBridge.register('seg_1');
    fireSegmentationModified('seg_1');
    const members = useContainerStore.getState().containers.get(containerId)!.members;
    expect(members.map((m) => m.segmentIndex)).toEqual([1, 2, 3]);
  });

  it('default visibility is "filled" for SEG, "outlined" for RTSTRUCT (D7.3)', () => {
    csSegState.segmentations.set('seg_1', { segments: { 1: { label: 'A' } } });
    csSegState.segmentations.set('rtstruct_1', { segments: { 1: { label: 'B' } } });
    containerStoreSync.initialize();
    const segId = containerBridge.register('seg_1');
    const rtId = containerBridge.register('rtstruct_1');
    fireSegmentationModified('seg_1');
    fireSegmentationModified('rtstruct_1');

    expect(useContainerStore.getState().containers.get(segId)!.members[0].visibility).toBe('filled');
    expect(useContainerStore.getState().containers.get(rtId)!.members[0].visibility).toBe('outlined');
  });

  it('SEGMENTATION_ADDED also triggers a rebuild', () => {
    csSegState.segmentations.set('seg_1', { segments: { 1: { label: 'Auto' } } });
    // Bring up the bridge's auto-track listener so SEGMENTATION_ADDED
    // auto-registers the container before our sync's listener rebuilds
    // members from cs state.
    containerBridge.initialize();
    try {
      containerStoreSync.initialize();

      mockEventTarget.dispatchEvent(
        new CustomEvent('CS_SEGMENTATION_ADDED', { detail: { segmentationId: 'seg_1' } }),
      );

      const containerId = containerBridge.getContainerId('seg_1')!;
      const members = useContainerStore.getState().containers.get(containerId)!.members;
      expect(members).toHaveLength(1);
      expect(members[0].name).toBe('Auto');
    } finally {
      containerBridge.dispose();
    }
  });

  it('skips events for unregistered segmentations (no bridge entry)', () => {
    containerStoreSync.initialize();
    expect(() => fireSegmentationModified('unknown')).not.toThrow();
    expect(useContainerStore.getState().containers.size).toBe(0);
  });

  it('member roiNumber is set to segmentIndex for RTSTRUCT containers', () => {
    csSegState.segmentations.set('rtstruct_1', { segments: { 1: { label: 'A' }, 2: { label: 'B' } } });
    containerStoreSync.initialize();
    const id = containerBridge.register('rtstruct_1');
    fireSegmentationModified('rtstruct_1');
    const members = useContainerStore.getState().containers.get(id)!.members;
    expect(members[0].roiNumber).toBe(1);
    expect(members[1].roiNumber).toBe(2);
  });

  it('member roiNumber is null for SEG containers', () => {
    csSegState.segmentations.set('seg_1', { segments: { 1: { label: 'A' } } });
    containerStoreSync.initialize();
    const id = containerBridge.register('seg_1');
    fireSegmentationModified('seg_1');
    expect(useContainerStore.getState().containers.get(id)!.members[0].roiNumber).toBeNull();
  });

  it('seeds members for pre-existing containers at initialize() time', () => {
    csSegState.segmentations.set('seg_1', { segments: { 1: { label: 'Pre-existing' } } });
    containerBridge.register('seg_1');

    // initialize() should seed the store AND rebuild members.
    containerStoreSync.initialize();
    const containerId = containerBridge.getContainerId('seg_1')!;
    const members = useContainerStore.getState().containers.get(containerId)!.members;
    expect(members).toHaveLength(1);
    expect(members[0].name).toBe('Pre-existing');
  });

  it('handles segmentations with no segments (empty container)', () => {
    csSegState.segmentations.set('seg_1', { segments: {} });
    containerStoreSync.initialize();
    const id = containerBridge.register('seg_1');
    fireSegmentationModified('seg_1');
    expect(useContainerStore.getState().containers.get(id)!.members).toEqual([]);
  });

  it('skips segments with invalid index (0 or negative)', () => {
    csSegState.segmentations.set('seg_1', {
      segments: {
        0: { label: 'Zero' },
        1: { label: 'One' },
        2: { label: 'Two' },
      } as Record<number, { label: string }>,
    });
    containerStoreSync.initialize();
    const id = containerBridge.register('seg_1');
    fireSegmentationModified('seg_1');
    const members = useContainerStore.getState().containers.get(id)!.members;
    expect(members.map((m) => m.segmentIndex)).toEqual([1, 2]);
  });
});

// ─── Phase 4.5: load-default provenance ────────────────────────────────

describe('Phase 4.5 default provenance', () => {
  afterEach(() => {
    containerStoreSync.resetLoadInProgressGate();
  });

  it('synthesizes members with provenance="manual" when no SEG load is in flight', () => {
    csSegState.segmentations.set('seg_1', { segments: { 1: { label: 'Fresh' } } });
    containerStoreSync.initialize();
    const id = containerBridge.register('seg_1');
    fireSegmentationModified('seg_1');
    const m = useContainerStore.getState().containers.get(id)!.members[0];
    expect(m.provenance).toBe('manual');
  });

  it('synthesizes members with provenance="imported" while the load gate returns true (§D7.2)', () => {
    let loadInFlight = true;
    containerStoreSync.setLoadInProgressGate(() => loadInFlight);
    csSegState.segmentations.set('seg_1', {
      segments: { 1: { label: 'GTV' }, 2: { label: 'PTV' } },
    });
    containerStoreSync.initialize();
    const id = containerBridge.register('seg_1');
    fireSegmentationModified('seg_1');
    const members = useContainerStore.getState().containers.get(id)!.members;
    expect(members.every((m) => m.provenance === 'imported')).toBe(true);
    loadInFlight = false;
  });

  it('preserves existing member’s provenance across rebuild even after load ends', () => {
    // Member was synthesized as "imported" during the load, then load
    // ends. A subsequent rebuild (e.g., user renames the segment) should
    // preserve the "imported" tag rather than re-defaulting to "manual"
    // — this is signal 22's "provenance survives where DICOM permits."
    let loadInFlight = true;
    containerStoreSync.setLoadInProgressGate(() => loadInFlight);
    csSegState.segmentations.set('seg_1', { segments: { 1: { label: 'GTV' } } });
    containerStoreSync.initialize();
    const id = containerBridge.register('seg_1');
    fireSegmentationModified('seg_1');
    loadInFlight = false;

    csSegState.segmentations.set('seg_1', { segments: { 1: { label: 'GTV (renamed)' } } });
    fireSegmentationModified('seg_1');
    const m = useContainerStore.getState().containers.get(id)!.members[0];
    expect(m.provenance).toBe('imported');
    expect(m.name).toBe('GTV (renamed)');
  });

  it('a thrown gate falls back to "manual" without breaking the rebuild', () => {
    containerStoreSync.setLoadInProgressGate(() => { throw new Error('boom'); });
    csSegState.segmentations.set('seg_1', { segments: { 1: { label: 'X' } } });
    containerStoreSync.initialize();
    const id = containerBridge.register('seg_1');
    fireSegmentationModified('seg_1');
    const m = useContainerStore.getState().containers.get(id)!.members[0];
    expect(m.provenance).toBe('manual');
  });
});
