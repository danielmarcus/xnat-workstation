/**
 * MemberRow (Rebuild Phase 3, R3.5) — one member row (frozen mockup §2/§8).
 * Presentational. Color swatch · name (double-click → inline rename) · provenance
 * marker (auto/imported) · geometry summary · active dot (the "pen") · 3-state
 * visibility eye · lock (open/amber-closed/green-closed) · delete "✕". Active rows
 * get a blue left accent + tint; selected rows a ring; cross-series rows dim with a
 * source-series link (read-only here, D9); different-FoR rows show "not viewable
 * here" (A2d). Behaviour injected via callbacks.
 */
import { useEffect, useRef, useState } from 'react';
import type { Member } from '@shared/types/annotation';
import { ActiveDotGlyph, DeleteGlyph, LockGlyph, VisibilityGlyph } from './icons';

export type MemberVisibility = 'filled' | 'outline' | 'hidden';
export type MemberProvenance = 'manual' | 'interpolated' | 'imported';
/** Frame-of-reference eligibility for the active viewport (drives dim / read-only). */
export type MemberEligibility = 'native' | 'cross-series' | 'different-for';

export interface MemberRowProps {
  member: Member;
  visibility: MemberVisibility;
  /** open shackle (gray) / closed (amber) / approved (green). */
  lockState: 'unlocked' | 'locked' | 'approved';
  active: boolean;
  selected: boolean;
  provenance?: MemberProvenance;
  eligibility?: MemberEligibility;
  /** Source series label for a cross-series (non-native) member, e.g. "T1 SAG". */
  sourceSeriesLabel?: string;
  /** Geometry summary, e.g. "12 sl" / "86 cm³" / "42.3 mm". */
  metric?: string;
  /** Empty (freshly created, no geometry). */
  empty?: boolean;
  /** Start in inline-edit mode (freshly created — D7.6 create-in-edit-mode). */
  autoEdit?: boolean;
  /** Called once after a freshly-created row enters edit mode (clears the pending flag). */
  onEditConsumed?: () => void;
  onSelect: (additive: boolean) => void;
  onActivate: () => void;
  onCycleVisibility: () => void;
  onToggleLock: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
}

function swatchColor(color?: [number, number, number, number]): string {
  if (!color) return '#71717a';
  const [r, g, b] = color;
  return `rgb(${r}, ${g}, ${b})`;
}

export default function MemberRow(props: MemberRowProps) {
  const {
    member, visibility, lockState, active, selected, provenance, eligibility = 'native',
    sourceSeriesLabel, metric, empty, autoEdit, onEditConsumed, onSelect, onActivate, onCycleVisibility, onToggleLock, onDelete, onRename,
  } = props;

  const differentFor = eligibility === 'different-for';
  const crossSeries = eligibility === 'cross-series';
  // Locked (session OR approved) and different-FoR members are read-only: no rename,
  // no delete (D7.3 lock blocks edits; deleting a locked member is a destructive edit).
  const readOnly = lockState !== 'unlocked' || differentFor;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(member.label);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); }
  }, [editing]);
  // Enter edit mode when autoEdit BECOMES true (row may mount before the create
  // handler sets the flag, so an initial-state capture would miss it).
  useEffect(() => {
    if (autoEdit && !readOnly) {
      setDraft(member.label);
      setEditing(true);
      onEditConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoEdit]);
  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== member.label) onRename(next);
  };

  const rowClasses = [
    'flex items-center gap-2 pl-6 pr-2 py-1.5',
    active ? 'border-l-2 border-blue-500 bg-blue-900/10' : '',
    selected && !active ? 'ring-1 ring-inset ring-blue-500/60 bg-blue-900/10' : '',
    crossSeries ? 'opacity-80' : '',
    differentFor ? 'opacity-50' : '',
    !active && !selected ? 'hover:bg-zinc-800/50' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={rowClasses}
      data-testid={`member-row-${member.id}`}
      data-active={active}
      data-selected={selected}
      onClick={(e) => onSelect(e.ctrlKey || e.metaKey || e.shiftKey)}
      onDoubleClick={onActivate}
    >
      <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: swatchColor(member.color) }} aria-hidden="true" />

      {editing ? (
        <input
          ref={inputRef}
          className="text-[11px] bg-zinc-800 text-zinc-100 px-1 rounded min-w-0 outline-none ring-1 ring-blue-500"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') setEditing(false); }}
          onBlur={commit}
          onClick={(e) => e.stopPropagation()}
          aria-label="Rename member"
        />
      ) : (
        <span
          className={`text-[11px] truncate ${differentFor ? 'text-zinc-400 line-through decoration-zinc-600' : active || selected ? 'text-zinc-100' : 'text-zinc-300'}`}
          onDoubleClick={(e) => { e.stopPropagation(); if (!readOnly) setEditing(true); }}
          title={member.label}
        >
          {member.label}
        </span>
      )}

      {empty && <span className="text-[9px] text-zinc-600 italic">(empty)</span>}
      {provenance === 'interpolated' && (
        <span className="text-[8px] px-1 rounded-sm bg-amber-500/15 text-amber-400/90" title="Contains interpolated contours">auto</span>
      )}
      {member.toolName && (
        <span className="text-[8px] px-1 rounded-sm bg-zinc-700 text-zinc-300">{member.toolName}</span>
      )}
      {crossSeries && sourceSeriesLabel && (
        <span className="flex items-center gap-0.5 text-[8px] text-zinc-400" title={`Native to ${sourceSeriesLabel} · read-only here`}>
          <svg viewBox="0 0 16 16" width={11} height={11} fill="none" stroke="currentColor" strokeWidth={1.3} strokeDasharray="2 1.3">
            <path d="M6 10l4-4M5 7L3.5 8.5a2 2 0 002.8 2.8L8 9.5M11 9l1.5-1.5a2 2 0 00-2.8-2.8L8 6.5" />
          </svg>
          {sourceSeriesLabel}
        </span>
      )}
      {differentFor && (
        <span className="flex items-center gap-0.5 text-[8px] text-zinc-500" title="Different frame of reference — not viewable here (A2d)">
          <svg viewBox="0 0 16 16" width={11} height={11} fill="none" stroke="currentColor" strokeWidth={1.3}>
            <circle cx="8" cy="8" r="5" /><path d="M4.5 4.5l7 7" />
          </svg>
          diff FoR
        </span>
      )}

      <span className="flex-1" />

      {metric && <span className="text-[9px] text-zinc-500">{metric}</span>}
      {differentFor && <span className="text-[9px] text-zinc-600">not here</span>}

      {active && (
        <span className="text-blue-400" title="Active — drawing writes here" data-testid="active-indicator">
          <ActiveDotGlyph />
        </span>
      )}

      {!differentFor && (
        <button
          type="button"
          className="text-zinc-300"
          title={`Visibility: ${visibility}`}
          aria-label={`Cycle visibility (currently ${visibility})`}
          onClick={(e) => { e.stopPropagation(); onCycleVisibility(); }}
        >
          <VisibilityGlyph mode={visibility} />
        </button>
      )}

      {!differentFor && !crossSeries && (
        <button
          type="button"
          className={lockState === 'locked' ? 'text-amber-400' : lockState === 'approved' ? 'text-emerald-400/80' : 'text-zinc-600 hover:text-zinc-300'}
          title={lockState === 'approved' ? 'Approved-locked' : lockState === 'locked' ? 'Locked — edits blocked everywhere' : 'Unlocked — click to lock'}
          aria-label="Toggle lock"
          disabled={lockState === 'approved'}
          onClick={(e) => { e.stopPropagation(); onToggleLock(); }}
        >
          <LockGlyph state={lockState} />
        </button>
      )}

      {!differentFor && (
        <button
          type="button"
          disabled={readOnly}
          className={readOnly ? 'text-zinc-700 cursor-not-allowed ml-0.5' : 'text-zinc-500 hover:text-red-400 ml-0.5'}
          title={readOnly ? 'Delete — locked' : 'Delete this member'}
          aria-label="Delete member"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
        >
          <DeleteGlyph size={12} />
        </button>
      )}
    </div>
  );
}
