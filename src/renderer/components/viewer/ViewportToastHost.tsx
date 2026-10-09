/**
 * The toast stack, top-right of the viewport area (CLAUDE.md surface taxonomy). Toasts
 * never block the image: the stack ignores the pointer except on the toasts themselves.
 */
import { useToastStore, type ToastTone } from '../../stores/toastStore';

const TONE: Record<ToastTone, { box: string; icon: string }> = {
  warning: { box: 'border-amber-600/60 text-amber-100', icon: 'text-amber-400' },
  error: { box: 'border-red-700/70 text-red-100', icon: 'text-red-400' },
  success: { box: 'border-emerald-700/70 text-emerald-100', icon: 'text-emerald-400' },
};

function ToneIcon({ tone }: { tone: ToastTone }) {
  const cls = `w-3.5 h-3.5 shrink-0 ${TONE[tone].icon}`;
  if (tone === 'success') {
    return (
      <svg className={cls} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
        <path d="M3.5 8.5l3 3 6-7" />
      </svg>
    );
  }
  // Warning / error: the padlock for a lock refusal reads oddly for an error, so both use
  // the alert triangle — the message carries the specifics.
  return (
    <svg className={cls} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <path d="M8 2.5l6 11H2z" strokeLinejoin="round" />
      <path d="M8 6.5v3.5M8 11.8v.2" strokeLinecap="round" />
    </svg>
  );
}

export default function ViewportToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return (
    <div className="absolute top-2 right-2 z-40 flex flex-col items-end gap-1.5 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          data-testid="viewport-toast"
          data-tone={t.tone}
          className={`pointer-events-auto flex items-center gap-2 max-w-sm pl-2.5 pr-1.5 py-1.5 rounded-md border bg-zinc-900/95 shadow-lg text-[11px] ${TONE[t.tone].box}`}
        >
          <ToneIcon tone={t.tone} />
          <span className="flex-1">{t.message}</span>
          <button
            type="button"
            aria-label="Dismiss"
            title="Dismiss"
            onClick={() => dismiss(t.id)}
            className="text-zinc-500 hover:text-zinc-200 px-0.5"
          >
            <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
