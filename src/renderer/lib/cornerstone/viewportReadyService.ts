/**
 * Viewport Ready Service — deterministic viewport readiness barrier.
 *
 * Replaces all polling loops ("wait for viewport to exist") with an explicit
 * epoch-based promise registry. Each panel has an epoch counter that increments
 * whenever its imageIds change (causing viewport destroy/recreate). Callers
 * await `whenReady(panelId, epoch)` which resolves only when `markReady` is
 * called with the matching epoch. If the epoch is bumped again (stale), older
 * waiters reject with a clear "stale epoch" error so the caller can abort.
 *
 * No polling loops, no setTimeout chains — pure promise/registry.
 */

/** Per-panel registry entry */
interface PanelEntry {
  currentEpoch: number;
  /** Pending waiters keyed by epoch. Each waiter has resolve/reject + timeout id. */
  waiters: Map<number, Waiter[]>;
}

interface Waiter {
  resolve: () => void;
  reject: (err: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

const registry = new Map<string, PanelEntry>();

function getOrCreate(panelId: string): PanelEntry {
  let entry = registry.get(panelId);
  if (!entry) {
    entry = { currentEpoch: 0, waiters: new Map() };
    registry.set(panelId, entry);
  }
  return entry;
}

export const viewportReadyService = {
  /**
   * Increment the epoch for a panel and return the new epoch number.
   * Called when panel imageIds change (viewport will be destroyed and recreated).
   * Rejects all pending waiters for older epochs with "stale epoch" error.
   */
  bumpEpoch(panelId: string): number {
    const entry = getOrCreate(panelId);
    const oldEpoch = entry.currentEpoch;
    entry.currentEpoch++;
    const newEpoch = entry.currentEpoch;

    // Reject all waiters for the old epoch (and any older ones still lingering)
    for (const [epoch, waiters] of entry.waiters.entries()) {
      if (epoch < newEpoch) {
        for (const w of waiters) {
          clearTimeout(w.timeoutId);
          w.reject(new Error(
            `[viewportReadyService] Stale epoch for ${panelId}: waited on epoch ${epoch}, now at ${newEpoch}`
          ));
        }
        entry.waiters.delete(epoch);
      }
    }

    console.debug(`[viewportReadyService] bumpEpoch(${panelId}): ${oldEpoch} → ${newEpoch}`);
    return newEpoch;
  },

  /**
   * Get the current epoch for a panel. Returns 0 if panel has never been registered.
   */
  getEpoch(panelId: string): number {
    return getOrCreate(panelId).currentEpoch;
  },

  /**
   * Signal that a panel's viewport is fully ready (images loaded, rendered)
   * for the given epoch. Resolves all waiters for that exact epoch.
   */
  markReady(panelId: string, epoch: number): void {
    const entry = registry.get(panelId);
    if (!entry) return;

    // Only resolve waiters for this exact epoch
    const waiters = entry.waiters.get(epoch);
    if (waiters) {
      for (const w of waiters) {
        clearTimeout(w.timeoutId);
        w.resolve();
      }
      entry.waiters.delete(epoch);
    }

    console.debug(`[viewportReadyService] markReady(${panelId}, epoch=${epoch})`);
  },

  /**
   * Returns a promise that resolves when `markReady` is called for the given
   * panel + epoch. Rejects if:
   * - The epoch is already stale (panel has moved to a newer epoch)
   * - The timeout expires (default 15s)
   *
   * No polling — purely driven by markReady() and bumpEpoch() calls.
   */
  whenReady(panelId: string, epoch: number, timeoutMs = 15_000): Promise<void> {
    const entry = getOrCreate(panelId);

    // If this epoch is already stale, reject immediately
    if (epoch < entry.currentEpoch) {
      return Promise.reject(new Error(
        `[viewportReadyService] Stale epoch for ${panelId}: requested ${epoch}, current is ${entry.currentEpoch}`
      ));
    }

    return new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        // Remove this waiter on timeout
        const waiters = entry.waiters.get(epoch);
        if (waiters) {
          const idx = waiters.findIndex((w) => w.resolve === resolve);
          if (idx >= 0) waiters.splice(idx, 1);
          if (waiters.length === 0) entry.waiters.delete(epoch);
        }
        reject(new Error(
          `[viewportReadyService] Timeout waiting for ${panelId} epoch ${epoch} after ${timeoutMs}ms`
        ));
      }, timeoutMs);

      const waiter: Waiter = { resolve, reject, timeoutId };

      if (!entry.waiters.has(epoch)) {
        entry.waiters.set(epoch, []);
      }
      entry.waiters.get(epoch)!.push(waiter);
    });
  },

  /**
   * Clean up all state for a panel (e.g., on panel unmount).
   */
  removePanel(panelId: string): void {
    const entry = registry.get(panelId);
    if (entry) {
      for (const [, waiters] of entry.waiters) {
        for (const w of waiters) {
          clearTimeout(w.timeoutId);
          w.reject(new Error(`[viewportReadyService] Panel ${panelId} removed`));
        }
      }
      registry.delete(panelId);
    }
  },
};
