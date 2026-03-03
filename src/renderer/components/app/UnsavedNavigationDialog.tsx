interface UnsavedNavigationDialogProps {
  open: boolean;
  onProceedWithoutSaving: () => void;
  onCancel: () => void;
}

export default function UnsavedNavigationDialog({
  open,
  onProceedWithoutSaving,
  onCancel,
}: UnsavedNavigationDialogProps) {
  if (!open) return null;

  return (
    <div className="absolute inset-0 z-[80] bg-zinc-950/70 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
        <div className="px-4 py-3 border-b border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-100">Unsaved annotations</h3>
          <p className="text-xs text-zinc-400 mt-1">
            You have unsaved annotation changes. Choose how to continue.
          </p>
        </div>
        <div className="px-4 py-3 space-y-2">
          <button
            onClick={onProceedWithoutSaving}
            className="w-full text-left text-xs px-3 py-2 rounded border border-red-900/60 bg-red-900/20 text-red-200 hover:bg-red-900/35 transition-colors"
          >
            Continue without saving. Unsaved annotations will be lost.
          </button>
          <button
            onClick={onCancel}
            className="w-full text-left text-xs px-3 py-2 rounded border border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors"
          >
            Return to session.
          </button>
        </div>
      </div>
    </div>
  );
}
