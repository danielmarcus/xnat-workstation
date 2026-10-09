/**
 * Toasts — the "Toast" surface of the CLAUDE.md surface taxonomy: viewport-area scoped,
 * top-right, short-lived, for a user-initiated action that partially failed, was
 * refused, or briefly succeeded. One store, one host (ViewportToastHost); anything — a
 * component or a service — raises one with showToast().
 *
 * Each toast leaves by itself after its duration (default 3 s) and can be dismissed
 * sooner. Raising a message that is already showing restarts its timer instead of
 * stacking a copy (holding Delete on a locked contour shows one warning, not twenty).
 */
import { create } from 'zustand';

export type ToastTone = 'warning' | 'error' | 'success';

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastStore {
  toasts: Toast[];
  show: (message: string, tone?: ToastTone, durationMs?: number) => void;
  dismiss: (id: number) => void;
}

export const TOAST_DURATION_MS = 3000;
/** Never more than this many at once — the oldest goes first. */
const MAX_TOASTS = 3;

let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],

  show: (message, tone = 'warning', durationMs = TOAST_DURATION_MS) => {
    const existing = get().toasts.find((t) => t.message === message && t.tone === tone);
    const id = existing?.id ?? nextId++;
    if (!existing) {
      set((s) => {
        const toasts = [...s.toasts, { id, message, tone }];
        for (const dropped of toasts.slice(0, Math.max(0, toasts.length - MAX_TOASTS))) clearTimer(dropped.id);
        return { toasts: toasts.slice(-MAX_TOASTS) };
      });
    }
    clearTimer(id);
    timers.set(id, setTimeout(() => get().dismiss(id), durationMs));
  },

  dismiss: (id) => {
    clearTimer(id);
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

function clearTimer(id: number): void {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
}

/** Raise a toast (callable from services as well as components). */
export function showToast(message: string, tone: ToastTone = 'warning', durationMs?: number): void {
  useToastStore.getState().show(message, tone, durationMs);
}
