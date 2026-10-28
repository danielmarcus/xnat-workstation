/**
 * The Operations section (SegWorks parity D1, amended 2026-10-12 — docs/segworks-parity.md
 * §4, docs/mockup/tools-operations-layout.html C).
 *
 * Presentational. Operations are not tools, so they have their own drawer in the side panel,
 * between the member list and the toolbox (R5-A, annotation-panel-modes 2026-10-28): a solid
 * header band with the grouped Operation picker (R4-A) and, once one is open, collapse and
 * close. The drawer's height is dragged from the band's top edge. It names no target: the
 * operation acts on the active member, named once in the list and once by the toolbox's
 * editing chip (R6). The open operation fills a
 * fixed-height body that scrolls, above a footer that stays on screen (status on the left,
 * the operation's buttons on the right). It stays open while tools change; collapsing
 * folds it to the header row and a one-line summary without ending it or its preview.
 */
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

/** Height of an open, expanded drawer at full size: header 28 + body + footer 32. */
export const OPERATION_DRAWER_HEIGHT = 260;
/** It shrinks before the toolbox does on short windows, down to header + 96 px body + footer. */
const OPEN_MIN_HEIGHT = 156;
/** The tallest a dragged drawer may be. */
const OPEN_MAX_HEIGHT = 640;

/** The operation picker's groups (R4-A), in menu order. */
export const OPERATION_GROUPS = ['Clean', 'Fill in', 'Segment', 'Check', 'Modules'] as const;
export type OperationGroup = (typeof OPERATION_GROUPS)[number];

export interface OperationsSectionProps {
  operations: ReadonlyArray<{ id: string; label: string; title: string; group: OperationGroup }>;
  openId: string | null;
  onOpen: (id: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onClose: () => void;
  /** One line shown in the header while collapsed, e.g. "Preview pending". */
  summary: string;
  /** The drawer's height while open and expanded, dragged from the band's top edge. */
  height?: number;
  onHeightChange?: (height: number) => void;
  /** The open operation's body (an OperationBody). */
  children?: ReactNode;
}

/** The grouped operation picker (R4-A): a button naming the open operation, and its menu. */
function OperationPicker({ operations, openId, onOpen }: Pick<OperationsSectionProps, 'operations' | 'openId' | 'onOpen'>) {
  const [open, setOpen] = useState(false);
  const current = operations.find((o) => o.id === openId);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);
  return (
    <span className={`relative min-w-0 ${openId ? '' : 'flex-1'}`}>
      <button
        type="button"
        aria-label="Operation"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={current?.title}
        className="flex items-center gap-1 w-full min-w-0 px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[10px]"
      >
        <span className="truncate">{current?.label ?? 'Open an operation…'}</span>
        <span className="text-zinc-500 ml-auto">▾</span>
      </button>
      {open && (
        <>
          <span className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            role="menu"
            aria-label="Operations"
            data-testid="operation-menu"
            className="absolute left-0 bottom-full mb-1 z-50 w-56 rounded-md border border-zinc-700 bg-zinc-900 shadow-xl py-1 text-[11px]"
          >
            {OPERATION_GROUPS.map((g) => {
              const items = operations.filter((o) => o.group === g);
              if (!items.length) return null;
              return (
                <div key={g} role="group" aria-label={g} className="py-0.5">
                  <div className="px-2.5 pt-1 pb-0.5 text-[9px] uppercase tracking-wide text-zinc-500">{g}</div>
                  {items.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      role="menuitem"
                      title={o.title}
                      aria-current={o.id === openId ? 'true' : undefined}
                      onClick={() => { setOpen(false); onOpen(o.id); }}
                      className={`block w-full text-left px-2.5 py-1 hover:bg-zinc-800 ${o.id === openId ? 'text-blue-300' : 'text-zinc-200'}`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </>
      )}
    </span>
  );
}

export default function OperationsSection(p: OperationsSectionProps) {
  const expanded = !!p.openId && !p.collapsed;
  const height = Math.min(OPEN_MAX_HEIGHT, Math.max(OPEN_MIN_HEIGHT, p.height ?? OPERATION_DRAWER_HEIGHT));
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Drag the band's top edge: up grows the drawer (the list gives way), down shrinks it.
  const onResizePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const target = e.currentTarget;
    if (typeof target.setPointerCapture === 'function') {
      try { target.setPointerCapture(e.pointerId); } catch { /* noop */ }
    }
    const startY = e.clientY;
    const startHeight = rootRef.current?.getBoundingClientRect().height ?? height;
    const clamp = (h: number) => Math.round(Math.min(OPEN_MAX_HEIGHT, Math.max(OPEN_MIN_HEIGHT, h)));
    const move = (ev: PointerEvent) => p.onHeightChange?.(clamp(startHeight + startY - ev.clientY));
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };
  return (
    <div
      ref={rootRef}
      data-testid="operations-section"
      className="relative border-t border-zinc-700 bg-zinc-900 flex flex-col min-h-0"
      style={expanded ? { flex: `0 10 ${height}px`, minHeight: OPEN_MIN_HEIGHT } : { flex: 'none' }}
    >
      {expanded && p.onHeightChange && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize operation"
          aria-valuenow={height}
          aria-valuemin={OPEN_MIN_HEIGHT}
          aria-valuemax={OPEN_MAX_HEIGHT}
          data-testid="operation-resize-handle"
          onPointerDown={onResizePointerDown}
          className="absolute left-0 right-0 -top-0.5 h-1 z-10 cursor-row-resize hover:bg-blue-500/40 active:bg-blue-500/60"
        />
      )}
      <div className="flex items-center gap-2 px-3 h-7 shrink-0 bg-zinc-800/70 border-b border-zinc-700" data-testid="operation-header">
        <span className="text-[9px] text-zinc-300 font-semibold uppercase tracking-wide">Operation</span>
        <OperationPicker operations={p.operations} openId={p.openId} onOpen={p.onOpen} />
        {p.openId && (
          <>
            <span className="flex-1 min-w-0 truncate text-[10px] text-zinc-400" data-testid="operation-summary">
              {p.collapsed ? p.summary : ''}
            </span>
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
