/**
 * RecoveryDialog — batched session-load recovery prompt.
 * Spec §12.5.
 *
 * Replaces the prior per-entry modal sequence with a single dialog
 * listing every recoverable backup, each with a checkbox. The
 * "Recover selected (N)" button reflects the live selection count;
 * "Skip all" closes without recovering anything (skipped backups
 * remain available in Settings → Backup → Cached Backups).
 *
 * Pure-render: caller owns the items list + decisions. Items default
 * to checked (the common case is "recover them all"); a caller can
 * override via `item.defaultSelected = false`.
 */
import { useEffect, useMemo, useState } from 'react';

export interface RecoveryItem {
  /** Stable identifier — typically the backup filename. */
  id: string;
  /** Display name for the container. */
  name: string;
  /** Localized summary like "3 segments" / "2 structures" / "4 measurements". */
  summary: string;
  /** Localized relative-time label like "2h ago" / "yesterday". */
  ageLabel: string;
  /** Default check state (defaults to true). */
  defaultSelected?: boolean;
}

export interface RecoveryDialogProps {
  open: boolean;
  /** Required — used for the "N sessions have unsaved backups" header. */
  sessionLabel?: string;
  items: ReadonlyArray<RecoveryItem>;
  onSkipAll: () => void;
  onRecover: (selectedIds: string[]) => void;
}

export default function RecoveryDialog({
  open,
  sessionLabel,
  items,
  onSkipAll,
  onRecover,
}: RecoveryDialogProps) {
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  // Re-seed defaults whenever the dialog opens or the items change.
  useEffect(() => {
    if (!open) return;
    const next: Record<string, boolean> = {};
    for (const item of items) {
      next[item.id] = item.defaultSelected ?? true;
    }
    setSelected(next);
  }, [open, items]);

  // Esc → Skip all.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onSkipAll();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onSkipAll]);

  const selectedIds = useMemo(
    () => items.filter((i) => selected[i.id]).map((i) => i.id),
    [items, selected],
  );

  if (!open) return null;

  return (
    <div
      data-testid="recovery-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="recovery-dialog-title"
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
    >
      <button
        type="button"
        aria-label="Skip recovery"
        data-testid="recovery-dialog-scrim"
        className="absolute inset-0 bg-zinc-950/70"
        onClick={onSkipAll}
      />

      <div className="relative w-full max-w-lg max-h-[80vh] rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl flex flex-col">
        <div className="border-b border-zinc-800 px-4 py-3">
          <h3 id="recovery-dialog-title" className="text-sm font-semibold text-zinc-100">
            Recover unsaved annotations?
          </h3>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            {sessionLabel ? `${sessionLabel} has ` : 'This session has '}
            {items.length} backup{items.length === 1 ? '' : 's'} newer than the last XNAT save.
          </p>
        </div>

        <ul
          data-testid="recovery-dialog-rows"
          className="overflow-y-auto divide-y divide-zinc-800/70 flex-1"
        >
          {items.map((item) => {
            const checked = selected[item.id] ?? true;
            return (
              <li
                key={item.id}
                data-testid={`recovery-row:${item.id}`}
                data-selected={checked || undefined}
                className="flex items-start gap-2 px-4 py-2 text-xs"
              >
                <input
                  type="checkbox"
                  data-testid={`recovery-row-check:${item.id}`}
                  checked={checked}
                  onChange={(e) =>
                    setSelected((prev) => ({ ...prev, [item.id]: e.target.checked }))
                  }
                  aria-label={`Recover ${item.name}`}
                  className="mt-0.5 w-3.5 h-3.5 rounded border-zinc-600 bg-zinc-800 accent-blue-500"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-zinc-100 truncate">{item.name}</div>
                  <div className="text-[11px] text-zinc-400">
                    {item.summary} · {item.ageLabel}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center justify-between gap-2 border-t border-zinc-800 px-4 py-3">
          <button
            type="button"
            data-testid="recovery-dialog-skip"
            onClick={onSkipAll}
            className="rounded bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700"
          >
            Skip all
          </button>
          <button
            type="button"
            data-testid="recovery-dialog-recover"
            onClick={() => onRecover(selectedIds)}
            disabled={selectedIds.length === 0}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Recover selected ({selectedIds.length})
          </button>
        </div>
      </div>
    </div>
  );
}
