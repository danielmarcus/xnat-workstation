/**
 * Container Store — reactive UI snapshot of every Container known to
 * `containerBridge`.
 *
 * Phase 3.2a. The store mirrors the bridge's Container state for React
 * components to subscribe to. Components never read the bridge directly —
 * they go through this store so re-renders fire on every relevant change.
 *
 * Sync model:
 *
 *   - `useContainerStore.containers: ReadonlyMap<containerId, Container>`
 *     is the reactive snapshot.
 *   - The Phase 3.2 `containerStoreSync` module subscribes to the bridge
 *     (via `containerBridge.subscribe`) and Cornerstone segmentation
 *     events, then re-derives the affected container's snapshot and
 *     pushes it via `_setContainer` / `_removeContainer`.
 *
 * What lives here vs. on the bridge:
 *
 *   - The bridge owns the cs-id → container-id mapping and the source-of-
 *     truth Container objects (with their internal mutation API).
 *   - The store owns the IMMUTABLE snapshots that components subscribe to.
 *     Each `_setContainer` call replaces the entry with a fresh shallow
 *     copy so React's identity-based change detection fires.
 *
 * Design §3.2 puts the bridge → store sync at the boundary between
 * "service-derived state" (Cornerstone, bridge mutations) and "UI-reactive
 * state" (Zustand). Components read the store; services read/write the
 * bridge; the sync layer keeps them in agreement.
 */
import { create } from 'zustand';
import type { Container } from '../types/annotation';

interface ContainerStoreState {
  containers: ReadonlyMap<string, Container>;

  // ─── Internal sync API (called by containerStoreSync) ─────────

  /** Replace the entry for `containerId` with a fresh shallow copy. */
  _setContainer: (containerId: string, container: Container) => void;

  /** Drop the entry for `containerId`. Idempotent. */
  _removeContainer: (containerId: string) => void;

  /** Replace the whole map (used on dispose / sign-out). */
  _replaceAll: (containers: ReadonlyMap<string, Container>) => void;
}

export const useContainerStore = create<ContainerStoreState>((set) => ({
  containers: new Map<string, Container>(),

  _setContainer: (containerId, container) =>
    set((state) => {
      const next = new Map(state.containers);
      // Shallow copy so React identity-comparison detects the change.
      next.set(containerId, { ...container });
      return { containers: next };
    }),

  _removeContainer: (containerId) =>
    set((state) => {
      if (!state.containers.has(containerId)) return {};
      const next = new Map(state.containers);
      next.delete(containerId);
      return { containers: next };
    }),

  _replaceAll: (containers) =>
    set({
      containers: new Map(containers),
    }),
}));

// ─── Selectors (convenience) ────────────────────────────────────

/** Read the container snapshot for a given containerId, or null if absent. */
export function selectContainer(containerId: string): Container | null {
  return useContainerStore.getState().containers.get(containerId) ?? null;
}

/** Read every container snapshot, in registration order. */
export function selectAllContainers(): Container[] {
  return Array.from(useContainerStore.getState().containers.values());
}
