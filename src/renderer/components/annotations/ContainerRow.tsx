/**
 * ContainerRow (Rebuild Phase 3, R3.4) — one container header row (frozen mockup
 * §2/§3/§7). Presentational. Shows the kind glyph (type-colored), the container
 * name (double-click → inline rename, D7.6), a dirty dot OR a cross-panel "↗ N"
 * pill, the member count, and the row action cluster: approve "✓" toggle (outline
 * → green when approved), add-member "+", per-container Save (enabled only when
 * dirty & unapproved), kebab "⋮", delete "✕". Approved containers lock add/save/
 * delete (D7.11). Behaviour injected via callbacks.
 */
import { useEffect, useRef, useState } from 'react';
import type { Container } from '@shared/types/annotation';
import {
  KindGlyph,
  ChevronGlyph,
  ApproveGlyph,
  PlusGlyph,
  SaveGlyph,
  KebabGlyph,
  DeleteGlyph,
} from './icons';

const KIND_STROKE: Record<Container['kind'], string> = {
  RTSTRUCT: '#34d399',
  SEG: '#c084fc',
  SR: '#fb923c',
};

/** Per-container transport state surfaced in-place on the row (no toast/banner). */
export interface RowTransport {
  phase: 'idle' | 'loading' | 'saving' | 'error';
  errorKind?: 'transient' | 'conflict' | 'permanent';
}

export interface ContainerRowProps {
  container: Container;
  expanded: boolean;
  /** Live save/conflict state (saving indicator, conflict badge, error dot). */
  transport?: RowTransport;
  /** Open the H7 conflict resolver (shown only when transport is in conflict). */
  onResolveConflict?: () => void;
  /** Number of OTHER viewports this container renders on (cross-panel pill). */
  crossPanelCount?: number;
  /** Start in inline-edit mode (freshly created — D7.6 create-in-edit-mode). */
  autoEdit?: boolean;
  /** Called once after a freshly-created row enters edit mode (clears the pending flag). */
  onEditConsumed?: () => void;
  /** Called when the inline name edit is accepted (Enter/blur), NOT on Esc-cancel. */
  onCommitName?: () => void;
  onToggleExpand: () => void;
  onApproveToggle: () => void;
  onAddMember: () => void;
  onSave: () => void;
  onKebab: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
}

export default function ContainerRow(props: ContainerRowProps) {
  const { container, expanded, transport, onResolveConflict, crossPanelCount, autoEdit, onEditConsumed, onCommitName, onToggleExpand, onApproveToggle, onAddMember, onSave, onKebab, onDelete, onRename } = props;
  const saving = transport?.phase === 'saving' || transport?.phase === 'loading';
  const conflict = transport?.phase === 'error' && transport?.errorKind === 'conflict';
  const errored = transport?.phase === 'error' && transport?.errorKind !== 'conflict';
  const approved = container.approval === 'APPROVED';
  const dirty = !!container.dirty && !approved;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(container.label);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);
  // Enter edit mode when autoEdit BECOMES true (the row often mounts before the
  // create handler sets the flag, so an initial-state capture would miss it).
  useEffect(() => {
    if (autoEdit && !approved) {
      setDraft(container.label);
      setEditing(true);
      onEditConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoEdit]);

  const beginEdit = () => {
    if (approved) return; // rename blocked on approved (D7.11)
    setDraft(container.label);
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== container.label) onRename(next);
    onCommitName?.(); // edit accepted (Enter/blur) — lets the create flow advance to the member
  };

  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-zinc-800/70" style={{ background: '#1b1b1f' }} data-testid={`container-row-${container.id}`}>
      <button type="button" className="text-zinc-500" aria-label={expanded ? 'Collapse' : 'Expand'} onClick={onToggleExpand}>
        <ChevronGlyph expanded={expanded} />
      </button>
      <span style={{ color: KIND_STROKE[container.kind] }} aria-hidden="true">
        <KindGlyph kind={container.kind} size={13} />
      </span>

      {editing ? (
        <input
          ref={inputRef}
          className="text-[11px] bg-zinc-800 text-zinc-100 px-1 rounded flex-1 min-w-0 outline-none ring-1 ring-blue-500"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') setEditing(false);
          }}
          onBlur={commit}
          aria-label="Rename container"
        />
      ) : (
        <span
          className="text-[11px] text-zinc-200 font-medium truncate flex-1"
          onDoubleClick={beginEdit}
          title={container.label}
        >
          {container.label}
        </span>
      )}

      {/* Transport status (in-place; no toast/banner) — saving / conflict / error. */}
      {saving && (
        <span className="text-[8px] text-zinc-400 animate-pulse" title="Saving…" data-testid="saving-indicator">saving…</span>
      )}
      {conflict && (
        <button
          type="button"
          className="text-[10px] leading-none text-red-400 hover:text-red-300"
          title="Version conflict — click to resolve"
          aria-label="Resolve version conflict"
          data-testid="conflict-badge"
          onClick={onResolveConflict}
        >
          ⚠
        </button>
      )}
      {errored && (
        <span className="w-1.5 h-1.5 rounded-full bg-red-500" title={`Save failed (${transport?.errorKind})`} data-testid="error-dot" />
      )}

      {dirty && !saving && !conflict && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" title="Unsaved changes (dirty)" data-testid="dirty-dot" />}
      {!dirty && !saving && !conflict && !errored && crossPanelCount != null && crossPanelCount > 0 && (
        <span className="text-[8px] px-1 rounded-sm bg-zinc-700 text-zinc-300" title={`Rendering on ${crossPanelCount} other panel(s)`}>
          ↗ {crossPanelCount}
        </span>
      )}

      <span className="text-[9px] text-zinc-500" data-testid="member-count">{container.members.length}</span>

      <button
        type="button"
        className={approved ? 'text-emerald-400' : 'text-zinc-500 hover:text-emerald-300'}
        title={approved ? 'Approved (locked) — click to revoke approval' : 'Approve (lock for review)'}
        aria-label={approved ? 'Revoke approval' : 'Approve'}
        onClick={onApproveToggle}
      >
        <ApproveGlyph filled={approved} />
      </button>

      <button
        type="button"
        disabled={approved}
        className={approved ? 'text-zinc-700 cursor-not-allowed' : 'text-zinc-400 hover:text-zinc-100'}
        title={approved ? 'Add member — container is approved (locked); revoke approval to edit' : 'Add member to this container'}
        aria-label="Add member"
        onClick={onAddMember}
      >
        <PlusGlyph size={13} />
      </button>

      <button
        type="button"
        disabled={!dirty}
        className={dirty ? 'text-zinc-300 hover:text-white' : 'text-zinc-700 cursor-not-allowed'}
        title={approved ? 'Approved (locked) — nothing to save' : dirty ? 'Save this annotation' : 'Saved — no changes'}
        aria-label="Save container"
        onClick={onSave}
      >
        <SaveGlyph size={13} />
      </button>

      <button type="button" className="text-zinc-600 hover:text-zinc-300" aria-label="Container menu" onClick={onKebab}>
        <KebabGlyph />
      </button>

      <button
        type="button"
        disabled={approved}
        className={approved ? 'text-zinc-700 cursor-not-allowed' : 'text-zinc-500 hover:text-red-400'}
        title={approved ? 'Delete — approved (locked); revoke first' : 'Delete (locally / from XNAT)'}
        aria-label="Delete container"
        onClick={onDelete}
      >
        <DeleteGlyph />
      </button>
    </div>
  );
}
