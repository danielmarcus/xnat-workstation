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

vi.mock('@cornerstonejs/tools', () => ({
  Enums: {
    Events: {
      SEGMENTATION_ADDED: 'CS_SEGMENTATION_ADDED',
      SEGMENTATION_REMOVED: 'CS_SEGMENTATION_REMOVED',
    },
  },
  segmentation: {
    state: {
      getSegmentation: vi.fn((id: string) => ({ label: id })),
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
});

afterEach(() => {
  containerStoreSync.dispose();
  containerBridge.clearChangeListeners();
  containerBridge.clearAll();
  useContainerStore.getState()._replaceAll(new Map());
});

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
