/**
 * ContainerListPanel — the unified D7 list panel for all containers
 * (RTSTRUCT structure-sets, DICOM SEGs, POI lists).
 *
 * Phase 3.3 ships the visual shell + per-row rendering. Interactivity
 * (visibility cycling, selection vs active, hover sync, action menus,
 * approval workflow, ROI type editing, provenance, multi-select bulk
 * operations) lands in Phase 3.4 → 3.8.
 *
 * Replaces the legacy AnnotationListPanel + SegmentationPanel split when
 * `multiViewport.enabled` is on; the legacy panels remain mounted under
 * flag-off until Phase 6.
 *
 * Reads from useContainerStore (Phase 3.2 reactive snapshot of the
 * containerBridge). Components don't read the bridge directly.
 *
 * Visual style mirrors the existing AnnotationListPanel / SegmentationPanel
 * (w-64 right-side rail, dark theme, zinc-* tones, xs typography).
 */
import { useEffect, useRef, useState } from 'react';
import { useContainerStore } from '../../stores/containerStore';
import { useContainerSelectionStore } from '../../stores/containerSelectionStore';
import { containerService } from '../../lib/cornerstone/containerService';
import { nextVisibilityMode } from '../../lib/cornerstone/segmentationService/memberVisibility';
import type { Container, Member, RGB, VisibilityMode } from '../../types/annotation';

export default function ContainerListPanel() {
  const containers = useContainerStore((s) => s.containers);
  const containerList = Array.from(containers.values());

  return (
    <div
      data-testid="container-panel"
      className="w-64 shrink-0 border-l border-zinc-800 bg-zinc-950 flex flex-col overflow-hidden"
    >
      <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between min-h-[36px]">
        <h3 className="text-xs font-semibold text-zinc-300">
          Structures
          <span
            data-testid="container-count"
            className="text-zinc-500 font-normal ml-1.5"
          >
            {containerList.length}
          </span>
        </h3>
      </div>

      <div className="flex-1 overflow-y-auto">
        {containerList.length === 0 ? (
          <div
            data-testid="container-panel-empty"
            className="p-4 text-xs text-zinc-600 text-center leading-relaxed"
          >
            No structures yet.
            <br />
            <span className="text-zinc-700">
              Create a new structure-set or load one from XNAT.
            </span>
          </div>
        ) : (
          <ul className="py-0.5">
            {containerList.map((container) => (
              <ContainerRow key={container.id} container={container} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Row components ────────────────────────────────────────────────

function ContainerRow({ container }: { container: Container }) {
  return (
    <li
      data-testid={`container-row:${container.id}`}
      className="border-b border-zinc-800/50"
    >
      <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900/30">
        <span
          className={`text-[10px] uppercase tracking-wider font-semibold ${kindColor(container.kind)}`}
        >
          {container.kind}
        </span>
        <span className="flex-1 text-xs text-zinc-200 truncate" title={container.name}>
          {container.name}
        </span>
        {container.dirty && (
          <span
            data-testid={`container-dirty:${container.id}`}
            className="w-1.5 h-1.5 rounded-full bg-amber-500"
            title="Unsaved changes"
            aria-label="unsaved changes"
          />
        )}
        {container.approval.approved && (
          <span
            data-testid={`container-approved:${container.id}`}
            className="text-[9px] uppercase font-semibold text-emerald-400"
            title={
              container.approval.reviewerName
                ? `Approved by ${container.approval.reviewerName}`
                : 'Approved'
            }
          >
            ✓ approved
          </span>
        )}
      </div>

      {container.members.length === 0 ? (
        <div
          data-testid={`container-no-members:${container.id}`}
          className="px-6 py-1 text-[11px] text-zinc-600 italic"
        >
          (empty)
        </div>
      ) : (
        <ul>
          {container.members.map((member) => (
            <MemberRow key={member.id} member={member} />
          ))}
        </ul>
      )}
    </li>
  );
}

function MemberRow({ member }: { member: Member }) {
  const isSelected = useContainerSelectionStore((s) => s.selectionSet.has(member.id));
  const isActive = useContainerSelectionStore((s) => s.activeMemberId === member.id);
  const isHovered = useContainerSelectionStore((s) => s.hoverMemberId === member.id);

  const [menuOpen, setMenuOpen] = useState(false);
  const [renameValue, setRenameValue] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the menu on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    function onDocPointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => document.removeEventListener('pointerdown', onDocPointerDown);
  }, [menuOpen]);

  const onRowEnter = () => useContainerSelectionStore.getState().setHover(member.id);
  const onRowLeave = () => useContainerSelectionStore.getState().setHover(null);

  const startRename = () => {
    setMenuOpen(false);
    setRenameValue(member.name);
  };
  const cancelRename = () => setRenameValue(null);
  const submitRename = () => {
    const next = (renameValue ?? '').trim();
    if (next.length > 0 && next !== member.name) {
      try {
        containerService.renameMember(member.id, next);
      } catch (err) {
        console.warn('[ContainerListPanel] rename failed', err);
      }
    }
    setRenameValue(null);
  };

  const onDelete = () => {
    setMenuOpen(false);
    if (typeof window !== 'undefined' && !window.confirm(`Delete "${member.name}"?`)) {
      return;
    }
    try {
      containerService.deleteMember(member.id);
    } catch (err) {
      console.warn('[ContainerListPanel] delete failed', err);
    }
  };

  const onRowClick = (e: React.MouseEvent<HTMLLIElement>) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      // Multi-select toggle (D7.5).
      useContainerSelectionStore.getState().toggleSelection(member.id);
    } else if (e.detail >= 2) {
      // Double-click → activate AND replace selection (D7.5).
      containerService.setActiveMember(member.id);
      useContainerSelectionStore.getState().setSelection(member.id);
    } else {
      // Single-click → replace selection (D7.5).
      useContainerSelectionStore.getState().setSelection(member.id);
    }
  };

  const onColorSwatchClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    // Color swatch is the dedicated "make active" affordance per D7.5 —
    // sets active without changing the selection set.
    e.stopPropagation();
    containerService.setActiveMember(member.id);
  };

  return (
    <li
      data-testid={`member-row:${member.id}`}
      onClick={onRowClick}
      onMouseEnter={onRowEnter}
      onMouseLeave={onRowLeave}
      className={`group flex items-center gap-2 pl-6 pr-3 py-1 cursor-pointer transition-colors border-l-2 ${
        isSelected
          ? 'bg-blue-900/30 border-blue-500'
          : isHovered
            ? 'bg-zinc-800/60 border-transparent'
            : 'border-transparent hover:bg-zinc-800/40'
      }`}
      data-selected={isSelected || undefined}
      data-active={isActive || undefined}
      data-hovered={isHovered || undefined}
    >
      <button
        type="button"
        data-testid={`member-color:${member.id}`}
        onClick={onColorSwatchClick}
        className={`w-2.5 h-2.5 rounded-sm shrink-0 border transition-shadow ${
          isActive
            ? 'border-amber-300 ring-1 ring-amber-300'
            : 'border-zinc-700 hover:border-zinc-400'
        }`}
        style={{ backgroundColor: rgbCss(member.color) }}
        aria-label={`color ${rgbCss(member.color)} (click to make active)`}
        aria-pressed={isActive}
        title={isActive ? 'Active member (drawing target)' : 'Click to make active'}
      />
      {renameValue !== null ? (
        <input
          type="text"
          autoFocus
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitRename();
            else if (e.key === 'Escape') cancelRename();
          }}
          onBlur={submitRename}
          onClick={(e) => e.stopPropagation()}
          data-testid={`member-rename:${member.id}`}
          className="flex-1 min-w-0 text-xs bg-zinc-800 text-zinc-100 border border-blue-500 rounded px-1 py-0.5 outline-none"
        />
      ) : (
        <span
          className={`flex-1 text-xs truncate ${
            isActive ? 'text-amber-200 font-medium' : 'text-zinc-300'
          }`}
          title={member.name}
        >
          {member.name}
        </span>
      )}
      <button
        type="button"
        data-testid={`member-visibility:${member.id}`}
        className="text-[10px] text-zinc-500 hover:text-zinc-200 transition-colors px-0.5"
        title={`Visibility: ${member.visibility} (click to cycle)`}
        aria-label={`visibility ${member.visibility}`}
        onClick={(e) => {
          e.stopPropagation();
          containerService.setMemberVisibility(member.id, nextVisibilityMode(member.visibility));
        }}
      >
        {visibilityGlyph(member.visibility)}
      </button>
      {member.locked && (
        <span
          data-testid={`member-locked:${member.id}`}
          className="text-[10px] text-amber-500"
          title="Locked"
          aria-label="locked"
        >
          🔒
        </span>
      )}
      <div ref={menuRef} className="relative">
        <button
          type="button"
          data-testid={`member-menu:${member.id}`}
          className="text-[12px] text-zinc-500 hover:text-zinc-200 transition-colors px-0.5 leading-none"
          title="Member actions"
          aria-label="member actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
        >
          ⋯
        </button>
        {menuOpen && (
          <div
            data-testid={`member-menu-popover:${member.id}`}
            className="absolute right-0 top-5 z-10 bg-zinc-900 border border-zinc-700 rounded shadow-lg py-0.5 min-w-[100px]"
            role="menu"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              data-testid={`member-menu-rename:${member.id}`}
              className="block w-full text-left text-xs text-zinc-200 hover:bg-zinc-800 px-2 py-1"
              role="menuitem"
              onClick={startRename}
            >
              Rename
            </button>
            <button
              type="button"
              data-testid={`member-menu-delete:${member.id}`}
              className="block w-full text-left text-xs text-red-400 hover:bg-red-900/20 px-2 py-1"
              role="menuitem"
              onClick={onDelete}
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────

function rgbCss(color: RGB): string {
  return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}

function visibilityGlyph(mode: VisibilityMode): string {
  switch (mode) {
    case 'hidden':
      return '○';
    case 'outlined':
      return '◐';
    case 'filled':
      return '●';
  }
}

function kindColor(kind: Container['kind']): string {
  switch (kind) {
    case 'RTSTRUCT':
      return 'text-violet-400';
    case 'SEG':
      return 'text-cyan-400';
    case 'POI':
      return 'text-amber-400';
  }
}
