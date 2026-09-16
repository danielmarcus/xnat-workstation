/**
 * Leave-with-unsaved-work prompt (proposal §4.2).
 *
 * The bridge between an async load (`loadFromXnatScan`) and a modal decision. The load
 * asks "may I proceed?" and awaits a single promise; the dialog owns the save-and-retry
 * loop, so a failed upload leaves the dialog open with an error instead of resolving and
 * forcing the caller to re-open it.
 *
 * Same shape as dialogStore's showConfirmDialog — a module-level resolver keyed to the
 * open request — but with three outcomes rather than two, and with the save actually
 * performed before the promise settles. Kept separate rather than generalising
 * dialogStore: that store's contract is a boolean and its host owns Enter/Escape, both of
 * which are wrong here (proposal §9.3 — Discard must never be one keystroke away).
 */
import { create } from 'zustand';
import type { LeavingEntry } from '../components/annotations/dialogs';

export type LeaveChoice = 'save' | 'discard' | 'cancel';

interface LeaveRequest {
  entries: LeavingEntry[];
  /** What is being left ("scan 4", a session label), for the dialog title. */
  leavingLabel?: string;
  /** Performs the save. Rejecting keeps the dialog open with the message. */
  save: (containerIds: string[]) => Promise<void>;
}

interface LeavePromptStore {
  request: LeaveRequest | null;
  busy: boolean;
  error: string | null;
  choose: (choice: LeaveChoice) => void;
}

let resolver: ((choice: LeaveChoice) => void) | null = null;

function settle(choice: LeaveChoice): void {
  const r = resolver;
  resolver = null;
  useLeavePromptStore.setState({ request: null, busy: false, error: null });
  r?.(choice);
}

export const useLeavePromptStore = create<LeavePromptStore>((set, get) => ({
  request: null,
  busy: false,
  error: null,

  choose: (choice) => {
    const { request, busy } = get();
    if (!request || busy) return; // a save in flight owns the dialog until it settles
    if (choice === 'cancel' || choice === 'discard') {
      settle(choice);
      return;
    }
    set({ busy: true, error: null });
    void request
      .save(request.entries.map((e) => e.containerId))
      .then(() => settle('save'))
      .catch((err: unknown) => {
        // Stay open: the user still has to choose between retrying and discarding, and
        // resolving here would let the load proceed over work that was never saved.
        set({ busy: false, error: err instanceof Error ? err.message : String(err) });
      });
  },
}));

export function requestLeaveDecision(request: LeaveRequest): Promise<LeaveChoice> {
  return new Promise((resolve) => {
    resolver = resolve;
    useLeavePromptStore.setState({ request, busy: false, error: null });
  });
}
