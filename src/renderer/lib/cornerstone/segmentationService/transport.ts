/**
 * Per-container queue-next-save coordinator.
 *
 * Phase 2.8a. Implements requirement §E2:
 *
 *   When a save is in flight for container C, additional edits to C set the
 *   dirty flag and **do not** start a second concurrent save. When the in-
 *   flight save completes:
 *     - Success → if dirty (because edits arrived during the save), schedule
 *       a new save immediately (the user sees one continuous "saving" state).
 *     - Conflict → run the H7 resolution flow; local edits preserved.
 *     - Transient failure → keep dirty, surface a transient-failure indicator;
 *       autosave resumes its debounce timer.
 *     - Permanent failure → surface the error; container stays in memory.
 *
 * The save action itself is delegated to a `SaveAdapter` so this module
 * doesn't depend on the concrete save target (local backup vs. XNAT
 * upload vs. test stub). Tests pass synthetic adapters; production wires
 * the real one in 2.8b.
 *
 * State machine per container:
 *
 *      ┌──────────────────────────────────────────────────────────┐
 *      │                                                          │
 *      │   idle ──notifyDirty──▶ debouncing                        │
 *      │     ▲                       │                             │
 *      │     │                       │ debounce timer fires        │
 *      │     │                       ▼                             │
 *      │   conflict / fail ◀── saving ──notifyDirty──▶ saving-pending
 *      │                       │                            │       │
 *      │                       │ outcome                    │       │
 *      │                       ▼                            ▼       │
 *      │                    success                    success →     │
 *      │                                            (re-fire save)   │
 *      └──────────────────────────────────────────────────────────┘
 *
 * Module state lives at the file level (one coordinator per process).
 * Bridges to existing infrastructure:
 *
 *   - `containerBridge.setDirty / setSaveInFlight / setVersionToken`:
 *     Phase 2.6 bookkeeping setters that mirror Container summary state.
 *   - `useTransportStore`: per-container record (versionToken, saveInFlight,
 *     lastOutcome, lastError, externalChangePending) consumed by the list
 *     panel (Phase 3 D7.4 indicators).
 *
 * Notably NOT touched here:
 *
 *   - `autoSave.ts`'s suppression counters, dirty-tracking gates, or the
 *     existing `useSegmentationStore.hasUnsavedChanges` flag. Those live in
 *     the legacy global pipeline and stay unchanged. Phase 2.8b is responsible
 *     for the wire-up that runs both pipelines side by side under the
 *     multiViewport.enabled flag.
 */
import * as containerBridge from '../containerBridge';
import {
  useTransportStore,
  type TransportError,
} from '../../../stores/transportStore';
import type { SaveOutcome } from '../transportContractService';

// ─── Adapter (DI seam) ─────────────────────────────────────────────────

/**
 * The actual save action. Implementations:
 *   - Phase 2.8b default: bridges to existing `backupService` for local backup.
 *   - XNAT integration workstream: implements full server upload + version-
 *     token round-trip per the H contract.
 *   - Tests: synthetic outcomes for each branch of the state machine.
 */
export interface SaveAdapter {
  save(containerId: string): Promise<SaveOutcome>;
}

// ─── Per-container state ───────────────────────────────────────────────

type Status = 'idle' | 'debouncing' | 'saving' | 'saving-pending';

interface CoordinatorState {
  status: Status;
  debounceTimer: ReturnType<typeof setTimeout> | null;
}

const states = new Map<string, CoordinatorState>();
let adapter: SaveAdapter | null = null;
let debounceMs = 3000; // §3.4 default; user-configurable via setDebounceMs

function get(containerId: string): CoordinatorState {
  let s = states.get(containerId);
  if (!s) {
    s = { status: 'idle', debounceTimer: null };
    states.set(containerId, s);
  }
  return s;
}

// ─── Public API ────────────────────────────────────────────────────────

/** Install the save adapter. Replaces any prior adapter. */
export function setAdapter(a: SaveAdapter | null): void {
  adapter = a;
}

/**
 * Override the autosave debounce window (ms). §3.4 default is 3000 ms;
 * `preferencesStore.autosaveDebounceMs` will eventually drive this when
 * the autosave preferences land.
 */
export function setDebounceMs(ms: number): void {
  if (Number.isFinite(ms) && ms > 0) debounceMs = ms;
}

/** Read the current debounce value. Test-only; production reads from prefs. */
export function getDebounceMs(): number {
  return debounceMs;
}

/**
 * Notify the coordinator that a container's state has diverged from its
 * last-saved state (H3). Sets the bridge dirty flag and either schedules
 * a debounced save or — if a save is already in flight — marks the
 * "queue-next-save" pending bit so a follow-up save fires on completion.
 */
export function notifyDirty(containerId: string): void {
  if (!containerId) return;
  containerBridge.setDirty(containerId, true);

  const s = get(containerId);
  if (s.status === 'saving' || s.status === 'saving-pending') {
    s.status = 'saving-pending';
    return;
  }
  // idle or debouncing → reset the debounce timer.
  if (s.debounceTimer) {
    clearTimeout(s.debounceTimer);
  }
  s.status = 'debouncing';
  s.debounceTimer = setTimeout(() => {
    void startSave(containerId);
  }, debounceMs);
}

/**
 * Cancel a pending debounced save without saving. Idempotent. Used by
 * sign-out / container-delete cleanup.
 */
export function cancelPending(containerId: string): void {
  const s = states.get(containerId);
  if (!s) return;
  if (s.debounceTimer) {
    clearTimeout(s.debounceTimer);
    s.debounceTimer = null;
  }
  if (s.status === 'debouncing') {
    s.status = 'idle';
  }
}

/**
 * Force an immediate save, flushing any pending debounce. Used by the
 * manual Save button (Cmd-S / `container.save` hotkey).
 *
 * If a save is already in flight, sets pending so a follow-up save fires
 * on completion (single-flight per container; never two concurrent saves).
 *
 * Returns the outcome of the save, or null if a save is already running
 * and this call only set the pending flag.
 */
export async function flushNow(containerId: string): Promise<SaveOutcome | null> {
  if (!containerId) return null;
  const s = get(containerId);
  if (s.debounceTimer) {
    clearTimeout(s.debounceTimer);
    s.debounceTimer = null;
  }
  if (s.status === 'saving' || s.status === 'saving-pending') {
    s.status = 'saving-pending';
    return null;
  }
  return startSave(containerId);
}

/**
 * Drop every container's coordinator state. Used by tests + service
 * dispose. Cancels any pending debounce timers.
 */
export function clearAll(): void {
  for (const s of states.values()) {
    if (s.debounceTimer) clearTimeout(s.debounceTimer);
  }
  states.clear();
}

/** Test/debug accessor. */
export function _getStatus(containerId: string): Status {
  return states.get(containerId)?.status ?? 'idle';
}

// ─── Internals ─────────────────────────────────────────────────────────

async function startSave(containerId: string): Promise<SaveOutcome | null> {
  const s = get(containerId);
  s.debounceTimer = null;
  s.status = 'saving';

  if (!adapter) {
    // No adapter installed — leave bridge dirty + transient failure record so
    // callers know there's nothing wired yet. Stay in idle so the next dirty
    // event re-arms the debounce.
    s.status = 'idle';
    return null;
  }

  containerBridge.setSaveInFlight(containerId, true);
  useTransportStore.getState().beginSave(containerId);

  let outcome: SaveOutcome;
  try {
    outcome = await adapter.save(containerId);
  } catch (err) {
    const error: TransportError = {
      kind: 'transient',
      message: err instanceof Error ? err.message : String(err),
      cause: err,
      at: Date.now(),
    };
    outcome = { kind: 'transient-failure', error };
  }

  return finishSave(containerId, outcome);
}

function finishSave(containerId: string, outcome: SaveOutcome): SaveOutcome {
  const s = get(containerId);
  containerBridge.setSaveInFlight(containerId, false);
  const transportStore = useTransportStore.getState();

  switch (outcome.kind) {
    case 'success':
      transportStore.finishSaveSuccess(containerId, outcome.versionToken);
      containerBridge.setVersionToken(containerId, outcome.versionToken);
      if (s.status === 'saving-pending') {
        // Edits arrived during save → fire next save immediately, skipping
        // debounce. The user perceives one continuous "saving" state.
        s.status = 'idle';
        void startSave(containerId);
      } else {
        // Clean save: clear dirty.
        containerBridge.setDirty(containerId, false);
        s.status = 'idle';
      }
      break;

    case 'conflict':
      transportStore.finishSaveConflict(containerId);
      // Local edits preserved (bridge dirty stays true). Phase 2.8 doesn't
      // run the H7 resolution UX itself — that's a Phase 3 list-panel
      // concern. For now the conflict marker on the transportStore record
      // is the surface; resolveConflict() in transportContractService is
      // the entry point.
      s.status = 'idle';
      break;

    case 'transient-failure':
      transportStore.finishSaveTransientFailure(containerId, outcome.error);
      // Bridge dirty stays true; container can retry on next edit or via
      // manual flushNow.
      s.status = 'idle';
      break;

    case 'permanent-failure':
      transportStore.finishSavePermanentFailure(containerId, outcome.error);
      s.status = 'idle';
      break;
  }

  return outcome;
}
