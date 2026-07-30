/**
 * Annotation dialogs (Rebuild Phase 3, R3.7) — the side-panel modals (frozen
 * mockup §5). Presentational. ConfirmDialog covers delete / approve / revoke
 * (variant drives the accent + button color); NameEntryDialog is the create / new
 * member name+color entry (no type dropdown — removed per review); ConflictDialog
 * is the H7 version-conflict resolver (Keep local / Discard local / Inspect).
 * Behaviour injected via callbacks; the connected layer mounts whichever is open.
 */
import { useEffect, useRef, useState } from 'react';

function ModalShell({ width = 'w-72', children }: { width?: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="presentation">
      <div className={`${width} bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-3`} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}

export type ConfirmVariant = 'danger' | 'approve' | 'revoke';

const CONFIRM_BTN: Record<ConfirmVariant, string> = {
  danger: 'bg-red-600 hover:bg-red-500',
  approve: 'bg-emerald-600 hover:bg-emerald-500',
  revoke: 'bg-amber-600 hover:bg-amber-500',
};

export function ConfirmDialog(props: {
  title: string;
  body?: string;
  confirmLabel: string;
  variant: ConfirmVariant;
  onConfirm: () => void;
  onCancel: () => void;
  /** While an async confirm is in flight: disables both buttons + shows busyLabel. */
  busy?: boolean;
  busyLabel?: string;
  /** Error from a failed confirm, shown in red; the confirm button becomes a retry. */
  error?: string;
}) {
  const { title, body, confirmLabel, variant, onConfirm, onCancel, busy = false, busyLabel, error } = props;
  return (
    <ModalShell>
      <div className="text-xs text-zinc-200 font-medium mb-1">{title}</div>
      {body && <p className="text-[10px] text-zinc-500">{body}</p>}
      {error && <p className="mt-1 text-[10px] text-red-400" role="alert">{error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          disabled={busy}
          className="text-[11px] px-2.5 py-1 rounded text-zinc-400 hover:text-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          className={`text-[11px] px-2.5 py-1 rounded text-white disabled:opacity-60 disabled:cursor-not-allowed ${CONFIRM_BTN[variant]}`}
          onClick={onConfirm}
        >
          {busy ? (busyLabel ?? confirmLabel) : error ? 'Retry' : confirmLabel}
        </button>
      </div>
    </ModalShell>
  );
}

export function NameEntryDialog(props: {
  title: string;
  defaultName: string;
  defaultColor?: string;
  onCreate: (name: string, color: string) => void;
  onCancel: () => void;
}) {
  const { title, defaultName, defaultColor = '#ef4444', onCreate, onCancel } = props;
  const [name, setName] = useState(defaultName);
  const [color, setColor] = useState(defaultColor);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (inputRef.current) { inputRef.current.focus(); inputRef.current.select(); }
  }, []);
  return (
    <ModalShell>
      <div className="text-xs text-zinc-200 font-medium mb-2">{title}</div>
      <input
        ref={inputRef}
        className="w-full bg-zinc-800 rounded px-2 py-1.5 text-[11px] text-zinc-200 outline-none border border-zinc-700 focus:border-blue-500"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim()) onCreate(name.trim(), color);
          else if (e.key === 'Escape') onCancel();
        }}
        aria-label="Name"
      />
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[10px] text-zinc-500">Color</span>
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Color" className="w-5 h-5 bg-transparent border-0 p-0" />
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className="text-[11px] px-2.5 py-1 rounded text-zinc-400 hover:text-zinc-200" onClick={onCancel}>Cancel</button>
        <button
          type="button"
          disabled={!name.trim()}
          className={`text-[11px] px-2.5 py-1 rounded text-white ${name.trim() ? 'bg-blue-600 hover:bg-blue-500' : 'bg-zinc-700 cursor-not-allowed'}`}
          onClick={() => onCreate(name.trim(), color)}
        >
          Create
        </button>
      </div>
    </ModalShell>
  );
}

export interface UnsavedEntry {
  containerId: string;
  label: string;
  /** Friendly session label/id for held-over (other-session) work; omitted for the current session. */
  sessionLabel?: string;
  /** True if this container belongs to a session other than the one being viewed. */
  isOtherSession: boolean;
  /** Save is in flight for this container. */
  saving?: boolean;
}

/**
 * Review & save unsaved annotations (Lifecycle L3 follow-up). Lists every container
 * with unsaved edits — split into the current session and work held over from other
 * sessions you've navigated away from — and lets the user save them individually or
 * all at once. Opened from the in-panel unsaved indicator.
 */
export function ReviewUnsavedDialog(props: {
  entries: UnsavedEntry[];
  onSaveOne: (containerId: string) => void;
  onSaveAll: () => void;
  onClose: () => void;
}) {
  const { entries, onSaveOne, onSaveAll, onClose } = props;
  const current = entries.filter((e) => !e.isOtherSession);
  const other = entries.filter((e) => e.isOtherSession);

  const Row = (e: UnsavedEntry) => (
    <div key={e.containerId} className="flex items-center gap-2 py-1" data-testid={`unsaved-row-${e.containerId}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" aria-hidden="true" />
      <span className="flex-1 min-w-0 truncate text-[11px] text-zinc-200" title={e.label}>{e.label}</span>
      <button
        type="button"
        disabled={e.saving}
        className={`text-[10px] px-2 py-0.5 rounded ${e.saving ? 'bg-zinc-700 text-zinc-400' : 'bg-blue-600 hover:bg-blue-500 text-white'}`}
        onClick={() => onSaveOne(e.containerId)}
      >
        {e.saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );

  return (
    <ModalShell width="w-96">
      <div className="text-xs text-zinc-200 font-medium mb-1">Unsaved annotations</div>
      {entries.length === 0 ? (
        <p className="text-[11px] text-emerald-300 py-2">✓ All annotations saved.</p>
      ) : (
        <div className="max-h-72 overflow-y-auto mt-1">
          {current.length > 0 && (
            <div className="mb-2">
              <div className="text-[9px] uppercase tracking-wide text-zinc-500 mb-0.5">This session</div>
              {current.map(Row)}
            </div>
          )}
          {other.length > 0 && (
            <div>
              <div className="text-[9px] uppercase tracking-wide text-amber-400/80 mb-0.5">Held from other sessions</div>
              {other.map((e) => (
                <div key={e.containerId} className="flex items-center gap-2 py-1" data-testid={`unsaved-row-${e.containerId}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" aria-hidden="true" />
                  <span className="flex-1 min-w-0 truncate text-[11px] text-zinc-200" title={e.label}>
                    {e.label}
                    {e.sessionLabel && <span className="text-zinc-500"> · {e.sessionLabel}</span>}
                  </span>
                  <button
                    type="button"
                    disabled={e.saving}
                    className={`text-[10px] px-2 py-0.5 rounded ${e.saving ? 'bg-zinc-700 text-zinc-400' : 'bg-blue-600 hover:bg-blue-500 text-white'}`}
                    onClick={() => onSaveOne(e.containerId)}
                  >
                    {e.saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className="text-[11px] px-2.5 py-1 rounded text-zinc-400 hover:text-zinc-200" onClick={onClose}>
          Close
        </button>
        {entries.length > 0 && (
          <button
            type="button"
            className="text-[11px] px-2.5 py-1 rounded text-white bg-blue-600 hover:bg-blue-500"
            onClick={onSaveAll}
          >
            Save all
          </button>
        )}
      </div>
    </ModalShell>
  );
}

export function ConflictDialog(props: {
  containerLabel: string;
  onKeepLocal: () => void;
  onDiscardLocal: () => void;
  onInspect: () => void;
  onCancel: () => void;
}) {
  const { containerLabel, onKeepLocal, onDiscardLocal, onInspect } = props;
  return (
    <ModalShell width="w-80">
      <div className="text-xs text-zinc-200 font-medium mb-1 flex items-center gap-1.5">
        <span className="text-red-400" aria-hidden="true">⚠</span> Version conflict
      </div>
      <p className="text-[10px] text-zinc-500">“{containerLabel}” changed on the server while you have unsaved edits.</p>
      <div className="mt-3 flex flex-col gap-1.5">
        <button type="button" className="text-[11px] px-2.5 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-left" onClick={onKeepLocal}>
          Keep local <span className="text-zinc-500">— overwrite server</span>
        </button>
        <button type="button" className="text-[11px] px-2.5 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-left" onClick={onDiscardLocal}>
          Discard local <span className="text-zinc-500">— reload server version</span>
        </button>
        <button type="button" className="text-[11px] px-2.5 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-left" onClick={onInspect}>
          Inspect differences…
        </button>
      </div>
    </ModalShell>
  );
}
