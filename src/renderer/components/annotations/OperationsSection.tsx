/**
 * The Operations section (SegWorks parity D1, amended 2026-10-12 — docs/segworks-parity.md
 * §4, docs/mockup/tools-operations-layout.html C).
 *
 * Presentational. Operations are not tools, so they have their own section of the side
 * panel, between the member list and the toolbox: a header row with the Operation picker
 * and, once one is open, its target chip, collapse and close. The open operation fills a
 * fixed-height body that scrolls, above a footer that stays on screen (status on the left,
 * the operation's buttons on the right). It stays open while tools change; collapsing
 * folds it to the header row and a one-line summary without ending it or its preview.
 */
import type { ReactNode } from 'react';

/** Height of an open, expanded section at full size: header 28 + body + footer 32. */
const OPEN_HEIGHT = 260;
/** It shrinks before the toolbox does on short windows, down to header + 96 px body + footer. */
const OPEN_MIN_HEIGHT = 156;

export interface OperationsSectionProps {
  operations: ReadonlyArray<{ id: string; label: string; title: string; group?: 'builtin' | 'modules' }>;
  openId: string | null;
  onOpen: (id: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onClose: () => void;
  /** The open operation's target member (the panel's active member). */
  target: { name: string; color: string } | null;
  /** One line shown in the header while collapsed, e.g. "Preview pending". */
  summary: string;
  /** The open operation's body (an OperationBody). */
  children?: ReactNode;
}

export default function OperationsSection(p: OperationsSectionProps) {
  const expanded = !!p.openId && !p.collapsed;
  return (
    <div
      data-testid="operations-section"
      className="border-t border-zinc-800 bg-zinc-900 flex flex-col min-h-0"
      style={expanded ? { flex: `0 10 ${OPEN_HEIGHT}px`, minHeight: OPEN_MIN_HEIGHT } : { flex: 'none' }}
    >
      <div className={`flex items-center gap-2 px-3 h-7 shrink-0 ${expanded ? 'border-b border-zinc-800' : ''}`}>
        <span className="text-[9px] text-zinc-500 uppercase tracking-wide">Operations</span>
        <select
          aria-label="Operation"
          value={p.openId ?? ''}
          onChange={(e) => e.target.value && p.onOpen(e.target.value)}
          className={`min-w-0 px-1 py-0.5 rounded bg-zinc-800 text-zinc-200 text-[10px] ${p.openId ? 'w-24' : 'flex-1'}`}
        >
          {!p.openId && <option value="">Open an operation…</option>}
          {p.operations.filter((o) => o.group !== 'modules').map((o) => <option key={o.id} value={o.id} title={o.title}>{o.label}</option>)}
          {p.operations.some((o) => o.group === 'modules') && (
            <optgroup label="Modules">
              {p.operations.filter((o) => o.group === 'modules').map((o) => <option key={o.id} value={o.id} title={o.title}>{o.label}</option>)}
            </optgroup>
          )}
        </select>
        {p.openId && (
          <>
            <span className="flex-1 min-w-0 truncate text-[10px] text-zinc-400" data-testid="operation-summary">
              {p.collapsed ? p.summary : ''}
            </span>
            {p.target && (
              <span className="flex items-center gap-1 text-[10px] min-w-0 max-w-[40%]" style={{ color: p.target.color }} data-testid="sheet-target">
                <span className="inline-block w-2 h-2 rounded-sm shrink-0" style={{ background: p.target.color }} />
                <span className="truncate">{p.target.name}</span>
              </span>
            )}
            <button
              type="button"
              aria-label={p.collapsed ? 'Expand operation' : 'Collapse operation'}
              aria-expanded={!p.collapsed}
              title={p.collapsed ? 'Expand' : 'Collapse (the operation and its preview stay alive)'}
              onClick={p.onToggleCollapsed}
              className="text-zinc-400 hover:text-zinc-100 text-[10px] px-0.5"
            >
              {p.collapsed ? '▸' : '▾'}
            </button>
            <button type="button" aria-label="Close operation" title="Close" onClick={p.onClose} className="text-zinc-400 hover:text-zinc-100 text-[11px] px-0.5">
              ✕
            </button>
          </>
        )}
      </div>
      {expanded && p.children}
    </div>
  );
}

export interface OperationBodyProps {
  testId: string;
  children: ReactNode;
  /** One-line status (never a toast): lock reasons, "Nothing to change", a discarded preview. */
  message?: string | null;
  footer: ReactNode;
  /** Inline confirmation that replaces the footer (e.g. "Discard the preview?"). */
  confirm?: { text: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void } | null;
}

/** An open operation: a body that scrolls, above a footer that never scrolls away. */
export function OperationBody(p: OperationBodyProps) {
  return (
    <div data-testid={p.testId} className="flex flex-col flex-1 min-h-0">
      <div className="px-3 py-2 overflow-y-auto min-h-0 flex-1">{p.children}</div>
      {p.confirm ? (
        <div className="flex items-center gap-2 px-3 h-8 shrink-0 border-t border-zinc-800 text-[10px] text-zinc-300">
          <span className="flex-1">{p.confirm.text}</span>
          <button type="button" onClick={p.confirm.onConfirm} className="rounded bg-zinc-700 px-2 py-0.5 hover:bg-zinc-600">
            {p.confirm.confirmLabel}
          </button>
          <button type="button" onClick={p.confirm.onCancel} className="rounded px-2 py-0.5 text-zinc-400 hover:text-zinc-200">
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 px-3 h-8 shrink-0 border-t border-zinc-800">
          <span role="status" data-testid="sheet-message" title={p.message ?? undefined} className="flex-1 min-w-0 truncate text-[10px] text-amber-300/90">
            {p.message}
          </span>
          {p.footer}
        </div>
      )}
    </div>
  );
}

/** A labelled row of an operation's body, in the toolbox Controls strip's style. */
export function OperationRow({ label, children, title }: { label: string; children: ReactNode; title?: string }) {
  return (
    <div className="flex items-center gap-2 mt-1.5 first:mt-0 text-[10px] text-zinc-400" title={title}>
      <span className="whitespace-nowrap">{label}</span>
      {children}
    </div>
  );
}

/** A row of mutually exclusive buttons (scope, direction, fill…), as a labelled group. */
export function Segmented<T extends string>({ value, options, onChange, label, className = '' }: {
  value: T;
  options: Array<{ value: T; label: string; ariaLabel?: string }>;
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div className={`flex rounded overflow-hidden border border-zinc-700 ${className}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-label={o.ariaLabel}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 px-1.5 py-0.5 text-[10px] whitespace-nowrap ${value === o.value ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The footer every previewing operation shares: Preview · Commit · Discard. */
export function PreviewCommitButtons({ onPreview, onCommit, onDiscard, canPreview, canCommit, previewActive, commitTitle }: {
  onPreview: () => void;
  onCommit: () => void;
  onDiscard: () => void;
  canPreview: boolean;
  canCommit: boolean;
  previewActive: boolean;
  commitTitle?: string;
}) {
  return (
    <>
      <button type="button" onClick={onPreview} disabled={!canPreview} className="rounded bg-zinc-700 px-2.5 py-0.5 text-[10px] text-zinc-100 hover:bg-zinc-600 disabled:opacity-40">
        Preview
      </button>
      <button type="button" onClick={onCommit} disabled={!canCommit} title={commitTitle} className="rounded bg-blue-600 px-2.5 py-0.5 text-[10px] text-white hover:bg-blue-500 disabled:opacity-40">
        Commit
      </button>
      <button type="button" onClick={onDiscard} disabled={!previewActive} className="rounded bg-zinc-800 px-2.5 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-700 disabled:opacity-40">
        Discard
      </button>
    </>
  );
}

/**
 * The More fold (R7-A): the settings beyond a tool's or an operation's essentials. A dot shows
 * while any of them differs from its default, so a changed setting is never out of sight.
 */
export function MoreToggle({ open, onToggle, changed }: { open: boolean; onToggle: () => void; changed: boolean }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      title={changed ? 'Some of these settings differ from their defaults' : undefined}
      className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-200 whitespace-nowrap"
    >
      {open ? '▾' : '▸'} More
      {changed && <span data-testid="more-changed" className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400" />}
    </button>
  );
}

/** Whether any of `keys` differs between `now` and `base` (the More fold's dot). */
export function differsFrom<T extends object>(now: T, base: T, keys: Array<keyof T>): boolean {
  return keys.some((k) => JSON.stringify(now[k]) !== JSON.stringify(base[k]));
}

/** Whether any parameter differs from its declared default. */
export function paramsChanged(specs: ReadonlyArray<{ key: string; default: unknown }>, values: Record<string, unknown>): boolean {
  return specs.some((p) => values[p.key] !== undefined && values[p.key] !== p.default);
}
