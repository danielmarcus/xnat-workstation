/**
 * Container Store Sync — keeps `useContainerStore` in agreement with
 * `containerBridge` (and, in Phase 3.2b, Cornerstone segmentation events
 * that drive Member auto-population).
 *
 * Phase 3.2a wires the bridge → store sync. Phase 3.2b extends with the
 * Cornerstone event hookup that re-derives `Container.members[]` from
 * `csSegmentation.state.getSegmentation(segId).segments` on every
 * SEGMENTATION_MODIFIED.
 *
 * Lifecycle (mirrors the existing service modules):
 *   - `initialize()` subscribes once at service init.
 *   - `dispose()` unsubscribes and clears the store.
 *   - Idempotent — calling initialize() twice is safe; the second call
 *     is a no-op.
 *
 * Wired from `segmentationService.initialize()` / `.dispose()` alongside
 * the existing containerBridge.initialize() / .dispose() so the sync
 * starts in lockstep with bridge auto-track.
 */
import * as containerBridge from './containerBridge';
import { useContainerStore } from '../../stores/containerStore';

let initialized = false;
let bridgeUnsubscribe: (() => void) | null = null;

/**
 * Re-derive the snapshot for one container from the bridge and push to
 * the store. If the container no longer exists in the bridge, drop the
 * store entry.
 */
function syncOne(containerId: string): void {
  const container = containerBridge.getContainer(containerId);
  const store = useContainerStore.getState();
  if (container) {
    store._setContainer(containerId, container);
  } else {
    store._removeContainer(containerId);
  }
}

/**
 * Re-derive the full snapshot from every bridge entry. Used on bulk
 * events (clearAll) and at initialize() to seed the store with whatever
 * the bridge already knows about.
 */
function syncAll(): void {
  const next = new Map();
  for (const { containerId } of containerBridge.listAll()) {
    const container = containerBridge.getContainer(containerId);
    if (container) {
      // Defensive shallow-copy so the store's snapshot is independent of
      // future bridge mutations.
      next.set(containerId, { ...container });
    }
  }
  useContainerStore.getState()._replaceAll(next);
}

export function initialize(): void {
  if (initialized) return;

  // Seed the store with whatever the bridge already has — covers the case
  // where bridge.initialize() fired SEGMENTATION_ADDED events before this
  // sync was wired up.
  syncAll();

  bridgeUnsubscribe = containerBridge.subscribe((containerId) => {
    if (containerId === null) {
      syncAll();
    } else {
      syncOne(containerId);
    }
  });

  initialized = true;
}

export function dispose(): void {
  if (!initialized) return;
  if (bridgeUnsubscribe) {
    bridgeUnsubscribe();
    bridgeUnsubscribe = null;
  }
  useContainerStore.getState()._replaceAll(new Map());
  initialized = false;
}
