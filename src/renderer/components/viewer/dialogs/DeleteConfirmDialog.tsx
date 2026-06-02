/**
 * DeleteConfirmDialog — spec §4.4.2
 *
 * Three render forms decided from `xnatOrigin` + `memberCount`:
 *
 * 1. No XNAT origin, ≤ 1 member
 *      "Delete {name}? This cannot be undone."   [Cancel] [Delete (red)]
 *
 * 2. No XNAT origin, > 1 members
 *      "Delete {name}? Contains N {members}."    [Cancel] [Delete all (red)]
 *
 * 3. With XNAT origin
 *      Two destructive options: remote+local OR local-only, plus Cancel.
 *      The "delete remotely" option is destructive (red) and is NOT the
 *      default focus per spec.
 *
 * Self-contained React component — caller controls `open` and gets a
 * single `onConfirm(target)` callback with the chosen destructive
 * scope, or `onCancel`. No coupling to containerStore.
 */
import { useEffect, useRef } from 'react';

export type DeleteConfirmTarget = 'local' | 'local-and-remote';

export interface DeleteConfirmDialogProps {
  open: boolean;
  containerName: string;
  memberCount: number;
  /** Singular noun for one member, e.g. "segment" / "structure" / "measurement". */
  memberKindLabel: string;
  hasUnsavedChanges: boolean;
  xnatOrigin: { scanId: string; host?: string } | null;
  onCancel: () => void;
  onConfirm: (target: DeleteConfirmTarget) => void;
}

export default function DeleteConfirmDialog(props: DeleteConfirmDialogProps) {
  const {
    open,
    containerName,
    memberCount,
    memberKindLabel,
    hasUnsavedChanges,
    xnatOrigin,
    onCancel,
    onConfirm,
  } = props;

  // Initial focus: Cancel for safety (matches spec — destructive
  // action is never the default-focused button).
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (open) cancelBtnRef.current?.focus();
  }, [open]);

  // Escape closes the dialog.
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

  const hostLabel = xnatOrigin?.host ?? 'XNAT';
  const plural = pluralize(memberKindLabel, memberCount);

  return (
    <div
      data-testid="delete-confirm-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-confirm-title"
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
          <h3 id="delete-confirm-title" className="text-sm font-semibold text-zinc-100">
            Delete &ldquo;{containerName}&rdquo;?
          </h3>
        </div>

        <div className="px-4 py-3 text-xs text-zinc-300 space-y-2">
          {xnatOrigin ? (
            <>
              <p data-testid="delete-confirm-summary">
                {memberCount} {plural}.
                {hasUnsavedChanges ? ' Unsaved changes: ✓' : ''}
              </p>
              <div className="grid grid-cols-2 gap-3 pt-2 text-[11px]">
                <div className="rounded bg-zinc-800/60 border border-zinc-700 p-2">
                  <div className="text-zinc-500 mb-0.5">Local copy</div>
                  <div className="text-zinc-200">
                    {memberCount} {plural}
                  </div>
                </div>
                <div className="rounded bg-zinc-800/60 border border-zinc-700 p-2">
                  <div className="text-zinc-500 mb-0.5">On {hostLabel}</div>
                  <div className="text-zinc-200">scan #{xnatOrigin.scanId}</div>
                </div>
              </div>
            </>
          ) : memberCount > 1 ? (
            <p data-testid="delete-confirm-summary">
              Contains {memberCount} {plural}.
            </p>
          ) : (
            <p data-testid="delete-confirm-summary">This cannot be undone.</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-4 py-3">
          <button
            ref={cancelBtnRef}
            type="button"
            data-testid="delete-confirm-cancel"
            onClick={onCancel}
            className="rounded bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700"
          >
            Cancel
          </button>
          {xnatOrigin ? (
            <>
              <button
                type="button"
                data-testid="delete-confirm-local-only"
                onClick={() => onConfirm('local')}
                className="rounded bg-zinc-700 px-3 py-1.5 text-xs text-zinc-100 hover:bg-zinc-600"
              >
                Delete locally only
              </button>
              <button
                type="button"
                data-testid="delete-confirm-local-and-remote"
                onClick={() => onConfirm('local-and-remote')}
                className="rounded bg-red-600 px-3 py-1.5 text-xs text-white hover:bg-red-500"
              >
                Delete on {hostLabel} too
              </button>
            </>
          ) : (
            <button
              type="button"
              data-testid="delete-confirm-local-only"
              onClick={() => onConfirm('local')}
              className="rounded bg-red-600 px-3 py-1.5 text-xs text-white hover:bg-red-500"
            >
              {memberCount > 1 ? 'Delete all' : 'Delete'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function pluralize(noun: string, count: number): string {
  return count === 1 ? noun : `${noun}s`;
}
