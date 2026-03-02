import { useEffect } from 'react';
import { useDialogStore } from '../../stores/dialogStore';

export default function AppDialogHost() {
  const active = useDialogStore((s) => s.active);
  const resolveActive = useDialogStore((s) => s.resolveActive);

  useEffect(() => {
    if (!active) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        resolveActive(false);
        return;
      }
      if (event.key === 'Enter') {
        resolveActive(true);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, resolveActive]);

  if (!active) return null;

  const isConfirm = active.kind === 'confirm';

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-zinc-950/70"
        onClick={() => resolveActive(false)}
      />

      <div className="relative w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="border-b border-zinc-800 px-4 py-3">
          <h3 className="text-sm font-semibold text-zinc-100">{active.title}</h3>
        </div>

        <div className="px-4 py-3">
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-zinc-300">
            {active.message}
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-4 py-3">
          {isConfirm && (
            <button
              type="button"
              onClick={() => resolveActive(false)}
              className="rounded bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 transition-colors hover:bg-zinc-700"
            >
              {active.cancelLabel}
            </button>
          )}

          <button
            type="button"
            onClick={() => resolveActive(true)}
            className={`rounded px-3 py-1.5 text-xs transition-colors ${
              active.tone === 'danger'
                ? 'bg-red-600 text-white hover:bg-red-500'
                : 'bg-blue-600 text-white hover:bg-blue-500'
            }`}
          >
            {active.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
