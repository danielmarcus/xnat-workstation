/**
 * CloseUnsavedDialog (Change 1b) — shown when the user tries to quit with unsaved
 * annotations. Offers Save & quit / Quit without saving / Cancel. Presentational;
 * the close handshake + save are driven by useAppCloseGuard.
 */
export interface CloseUnsavedDialogProps {
  open: boolean;
  unsavedCount: number;
  onSaveAndQuit: () => void;
  onQuitWithoutSaving: () => void;
  onCancel: () => void;
}

export default function CloseUnsavedDialog({
  open,
  unsavedCount,
  onSaveAndQuit,
  onQuitWithoutSaving,
  onCancel,
}: CloseUnsavedDialogProps) {
  if (!open) return null;
  const noun = `${unsavedCount} unsaved annotation${unsavedCount === 1 ? '' : 's'}`;

  return (
    <div className="absolute inset-0 z-[90] bg-zinc-950/70 flex items-center justify-center p-4" role="presentation">
      <div className="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl" role="dialog" aria-modal="true" data-testid="close-unsaved-dialog">
        <div className="px-4 py-3 border-b border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-100">Save before quitting?</h3>
          <p className="text-xs text-zinc-400 mt-1">
            You have {noun}. Save them to XNAT before the app closes?
          </p>
        </div>
        <div className="px-4 py-3 space-y-2">
          <button
            onClick={onSaveAndQuit}
            className="w-full text-left text-xs px-3 py-2 rounded border border-blue-700/60 bg-blue-700/25 text-blue-100 hover:bg-blue-700/40 transition-colors"
          >
            Save &amp; quit. Save unsaved annotations to XNAT, then close.
          </button>
          <button
            onClick={onQuitWithoutSaving}
            className="w-full text-left text-xs px-3 py-2 rounded border border-red-900/60 bg-red-900/20 text-red-200 hover:bg-red-900/35 transition-colors"
          >
            Quit without saving. Unsaved changes stay in the local backup only.
          </button>
          <button
            onClick={onCancel}
            className="w-full text-left text-xs px-3 py-2 rounded border border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors"
          >
            Cancel. Return to the session.
          </button>
        </div>
      </div>
    </div>
  );
}
