/**
 * Container Service — SKELETON (Phase 0 scaffolding, annotation rebuild).
 *
 * The eventual home for Container CRUD and kind dispatch (SEG / RTSTRUCT / SR),
 * coordinating Cornerstone3D state with the unified `Container` model
 * (src/shared/types/annotation.ts). For this slice it is intentionally inert:
 * a pure in-memory registry plus initialize/dispose, with NO Cornerstone wiring
 * yet. Nothing in the shipping app consumes it (gated behind multiviewport).
 *
 * Follows the singleton-module + initialize()/dispose() pattern of
 * annotationService.ts.
 */
import type { Container } from '@shared/types/annotation';

let initialized = false;
const registry = new Map<string, Container>();

export const containerService = {
  /** Begin tracking. Idempotent. */
  initialize(): void {
    if (initialized) return;
    initialized = true;
    console.log('[containerService] Initialized (skeleton)');
  },

  /** Register/replace a container in the in-memory registry. */
  register(container: Container): void {
    registry.set(container.id, container);
  },

  /** Look up a container by id. */
  getContainer(id: string): Container | undefined {
    return registry.get(id);
  },

  /** All currently-registered containers. */
  listContainers(): Container[] {
    return Array.from(registry.values());
  },

  /** Drop a container from the registry. Returns true if it existed. */
  unregister(id: string): boolean {
    return registry.delete(id);
  },

  /** Test/lifecycle helper. */
  isInitialized(): boolean {
    return initialized;
  },

  /** Clear all state and stop tracking. Idempotent. */
  dispose(): void {
    registry.clear();
    if (!initialized) return;
    initialized = false;
    console.log('[containerService] Disposed');
  },
};
