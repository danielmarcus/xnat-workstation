/**
 * Queue-next-save + silent debounced autosave (A9 / E2).
 *
 * A per-container save state machine. Edits mark a container dirty; after a
 * debounced idle period (default 3000 ms, configurable; CLAUDE.md: silent — no
 * toast/banner, surfaced in-place via transportStore row state) the container is
 * saved. The model is **queue-next-save** (E2): while a save is in flight for a
 * container, further edits set the dirty flag but do NOT start a second concurrent
 * save; when the in-flight save completes, if the container became dirty again, a
 * follow-up save fires immediately — the user sees one continuous "saving" state
 * (no flicker to idle in between). Autosave never fires mid-gesture (mouse held,
 * polyline incomplete, handle drag) — the guard reschedules the debounce instead.
 *
 * Transport is INJECTED (`saveContainer`): in tests it is an in-memory double; in
 * the app it is the per-container XNAT transport (the deferred transport
 * workstream). This module owns only the scheduling/queue/retry policy, never the
 * serialization or the wire. Manual save (`flush`) bypasses the debounce + the
 * autosave-enabled flag but still respects single-flight (queues behind an
 * in-flight save) so two concurrent saves can never race (E2 rejects save-then-
 * amend).
 *
 * Outcomes:
 *  - `{ ok: true }`            → idle (or immediate follow-up if re-dirtied).
 *  - `{ ok: false, transient }`→ stays dirty; phase 'error'; debounce resumes (retry).
 *  - `{ ok: false, conflict }` → stays dirty; phase 'error'; NO auto-retry (the H7
 *                                conflict-resolution flow, owned by the transport
 *                                workstream, drives the next step).
 */

export type SaveOutcome =
  | { ok: true }
  | { ok: false; kind: 'transient' | 'conflict' | 'permanent'; error?: string };

export type SavePhase = 'saving' | 'idle' | 'error';

export interface SaveQueueDeps {
  /** Persist one container. Injected — in-memory double in tests, transport in app. */
  saveContainer(containerId: string): Promise<SaveOutcome>;
  /** True while a gesture is in progress — autosave must not fire (A9). */
  isGestureActive(): boolean;
  /** Debounce period in ms (read fresh each schedule — preferencesStore). */
  debounceMs(): number;
  /** Whether debounced autosave is enabled (manual flush ignores this). */
  isAutoSaveEnabled(): boolean;
  /** Surface per-container transport phase (wired to transportStore row state). */
  onPhase(containerId: string, phase: SavePhase, error?: string): void;
}

export interface SaveQueue {
  /** Mark a container dirty — (re)arms the debounce unless autosave is off. */
  notifyDirty(containerId: string): void;
  /** Manual save now — flushes pending debounce, serializes immediately (single-flight). */
  flush(containerId: string): Promise<void>;
  /** Cancel any pending debounce for a container (does not abort an in-flight save). */
  cancel(containerId: string): void;
  /** Drop all scheduling state (service reset). */
  reset(): void;
  /** Inspection (tests / UI). */
  state(containerId: string): { dirty: boolean; inFlight: boolean };
}

interface CState {
  dirty: boolean;
  inFlight: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

export function createSaveQueue(deps: SaveQueueDeps): SaveQueue {
  const byContainer = new Map<string, CState>();

  function stateFor(containerId: string): CState {
    let s = byContainer.get(containerId);
    if (!s) {
      s = { dirty: false, inFlight: false, timer: null };
      byContainer.set(containerId, s);
    }
    return s;
  }

  function clearTimer(s: CState): void {
    if (s.timer) {
      clearTimeout(s.timer);
      s.timer = null;
    }
  }

  function scheduleDebounce(containerId: string): void {
    const s = stateFor(containerId);
    clearTimer(s);
    s.timer = setTimeout(() => {
      s.timer = null;
      void runSave(containerId);
    }, deps.debounceMs());
  }

  async function runSave(containerId: string): Promise<void> {
    const s = stateFor(containerId);
    if (s.inFlight) return; // queue-next-save: completion handler re-runs
    if (!s.dirty) return;
    if (deps.isGestureActive()) {
      scheduleDebounce(containerId); // defer — never save mid-gesture
      return;
    }

    s.inFlight = true;
    s.dirty = false; // capture: we're persisting the current state
    clearTimer(s);
    deps.onPhase(containerId, 'saving');

    let outcome: SaveOutcome;
    try {
      outcome = await deps.saveContainer(containerId);
    } catch (err) {
      outcome = { ok: false, kind: 'transient', error: err instanceof Error ? err.message : String(err) };
    }
    s.inFlight = false;

    if (outcome.ok) {
      if (s.dirty) {
        // Edits arrived during the save — fire the follow-up immediately, staying
        // in the 'saving' state (no idle flicker). One continuous saving state (E2).
        void runSave(containerId);
      } else {
        deps.onPhase(containerId, 'idle');
      }
      return;
    }

    // Failure — keep the edits (dirty) and surface the error.
    s.dirty = true;
    deps.onPhase(containerId, 'error', outcome.error);
    if (outcome.kind === 'transient') {
      scheduleDebounce(containerId); // resume the debounce → retry
    }
    // conflict → no auto-retry; the H7 flow drives the next step.
  }

  return {
    notifyDirty(containerId: string): void {
      const s = stateFor(containerId);
      s.dirty = true;
      if (s.inFlight) return; // queued — completion handler will re-save
      if (!deps.isAutoSaveEnabled()) return; // off — only manual flush will save
      scheduleDebounce(containerId);
    },

    async flush(containerId: string): Promise<void> {
      const s = stateFor(containerId);
      clearTimer(s);
      s.dirty = true; // ensure a save happens even if nothing marked it
      if (s.inFlight) return; // single-flight — completion handler flushes the queue
      await runSave(containerId);
    },

    cancel(containerId: string): void {
      clearTimer(stateFor(containerId));
    },

    reset(): void {
      for (const s of byContainer.values()) clearTimer(s);
      byContainer.clear();
    },

    state(containerId: string): { dirty: boolean; inFlight: boolean } {
      const s = byContainer.get(containerId);
      return { dirty: s?.dirty ?? false, inFlight: s?.inFlight ?? false };
    },
  };
}
