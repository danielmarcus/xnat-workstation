/**
 * SaveAllPreflightDialog — spec §4.4.4
 *
 * Modal listing every dirty container with a per-row action selector
 * and (for "Save as new copy") an inline name input. Live footer
 * summary line + Save-all button with count of non-skipped rows.
 *
 * Pure-render: caller passes in the dirty list (with kind, name,
 * member count, and origin info) and gets a single decision payload
 * back via `onConfirm(decisions)` when Save all is clicked.
 *
 * Per-row action depends on origin:
 *  - With XNAT origin: 'overwrite' (default) | 'copy' | 'skip'
 *  - Without XNAT origin: 'new' (default) | 'skip'
 *
 * For the 'copy' action, the caller-supplied default copy name
 * (e.g. `{name} (copy)`) is prefilled and editable inline.
 */
import { useEffect, useMemo, useState } from 'react';

export type SaveAllAction = 'overwrite' | 'copy' | 'new' | 'skip';

export interface SaveAllPreflightRow {
  containerId: string;
  containerName: string;
  /** Display tag (e.g. "SEG", "STRUCT", "MEAS"). */
  kindLabel: string;
  /** Localized "3 segments" / "2 structures" / "4 measurements". */
  memberSummary: string;
  /** When set, the row has an XNAT origin (existing assessor); otherwise it's new. */
  xnatOrigin: { scanId: string } | null;
  /** Default name used when the user picks "Save as new copy" (caller-supplied). */
  defaultCopyName: string;
}

export interface SaveAllDecision {
  containerId: string;
  action: SaveAllAction;
  /** Present only when `action === 'copy'`. The edited copy name. */
  copyName?: string;
}

export interface SaveAllPreflightDialogProps {
  open: boolean;
  rows: SaveAllPreflightRow[];
  onCancel: () => void;
  onConfirm: (decisions: SaveAllDecision[]) => void;
}

interface RowState {
  action: SaveAllAction;
  copyName: string;
}

export default function SaveAllPreflightDialog(props: SaveAllPreflightDialogProps) {
  const { open, rows, onCancel, onConfirm } = props;

  // Per-row state map. Defaults set on every open from the rows.
  const [rowState, setRowState] = useState<Record<string, RowState>>({});

  useEffect(() => {
    if (!open) return;
    const next: Record<string, RowState> = {};
    for (const r of rows) {
      next[r.containerId] = {
        action: r.xnatOrigin ? 'overwrite' : 'new',
        copyName: r.defaultCopyName,
      };
    }
    setRowState(next);
  }, [open, rows]);

  // Escape cancels.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  const summary = useMemo(() => {
    let overwrite = 0;
    let copy = 0;
    let asNew = 0;
    let skipped = 0;
    for (const r of rows) {
      const action = rowState[r.containerId]?.action;
      if (action === 'overwrite') overwrite++;
      else if (action === 'copy') copy++;
      else if (action === 'new') asNew++;
      else if (action === 'skip') skipped++;
    }
    return { overwrite, copy, new: asNew, skipped };
  }, [rows, rowState]);

  const nonSkippedCount = rows.length - summary.skipped;
  const submitDisabled = nonSkippedCount === 0 || rows.some((r) => {
    const s = rowState[r.containerId];
    return s?.action === 'copy' && !s.copyName.trim();
  });

  const onCommit = () => {
    if (submitDisabled) return;
    const decisions: SaveAllDecision[] = rows.map((r) => {
      const s = rowState[r.containerId] ?? {
        action: r.xnatOrigin ? 'overwrite' : 'new',
        copyName: r.defaultCopyName,
      };
      return s.action === 'copy'
        ? { containerId: r.containerId, action: 'copy', copyName: s.copyName.trim() }
        : { containerId: r.containerId, action: s.action };
    });
    onConfirm(decisions);
  };

  if (!open) return null;

  return (
    <div
      data-testid="save-all-preflight-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-all-preflight-title"
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
    >
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-zinc-950/70"
        onClick={onCancel}
      />

      <div className="relative w-full max-w-2xl rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl flex flex-col max-h-[80vh]">
        <div className="border-b border-zinc-800 px-4 py-3">
          <h3 id="save-all-preflight-title" className="text-sm font-semibold text-zinc-100">
            Save all annotations to XNAT
          </h3>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            {rows.length} with unsaved changes — review each, then run the batch.
          </p>
        </div>

        <ul
          data-testid="save-all-preflight-rows"
          className="overflow-y-auto divide-y divide-zinc-800/70 flex-1"
        >
          {rows.map((row) => {
            const state = rowState[row.containerId];
            if (!state) return null;
            return (
              <li
                key={row.containerId}
                data-testid={`save-all-row:${row.containerId}`}
                data-action={state.action}
                className="px-4 py-3 flex items-start gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs text-zinc-100">
                    <span className="text-[10px] font-mono uppercase px-1 bg-zinc-800 rounded border border-zinc-700 text-zinc-300">
                      {row.kindLabel}
                    </span>
                    <span className="truncate">{row.containerName}</span>
                  </div>
                  <div className="text-[11px] text-zinc-400 mt-0.5">
                    {row.memberSummary} ·{' '}
                    {row.xnatOrigin
                      ? `existing #${row.xnatOrigin.scanId}`
                      : 'new'}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <select
                    data-testid={`save-all-action-select:${row.containerId}`}
                    aria-label={`Action for ${row.containerName}`}
                    value={state.action}
                    onChange={(e) => {
                      const next = e.target.value as SaveAllAction;
                      setRowState((prev) => ({
                        ...prev,
                        [row.containerId]: { ...state, action: next },
                      }));
                    }}
                    className="text-xs bg-zinc-800 text-zinc-100 border border-zinc-700 rounded px-2 py-1 focus:border-blue-500 outline-none"
                  >
                    {row.xnatOrigin ? (
                      <>
                        <option value="overwrite">Overwrite existing</option>
                        <option value="copy">Save as new copy</option>
                        <option value="skip">Skip</option>
                      </>
                    ) : (
                      <>
                        <option value="new">Save as new on XNAT</option>
                        <option value="skip">Skip</option>
                      </>
                    )}
                  </select>
                  {state.action === 'copy' && (
                    <input
                      data-testid={`save-all-copy-name:${row.containerId}`}
                      type="text"
                      value={state.copyName}
                      placeholder="New copy name"
                      onChange={(e) =>
                        setRowState((prev) => ({
                          ...prev,
                          [row.containerId]: { ...state, copyName: e.target.value },
                        }))
                      }
                      className="text-xs bg-zinc-800 text-zinc-100 border border-zinc-700 rounded px-2 py-1 w-44 focus:border-blue-500 outline-none"
                      aria-label={`New copy name for ${row.containerName}`}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <div className="border-t border-zinc-800 px-4 py-2 text-[11px] text-zinc-400">
          <span data-testid="save-all-summary">
            {summary.overwrite} overwrite · {summary.copy} copy · {summary.new} new · {summary.skipped} skipped
          </span>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-4 py-3">
          <button
            type="button"
            data-testid="save-all-cancel"
            onClick={onCancel}
            className="rounded bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="save-all-commit"
            disabled={submitDisabled}
            onClick={onCommit}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Save all ({nonSkippedCount})
          </button>
        </div>
      </div>
    </div>
  );
}
