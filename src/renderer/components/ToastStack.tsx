/**
 * <ToastStack /> — viewport-area toast renderer.
 *
 * Implements spec §11 (issue #77). Mounts inside the viewport-area container
 * (top-right corner). Renders up to MAX_VISIBLE toasts; hover pauses the
 * auto-dismiss timer; click dismisses; the optional `action` button invokes
 * the handler and dismisses the toast.
 *
 * ARIA
 *   - Each toast is its own live region.
 *   - success / info use aria-live="polite".
 *   - warning / error use aria-live="assertive".
 *   - role="status" on success / info; role="alert" on warning / error.
 *
 * Layout
 *   - Absolutely positioned in the top-right of its containing positioned
 *     ancestor (the viewport-area container in ViewerPage).
 *   - Stacks vertically with the newest toast on top.
 *   - Corner overlays (W/L, slice index, etc.) sit underneath and remain
 *     readable behind transient toasts (spec §9.4).
 */
import { useToastStore, type Toast, type ToastKind } from '../lib/toast/toastService';

/** Per-kind styling. Kept in one place so designers can iterate. */
const KIND_STYLES: Record<ToastKind, { container: string; iconBg: string; icon: React.ReactNode }> = {
  success: {
    container: 'bg-green-900/90 text-green-100 border border-green-700',
    iconBg: 'text-green-300',
    icon: (
      <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="2,8 6,12 14,4" />
      </svg>
    ),
  },
  info: {
    container: 'bg-zinc-900/90 text-zinc-100 border border-zinc-600',
    iconBg: 'text-zinc-300',
    icon: (
      <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="8" cy="8" r="6.5" />
        <line x1="8" y1="7" x2="8" y2="11.5" />
        <circle cx="8" cy="4.5" r="0.5" fill="currentColor" />
      </svg>
    ),
  },
  warning: {
    container: 'bg-amber-900/90 text-amber-100 border border-amber-700',
    iconBg: 'text-amber-300',
    icon: (
      <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M8 1.5l7 13H1z" />
        <line x1="8" y1="6" x2="8" y2="10" />
        <circle cx="8" cy="12" r="0.5" fill="currentColor" />
      </svg>
    ),
  },
  error: {
    container: 'bg-red-900/90 text-red-100 border border-red-700',
    iconBg: 'text-red-300',
    icon: (
      <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="8" cy="8" r="6.5" />
        <line x1="5" y1="5" x2="11" y2="11" />
        <line x1="11" y1="5" x2="5" y2="11" />
      </svg>
    ),
  },
};

function ariaForKind(kind: ToastKind): { 'aria-live': 'polite' | 'assertive'; role: 'status' | 'alert' } {
  if (kind === 'warning' || kind === 'error') {
    return { 'aria-live': 'assertive', role: 'alert' };
  }
  return { 'aria-live': 'polite', role: 'status' };
}

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((s) => s.dismiss);
  const pauseTimer = useToastStore((s) => s.pauseTimer);
  const resumeTimer = useToastStore((s) => s.resumeTimer);

  const style = KIND_STYLES[toast.kind];
  const aria = ariaForKind(toast.kind);

  const handleClick = () => dismiss(toast.id);
  const handleMouseEnter = () => pauseTimer(toast.id);
  const handleMouseLeave = () => resumeTimer(toast.id);
  const handleActionClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (toast.action) {
      toast.action.onClick();
      dismiss(toast.id);
    }
  };
  const handleActionKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleActionClick(e as unknown as React.MouseEvent);
    }
  };

  return (
    <div
      data-toast-id={toast.id}
      data-toast-kind={toast.kind}
      role={aria.role}
      aria-live={aria['aria-live']}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`flex items-start gap-2 px-3 py-2 rounded shadow-lg text-[11px] font-medium cursor-pointer pointer-events-auto max-w-md ${style.container}`}
    >
      <span className={`shrink-0 mt-0.5 ${style.iconBg}`}>{style.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="leading-tight">{toast.message}</div>
        {toast.detail && <div className="opacity-80 text-[10px] leading-tight mt-0.5">{toast.detail}</div>}
      </div>
      {toast.action && (
        <button
          type="button"
          onClick={handleActionClick}
          onKeyDown={handleActionKey}
          className="shrink-0 text-[10px] font-semibold underline underline-offset-2 hover:no-underline focus:outline-none focus:ring-1 focus:ring-white/60 rounded px-1"
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}

/**
 * Top-right toast stack. Mount inside any positioned container; toasts will
 * render in its top-right corner.
 */
export default function ToastStack() {
  const toasts = useToastStore((s) => s.toasts);
  // Render newest at top: reverse the FIFO queue.
  const ordered = [...toasts].reverse();

  return (
    <div
      data-testid="toast-stack"
      // pointer-events-none on the wrapper so the area outside individual
      // toasts (which set pointer-events-auto) doesn't block viewport clicks.
      className="absolute top-3 right-3 z-30 flex flex-col gap-2 pointer-events-none"
    >
      {ordered.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
