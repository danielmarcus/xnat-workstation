/**
 * Toast notification service.
 *
 * Implements spec §11 (MV-Phase 7 / issue #77). Provides a viewport-area-scoped
 * notification surface for user-initiated actions that don't need a dialog.
 *
 * Design points (all from spec §11):
 *
 *   - 4 kinds: success · info · warning · error.
 *   - Per-kind default duration: 3s for success/info, 5s for warning,
 *     persistent (null) for error. Caller may override via `duration`.
 *   - Stack cap of 3 visible at any time. New toasts push onto the stack;
 *     when the cap is exceeded, the oldest is dismissed (FIFO).
 *   - Click-to-dismiss is implemented by the consumer (`<ToastStack />`)
 *     calling `dismiss(id)`.
 *   - Hover pauses the auto-dismiss timer: the consumer calls
 *     `pauseTimer(id)` / `resumeTimer(id)`. Pausing clears the underlying
 *     setTimeout and records remaining time; resuming schedules a fresh
 *     timeout for the remaining time.
 *   - Optional `action: { label, onClick }`. The consumer renders an inline
 *     button; clicking it invokes the handler AND dismisses the toast.
 *
 * Routine events (autosave success) are NOT emitted as toasts — see the
 * "Notifications / surface taxonomy" section in CLAUDE.md. Toasts are
 * reserved for user-initiated actions and partial-failure batch outcomes.
 */
import { create } from 'zustand';

export type ToastKind = 'success' | 'info' | 'warning' | 'error';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  /** Unique id assigned at notify time. */
  id: string;
  kind: ToastKind;
  message: string;
  /** Optional second-line detail. */
  detail?: string;
  /** Optional inline action button. Clicking the action invokes onClick + dismisses the toast. */
  action?: ToastAction;
  /**
   * Wall-clock time (ms-since-epoch) the toast will auto-dismiss.
   * `null` means persistent (currently for `error` kind by default) OR
   * paused (hover pause clears the timer and sets this to null while
   * recording `remainingMs`).
   */
  expiresAt: number | null;
  /** Set only while paused. ms remaining when the user resumes. */
  remainingMs: number | null;
  /** Wall-clock time the toast was created. Used for stable sort. */
  createdAt: number;
}

export interface NotifyOptions {
  kind: ToastKind;
  message: string;
  detail?: string;
  action?: ToastAction;
  /**
   * Override the per-kind default duration in ms. Pass `null` to make the
   * toast persistent. Pass `undefined` (or omit) to use the kind default.
   */
  duration?: number | null;
}

/** Per-kind default duration in ms; `null` = persistent. */
export const DEFAULT_DURATIONS: Record<ToastKind, number | null> = {
  success: 3000,
  info: 3000,
  warning: 5000,
  error: null,
};

/** Maximum number of toasts visible at once. Older toasts are dropped (FIFO). */
export const MAX_VISIBLE = 3;

interface ToastStoreState {
  toasts: ReadonlyArray<Toast>;
  /** Add a toast. Returns the assigned id. */
  notify: (options: NotifyOptions) => string;
  /** Remove a toast by id. No-op if the id is unknown. */
  dismiss: (id: string) => void;
  /** Clear the auto-dismiss timer for a toast (hover-pause). */
  pauseTimer: (id: string) => void;
  /** Reschedule the auto-dismiss timer with the recorded remaining time. */
  resumeTimer: (id: string) => void;
  /** Remove all toasts. Used by tests and sign-out / session-reset paths. */
  clearAll: () => void;
}

/**
 * Map of toast id → underlying setTimeout handle. Kept outside the Zustand
 * state so timer handles don't trigger re-renders and don't end up in
 * subscribers' state slices.
 */
const timers: Map<string, ReturnType<typeof setTimeout>> = new Map();

function clearTimer(id: string): void {
  const handle = timers.get(id);
  if (handle !== undefined) {
    clearTimeout(handle);
    timers.delete(id);
  }
}

function scheduleDismiss(id: string, ms: number, dismiss: (id: string) => void): void {
  clearTimer(id);
  const handle = setTimeout(() => {
    timers.delete(id);
    dismiss(id);
  }, ms);
  timers.set(id, handle);
}

let nextId = 1;
function makeId(): string {
  // Stable, monotonic, easy to read in tests. Uniqueness sufficient within
  // a single renderer process.
  return `t${nextId++}`;
}

export const useToastStore = create<ToastStoreState>((set, get) => ({
  toasts: [],

  notify: ({ kind, message, detail, action, duration }) => {
    const id = makeId();
    const createdAt = Date.now();
    const resolvedDuration = duration === undefined ? DEFAULT_DURATIONS[kind] : duration;
    const expiresAt = resolvedDuration === null ? null : createdAt + resolvedDuration;

    const toast: Toast = {
      id,
      kind,
      message,
      detail,
      action,
      expiresAt,
      remainingMs: null,
      createdAt,
    };

    set((state) => {
      const next = [...state.toasts, toast];
      // Stack cap: drop the oldest entries until at most MAX_VISIBLE remain.
      // Dropping also clears any timer those toasts had scheduled.
      while (next.length > MAX_VISIBLE) {
        const dropped = next.shift()!;
        clearTimer(dropped.id);
      }
      return { toasts: next };
    });

    if (resolvedDuration !== null && resolvedDuration > 0) {
      scheduleDismiss(id, resolvedDuration, get().dismiss);
    }

    return id;
  },

  dismiss: (id) => {
    clearTimer(id);
    set((state) => {
      const next = state.toasts.filter((t) => t.id !== id);
      if (next.length === state.toasts.length) return {};
      return { toasts: next };
    });
  },

  pauseTimer: (id) => {
    const toast = get().toasts.find((t) => t.id === id);
    if (!toast || toast.expiresAt === null) return; // already paused or persistent
    const remainingMs = Math.max(0, toast.expiresAt - Date.now());
    clearTimer(id);
    set((state) => ({
      toasts: state.toasts.map((t) =>
        t.id === id ? { ...t, expiresAt: null, remainingMs } : t,
      ),
    }));
  },

  resumeTimer: (id) => {
    const toast = get().toasts.find((t) => t.id === id);
    if (!toast || toast.remainingMs === null) return; // not paused
    const remainingMs = toast.remainingMs;
    const expiresAt = Date.now() + remainingMs;
    set((state) => ({
      toasts: state.toasts.map((t) =>
        t.id === id ? { ...t, expiresAt, remainingMs: null } : t,
      ),
    }));
    if (remainingMs > 0) {
      scheduleDismiss(id, remainingMs, get().dismiss);
    } else {
      // Already expired while paused — dismiss synchronously.
      get().dismiss(id);
    }
  },

  clearAll: () => {
    for (const id of timers.keys()) clearTimeout(timers.get(id)!);
    timers.clear();
    set({ toasts: [] });
  },
}));

/**
 * Convenience helper for non-React callers. The component subscribes
 * directly to `useToastStore.toasts`; non-component code can call this
 * to emit a toast without importing the hook.
 */
export const toastService = {
  notify(options: NotifyOptions): string {
    return useToastStore.getState().notify(options);
  },
  dismiss(id: string): void {
    useToastStore.getState().dismiss(id);
  },
  clearAll(): void {
    useToastStore.getState().clearAll();
  },
};

/** Test-only: reset the id counter so tests get predictable ids. */
export function __resetToastIdCounterForTests(): void {
  nextId = 1;
}
