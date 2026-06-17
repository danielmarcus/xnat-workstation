/**
 * ContainerRow (Rebuild Phase 3, R3.4) — one container header row (frozen mockup
 * §2/§3/§7). Presentational. Shows the kind glyph (type-colored), the container
 * name (double-click → inline rename, D7.6), a dirty dot OR a cross-panel "↗ N"
 * pill, the member count, and the row action cluster: approve "✓" toggle (outline
 * → green when approved), add-member "+", per-container Save (enabled only when
 * dirty & unapproved), kebab "⋮", delete "✕". Approved containers lock add/save/
 * delete (D7.11). Behaviour injected via callbacks.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
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
  /** Activate this container (make it the active annotation target) — clicking its
   *  name. Switches the panel/toolbox to its kind + routes new drawing into it. */
  onActivate?: () => void;
  onApproveToggle: () => void;
  onAddMember: () => void;
  onSave: () => void;
  onKebab: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
  /** Kebab: set visibility for every member ("Hide all" / "Show all"). */
  onSetAllVisible?: (visible: boolean) => void;
  /** Kebab: set lock for every member ("Lock all" / "Unlock all"). */
  onSetAllLocked?: (locked: boolean) => void;
  /** Kebab: discard unsaved changes back to last-saved. Item shown only when provided. */
  onRevert?: () => void;
  /** Kebab: export this container as a standalone DICOM file to local disk. */
  onExportDicom?: () => void;
  /** Kebab: export this container's per-member metrics as a CSV file. */
  onExportCsv?: () => void;
}

export default function ContainerRow(props: ContainerRowProps) {
  const { container, expanded, transport, onResolveConflict, crossPanelCount, autoEdit, onEditConsumed, onCommitName, onToggleExpand, onActivate, onApproveToggle, onAddMember, onSave, onKebab, onDelete, onRename, onSetAllVisible, onSetAllLocked, onRevert, onExportDicom, onExportCsv } = props;
  const saving = transport?.phase === 'saving' || transport?.phase === 'loading';
  const conflict = transport?.phase === 'error' && transport?.errorKind === 'conflict';
  const errored = transport?.phase === 'error' && transport?.errorKind !== 'conflict';
  const approved = container.approval === 'APPROVED';
  const dirty = !!container.dirty && !approved;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(container.label);
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Kebab aggregate state → "Hide all" vs "Show all", "Lock all" vs "Unlock all".
  const anyVisible = container.members.some((m) => m.visible);
  const anyUnlocked = container.members.some((m) => !m.locked);

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
        <div
          className="flex-1 min-w-0 flex items-baseline gap-1.5 cursor-pointer"
          onClick={onActivate}
          data-testid={`container-activate-${container.id}`}
        >
          <span
            className="text-[11px] text-zinc-200 font-medium truncate min-w-0"
            onDoubleClick={beginEdit}
            title={container.label}
          >
            {container.label}
          </span>
          {/* XNAT scan number of this annotation (e.g. a 30xx SEG scan), shown next
              to the label so panel rows map to scans in XNAT. Absent until the
              annotation has been saved (a new one has no scan id yet). */}
          {container.source.scanId && (
            <span
              className="text-[9px] text-zinc-500 tabular-nums shrink-0"
              title={`XNAT scan ${container.source.scanId}`}
              data-testid={`container-scan-${container.id}`}
            >
              #{container.source.scanId}
            </span>
          )}
        </div>
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

      {/* No "+" for Measurement (SR) containers: a measurement has no empty member to
          add — it's authored by drawing with a measurement tool from the toolbox. The
          button only applies to SEG segments / RTSTRUCT ROIs. */}
      {container.kind !== 'SR' && (
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
      )}

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

      <div className="relative">
        <button
          type="button"
          className="text-zinc-600 hover:text-zinc-300"
          aria-label="Container menu"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => { onKebab(); setMenuOpen((v) => !v); }}
        >
          <KebabGlyph />
        </button>
        {menuOpen && (
          <>
            {/* click-away backdrop */}
            <span className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div
              className="absolute right-0 top-5 z-50 w-44 rounded-md border border-zinc-700 bg-zinc-900 shadow-xl py-1 text-[11px]"
              role="menu"
              data-testid={`container-menu-${container.id}`}
            >
              <MenuItem
                testid={`menu-visibility-${container.id}`}
                onClick={() => { onSetAllVisible?.(!anyVisible); setMenuOpen(false); }}
              >
                {anyVisible ? 'Hide all' : 'Show all'}
              </MenuItem>
              <MenuItem
                testid={`menu-lock-${container.id}`}
                onClick={() => { onSetAllLocked?.(anyUnlocked); setMenuOpen(false); }}
              >
                {anyUnlocked ? 'Lock all' : 'Unlock all'}
              </MenuItem>
              {onRevert && (
                <MenuItem
                  testid={`menu-revert-${container.id}`}
                  disabled={!dirty}
                  onClick={() => { onRevert(); setMenuOpen(false); }}
                >
                  Revert
                </MenuItem>
              )}
              <div className="my-1 border-t border-zinc-800" role="separator" />
              <MenuItem
                testid={`menu-export-dicom-${container.id}`}
                onClick={() => { onExportDicom?.(); setMenuOpen(false); }}
              >
                Export to DICOM…
              </MenuItem>
              <MenuItem
                testid={`menu-export-csv-${container.id}`}
                onClick={() => { onExportCsv?.(); setMenuOpen(false); }}
              >
                Export to CSV…
              </MenuItem>
            </div>
          </>
        )}
      </div>

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

function MenuItem(props: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  testid?: string;
}) {
  const { children, onClick, disabled, testid } = props;
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      data-testid={testid}
      className={
        disabled
          ? 'block w-full text-left px-2.5 py-1 text-zinc-600 cursor-not-allowed'
          : 'block w-full text-left px-2.5 py-1 text-zinc-200 hover:bg-zinc-800'
      }
      onClick={onClick}
    >
      {children}
    </button>
  );
}
