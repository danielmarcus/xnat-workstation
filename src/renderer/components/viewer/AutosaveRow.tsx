/**
 * AutosaveRow — bottom strip of the Annotations side panel.
 * Spec §4.9.
 *
 * Single line height (~24 px). Reads from the existing
 * `useSegmentationStore.autoSaveStatus` / `lastAutoSaveTime` so it
 * stays in lockstep with the autoSave service without a separate
 * status store.
 *
 * States:
 *  - idle    → hidden (row collapses)
 *  - saving  → subtle spinner + "Saving…" (zinc-400)
 *  - saved   → ✓ + "Backed up {duration} ago" (green-400, fades
 *              after 3 s); a 1 s ticking timer keeps the relative
 *              label fresh while it is visible.
 *  - error   → ⚠ + "Backup failed — retry" (red-400, click to retry;
 *              persists until the next saved transition).
 *
 * Per spec §11 the routine "saved" state stays inside this row — no
 * toasts or banners.
 */
import { useEffect, useState } from 'react';
import { useSegmentationStore } from '../../stores/segmentationStore';

export interface AutosaveRowProps {
  /** Called when the user clicks Retry in the error state. */
  onRetry?: () => void;
  /**
   * Test seam — substitute a clock so the relative-time math is
   * deterministic. Returns the current epoch ms. Defaults to
   * `Date.now`.
   */
  now?: () => number;
  /** Override how long the "saved" label stays visible (default 3000 ms). */
  savedDisplayMs?: number;
}

const DEFAULT_SAVED_DISPLAY_MS = 3000;

export default function AutosaveRow({ onRetry, now, savedDisplayMs }: AutosaveRowProps) {
  const status = useSegmentationStore((s) => s.autoSaveStatus);
  const lastAutoSaveTime = useSegmentationStore((s) => s.lastAutoSaveTime);
  const getNow = now ?? Date.now;
  const fadeMs = savedDisplayMs ?? DEFAULT_SAVED_DISPLAY_MS;

  // Tick once a second while we're showing the "saved" label so the
  // relative-time string updates ("Backed up 1s ago" → "2s ago" …).
  const [, setTick] = useState(0);
  useEffect(() => {
    if (status !== 'saved') return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [status]);

  // 'saved' fades to hidden after `fadeMs`. We don't mutate the
  // store — we just decide locally whether to render based on the
  // age of `lastAutoSaveTime` (so the row can come back if the
  // store transitions saved → saving → saved again).
  const savedAge = lastAutoSaveTime != null ? getNow() - lastAutoSaveTime : Infinity;
  const showSaved = status === 'saved' && savedAge < fadeMs;

  // Re-render once when the fade window closes so the row vanishes.
  useEffect(() => {
    if (status !== 'saved' || lastAutoSaveTime == null) return;
    const remaining = fadeMs - (getNow() - lastAutoSaveTime);
    if (remaining <= 0) {
      // Force a single re-render once we're past the fade window so
      // the row disappears (covers the case where the store sits at
      // 'saved' but the clock has moved past fadeMs since the
      // backup landed).
      const id = setTimeout(() => setTick((t) => t + 1), 0);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => setTick((t) => t + 1), remaining);
    return () => clearTimeout(id);
  }, [status, lastAutoSaveTime, fadeMs, getNow]);

  if (status === 'idle' || (status === 'saved' && !showSaved)) return null;

  if (status === 'saving') {
    return (
      <div
        data-testid="autosave-row"
        data-state="saving"
        className="flex items-center gap-1.5 px-3 py-1 border-t border-zinc-800/70 text-[11px] text-zinc-400"
        aria-live="polite"
      >
        <span
          className="w-2.5 h-2.5 border-[1.5px] border-zinc-600 border-t-zinc-300 rounded-full animate-spin"
          role="presentation"
        />
        <span>Saving…</span>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div
        data-testid="autosave-row"
        data-state="error"
        className="flex items-center gap-1.5 px-3 py-1 border-t border-red-900/40 text-[11px] text-red-400"
        aria-live="assertive"
      >
        <span aria-hidden>⚠</span>
        <span>Backup failed —</span>
        <button
          type="button"
          data-testid="autosave-retry"
          onClick={onRetry}
          disabled={!onRetry}
          className="underline hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          retry
        </button>
      </div>
    );
  }

  // status === 'saved' && showSaved
  return (
    <div
      data-testid="autosave-row"
      data-state="saved"
      className="flex items-center gap-1.5 px-3 py-1 border-t border-zinc-800/70 text-[11px] text-green-400"
      aria-live="polite"
    >
      <span aria-hidden>✓</span>
      <span>Backed up {formatAgo(savedAge)} ago</span>
    </div>
  );
}

/**
 * Compact relative-time formatter for the autosave row. Anything
 * under a minute is shown in seconds; under an hour, in minutes; the
 * value rounds down so "11 ms" still reads as "0s".
 */
export function formatAgo(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}
