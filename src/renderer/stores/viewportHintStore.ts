/**
 * Transient per-viewport hint store.
 *
 * Phase 2.5b: surfaces the B3 drawing-routing block hint inline at the
 * affected viewport, replacing the console.warn placeholder that
 * Phase 2.5a left in `installLockGuard`.
 *
 * Design notes
 *
 *   - Hints are non-modal, in-place, and auto-fade after a short TTL.
 *     Per requirement §D10 ("brief, non-modal hint") and the project
 *     no-banner rule (memory: "autosave and routine background events
 *     stay silent; surface state in-place, not as toasts"). Drawing-
 *     block hints are user-action responses, not routine background
 *     events, so the inline notice is appropriate.
 *
 *   - Setting a hint while one is already showing replaces it. The
 *     `revision` counter prevents the prior hint's auto-clear timer
 *     from clearing a newer hint that was set in the same viewport.
 *
 *   - Hints are session-only; never persisted.
 *
 *   - The store is a plain Zustand store (no `persist` middleware).
 *     Components read by viewportId; the lock-guard writes via
 *     `setHint`. There is no global getter — callers always specify a
 *     viewportId.
 */
import { create } from 'zustand';

/** A hint entry. The `message` is shown verbatim; the `revision` is internal. */
export interface ViewportHint {
  message: string;
  /** ms-since-epoch when the hint should disappear. */
  expiresAt: number;
  /** Internal counter so the auto-clear timer doesn't clear newer hints. */
  revision: number;
}

interface ViewportHintStore {
  hints: ReadonlyMap<string, ViewportHint>;
  setHint: (viewportId: string, message: string, ttlMs?: number) => void;
  clearHint: (viewportId: string) => void;
  /** Drop every hint. Used by tests + sign-out / panel-close cleanup. */
  clearAll: () => void;
}

/** Default time-to-live for a hint, in ms. */
export const DEFAULT_HINT_TTL_MS = 2500;

export const useViewportHintStore = create<ViewportHintStore>((set, get) => ({
  hints: new Map<string, ViewportHint>(),

  setHint: (viewportId, message, ttlMs = DEFAULT_HINT_TTL_MS) => {
    if (!viewportId || !message) return;
    const existing = get().hints.get(viewportId);
    const revision = (existing?.revision ?? 0) + 1;
    const expiresAt = Date.now() + ttlMs;

    set((state) => {
      const next = new Map(state.hints);
      next.set(viewportId, { message, expiresAt, revision });
      return { hints: next };
    });

    // Auto-clear after the TTL — but only if the hint wasn't replaced or
    // already cleared by something else. Revision check is the discriminator.
    setTimeout(() => {
      const current = get().hints.get(viewportId);
      if (current && current.revision === revision) {
        get().clearHint(viewportId);
      }
    }, ttlMs);
  },

  clearHint: (viewportId) =>
    set((state) => {
      if (!state.hints.has(viewportId)) return {};
      const next = new Map(state.hints);
      next.delete(viewportId);
      return { hints: next };
    }),

  clearAll: () => set({ hints: new Map() }),
}));
