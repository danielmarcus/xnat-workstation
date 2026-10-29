/**
 * Components extensions draw with (extension framework X2, R10 — `ext.ui.components`), so their
 * UI matches the app's: its buttons, and a modal dialog under its modal rules.
 */
import { useEffect, type ReactNode } from 'react';
import { hotkeyService } from '../../lib/hotkeys/hotkeyService';

export function ExtensionButton({ onClick, disabled, primary, title, children }: { onClick?: () => void; disabled?: boolean; primary?: boolean; title?: string; children?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`px-2 py-1 rounded text-[11px] disabled:opacity-40 transition-colors ${primary ? 'bg-blue-600 text-white hover:bg-blue-500' : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700'}`}
    >
      {children}
    </button>
  );
}

/** A modal dialog: `role="dialog"` (so the app treats it as a keyboard surface of its own); Esc closes. */
export function ExtensionDialog({ title, onClose, children }: { title: string; onClose: () => void; children?: ReactNode }) {
  useEffect(() => hotkeyService.pushKeyLayer({ onKeyDown: (e) => (e.key === 'Escape' ? (onClose(), true) : false) }), [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button type="button" aria-label="Close dialog" className="absolute inset-0 bg-zinc-950/70" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={title} className="relative min-w-[320px] max-w-[min(90vw,640px)] bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl">
        <div className="h-10 px-4 flex items-center justify-between border-b border-zinc-800">
          <h2 className="text-sm font-medium text-zinc-100">{title}</h2>
          <button type="button" onClick={onClose} title="Close" className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-800">✕</button>
        </div>
        <div className="p-4 text-xs text-zinc-300">{children}</div>
      </div>
    </div>
  );
}
