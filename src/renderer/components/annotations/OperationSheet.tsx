/**
 * Operation sheet shell (SegWorks parity D1 — docs/mockup/segworks-wireframes.html §5).
 *
 * Presentational. Every operation (Cleanup now; Interpolate, Propagate, solvers, modules
 * later) is one of these, between the member list and the toolbox, with the same anatomy
 * in the same order: header (back · name · target chip), sections, an optional
 * collapsed Advanced section, a one-line in-sheet status, and the footer.
 */
import type { ReactNode } from 'react';

export function SheetSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="px-3 py-2 border-b border-zinc-800/70">
      <div className="text-[9px] text-zinc-500 uppercase tracking-wide mb-1">{label}</div>
      {children}
    </div>
  );
}

export interface OperationSheetProps {
  title: string;
  testId: string;
  target: { name: string; color: string } | null;
  onBack: () => void;
  children: ReactNode;
  /** Advanced section, collapsed unless `advancedOpen`. Omit when the operation has none. */
  advanced?: ReactNode;
  advancedOpen?: boolean;
  onToggleAdvanced?: () => void;
  message?: string | null;
  footer: ReactNode;
  /** Inline confirmation that replaces the footer (e.g. "Discard preview?"). */
  confirm?: { text: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void } | null;
}

export default function OperationSheet(p: OperationSheetProps) {
  return (
    <div data-testid={p.testId} className="border-t border-zinc-800 bg-zinc-900 flex flex-col max-h-[60%] min-h-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800">
        <button type="button" aria-label="Back to operations" onClick={p.onBack} className="text-zinc-400 hover:text-zinc-100 text-xs">
          ←
        </button>
        <span className="flex-1 text-xs font-semibold text-zinc-100">{p.title}</span>
        {p.target && (
          <span className="flex items-center gap-1 text-[10px]" style={{ color: p.target.color }} data-testid="sheet-target">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: p.target.color }} />
            {p.target.name}
          </span>
        )}
      </div>
      <div className="overflow-y-auto min-h-0">
        {p.children}
        {p.advanced && (
          <>
            <button
              type="button"
              onClick={p.onToggleAdvanced}
              aria-expanded={!!p.advancedOpen}
              className="w-full text-left px-3 py-1.5 text-[10px] text-zinc-400 hover:text-zinc-200 border-b border-zinc-800/70"
            >
              {p.advancedOpen ? '▾' : '▸'} Advanced
            </button>
            {p.advancedOpen && p.advanced}
          </>
        )}
      </div>
      {p.message && (
        <div className="px-3 py-1.5 text-[10px] text-amber-300/90" role="status" data-testid="sheet-message">
          {p.message}
        </div>
      )}
      {p.confirm ? (
        <div className="flex items-center gap-2 px-3 py-2 border-t border-zinc-800 text-[10px] text-zinc-300">
          <span className="flex-1">{p.confirm.text}</span>
          <button type="button" onClick={p.confirm.onConfirm} className="rounded bg-zinc-700 px-2 py-0.5 hover:bg-zinc-600">
            {p.confirm.confirmLabel}
          </button>
          <button type="button" onClick={p.confirm.onCancel} className="rounded px-2 py-0.5 text-zinc-400 hover:text-zinc-200">
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 px-3 py-2 border-t border-zinc-800">{p.footer}</div>
      )}
    </div>
  );
}
