/**
 * ExistingSaveDialog — spec §4.4.3
 *
 * Surfaces when the user clicks "Save to XNAT…" on a container whose
 * XNAT origin remote version differs (the conflict detection lives
 * upstream). The dialog has two modes:
 *
 *  - Choose mode: show local vs remote summary; offer Cancel /
 *    Create new… / Overwrite (red).
 *  - Name mode: name input prefilled with `{name} (copy)`; offer
 *    Back / Cancel / Create.
 *
 * Mode is internal local state — opens in Choose; "Create new…"
 * transitions to Name mode. "Back" returns to Choose. The single
 * exit callbacks are:
 *  - `onCancel()`     — user backed out.
 *  - `onOverwrite()`  — destructive overwrite confirmed.
 *  - `onCreateNew(newName)` — Create-new path confirmed with the
 *    edited name (trimmed; never empty).
 */
import { useEffect, useRef, useState } from 'react';

export interface ExistingSaveDialogProps {
  open: boolean;
  containerName: string;
  scanId: string;
  /** Localized phrase like "3 segments" / "2 structures". */
  localSummary: string;
  /** Localized phrase like "5 segments, 2 days ago". */
  remoteSummary: string;
  onCancel: () => void;
  onOverwrite: () => void;
  onCreateNew: (newName: string) => void;
}

export default function ExistingSaveDialog(props: ExistingSaveDialogProps) {
  const {
    open,
    containerName,
    scanId,
    localSummary,
    remoteSummary,
    onCancel,
    onOverwrite,
    onCreateNew,
  } = props;

  const [mode, setMode] = useState<'choose' | 'name'>('choose');
  const [nameValue, setNameValue] = useState('');
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  // Reset internal state whenever the dialog reopens for a new
  // container — prevents Name mode and stale name from leaking
  // between successive opens.
  useEffect(() => {
    if (open) {
      setMode('choose');
      setNameValue(`${containerName} (copy)`);
    }
  }, [open, containerName]);

  // Initial focus on Cancel in Choose mode; on the name input
  // (selected) in Name mode.
  useEffect(() => {
    if (!open) return;
    if (mode === 'choose') {
      cancelBtnRef.current?.focus();
    } else {
      const inp = nameInputRef.current;
      inp?.focus();
      inp?.select();
    }
  }, [open, mode]);

  // Escape cancels (from either mode).
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

  if (!open) return null;

  const trimmedName = nameValue.trim();

  return (
    <div
      data-testid="existing-save-dialog"
      data-mode={mode}
      role="dialog"
      aria-modal="true"
      aria-labelledby="existing-save-title"
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
    >
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-zinc-950/70"
        onClick={onCancel}
      />

      <div className="relative w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="border-b border-zinc-800 px-4 py-3">
          <h3 id="existing-save-title" className="text-sm font-semibold text-zinc-100">
            {mode === 'choose'
              ? <>&ldquo;{containerName}&rdquo; already exists on XNAT</>
              : 'New name on XNAT'}
          </h3>
          {mode === 'choose' && (
            <p className="text-[11px] text-zinc-500 mt-0.5">
              Existing assessor on scan #{scanId}.
            </p>
          )}
        </div>

        {mode === 'choose' ? (
          <div className="px-4 py-3 text-xs text-zinc-300 space-y-2">
            <div data-testid="existing-save-local-summary" className="flex gap-2">
              <span className="text-zinc-500 w-14 shrink-0">Local:</span>
              <span className="text-zinc-200">{localSummary}</span>
            </div>
            <div data-testid="existing-save-remote-summary" className="flex gap-2">
              <span className="text-zinc-500 w-14 shrink-0">Remote:</span>
              <span className="text-zinc-200">{remoteSummary}</span>
            </div>
          </div>
        ) : (
          <div className="px-4 py-3">
            <input
              ref={nameInputRef}
              data-testid="existing-save-name-input"
              type="text"
              className="w-full text-xs text-zinc-100 bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 outline-none focus:border-blue-500"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (trimmedName) onCreateNew(trimmedName);
                }
              }}
              placeholder="Name for the new assessor"
              aria-label="New assessor name"
            />
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-4 py-3">
          {mode === 'name' && (
            <button
              type="button"
              data-testid="existing-save-back"
              onClick={() => setMode('choose')}
              className="rounded bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700 mr-auto"
            >
              ← Back
            </button>
          )}
          <button
            ref={cancelBtnRef}
            type="button"
            data-testid="existing-save-cancel"
            onClick={onCancel}
            className="rounded bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700"
          >
            Cancel
          </button>
          {mode === 'choose' ? (
            <>
              <button
                type="button"
                data-testid="existing-save-create-new"
                onClick={() => setMode('name')}
                className="rounded bg-blue-700 px-3 py-1.5 text-xs text-white hover:bg-blue-600"
              >
                Create new…
              </button>
              <button
                type="button"
                data-testid="existing-save-overwrite"
                onClick={onOverwrite}
                className="rounded bg-red-600 px-3 py-1.5 text-xs text-white hover:bg-red-500"
              >
                Overwrite
              </button>
            </>
          ) : (
            <button
              type="button"
              data-testid="existing-save-create"
              onClick={() => trimmedName && onCreateNew(trimmedName)}
              disabled={!trimmedName}
              className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Create
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
