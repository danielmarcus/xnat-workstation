/**
 * ContainerListPanel — the unified D7 list panel for all containers
 * (RTSTRUCT structure-sets, DICOM SEGs, POI lists).
 *
 * Phase 3.3 ships the visual shell + per-row rendering. Interactivity
 * (visibility cycling, selection vs active, hover sync, action menus,
 * approval workflow, ROI type editing, provenance, multi-select bulk
 * operations) lands in Phase 3.4 → 3.8.
 *
 * Sole annotations side panel after Phase 6 / Stage 2B.4 deleted the
 * legacy AnnotationListPanel + SegmentationPanel. Toggled on/off via
 * `useSegmentationStore.showPanel` (preserved name, repurposed).
 *
 * Reads from useContainerStore (Phase 3.2 reactive snapshot of the
 * containerBridge). Components don't read the bridge directly.
 *
 * w-64 right-side rail, dark theme, zinc-* tones, xs typography.
 */
import { useEffect, useRef, useState } from 'react';
import { useConnectionStore } from '../../stores/connectionStore';
import { useContainerStore } from '../../stores/containerStore';
import { useContainerSelectionStore } from '../../stores/containerSelectionStore';
import { useTransportStore } from '../../stores/transportStore';
import { useViewerStore } from '../../stores/viewerStore';
import { containerService } from '../../lib/cornerstone/containerService';
import * as containerActions from '../../lib/cornerstone/containerActions';
import { nextVisibilityMode } from '../../lib/cornerstone/segmentationService/memberVisibility';
import {
  classifyAnnotationOnViewport,
  classifySegmentationOnViewport,
  type EligibilityClass,
} from '../../lib/cornerstone/segmentationService/visibility';
import type { Container, Member, RGB, VisibilityMode } from '../../types/annotation';

type SortOrder = 'default' | 'alphabetical' | 'segmentIndex';

const SORT_LABEL: Record<SortOrder, string> = {
  default: 'Creation order',
  alphabetical: 'Alphabetical',
  segmentIndex: 'Segment index',
};

// 4×4 preset palette for the per-member color picker (spec §4.5).
// Chosen to read clearly against the dark viewer background and to
// stay distinguishable when several overlap on a single image.
const MEMBER_COLOR_PRESETS: ReadonlyArray<RGB> = [
  [220, 50, 50],   [50, 200, 50],   [80, 130, 240],  [240, 200, 50],
  [220, 80, 200],  [60, 200, 200],  [240, 140, 40],  [160, 100, 220],
  [70, 220, 140],  [255, 130, 130], [200, 220, 80],  [110, 180, 230],
  [230, 100, 130], [180, 130, 90],  [200, 200, 200], [120, 120, 120],
];

function sortMembersInPlace(members: Member[], order: SortOrder): Member[] {
  if (order === 'default') return members;
  const sorted = [...members];
  if (order === 'alphabetical') {
    sorted.sort((a, b) => a.name.localeCompare(b.name));
  } else if (order === 'segmentIndex') {
    sorted.sort((a, b) => (a.segmentIndex ?? 0) - (b.segmentIndex ?? 0));
  }
  return sorted;
}

export default function ContainerListPanel() {
  const containers = useContainerStore((s) => s.containers);
  const containerList = Array.from(containers.values());
  const selectionSet = useContainerSelectionStore((s) => s.selectionSet);

  const [filter, setFilter] = useState('');
  const [sortOrder, setSortOrder] = useState<SortOrder>('default');
  const trimmedFilter = filter.trim().toLowerCase();

  // Filter by member name + optional sort (both per §D7.7). Both are
  // non-destructive — filter does NOT mutate visibility/lock state per
  // §D7.7; sort is presentation-only and does NOT mutate the persisted
  // Z-order on Container.members[] (which lives on the container per
  // §B7 default order).
  const visibleContainers = containerList
    .map((c) => {
      let members = trimmedFilter
        ? c.members.filter((m) => m.name.toLowerCase().includes(trimmedFilter))
        : c.members;
      members = sortMembersInPlace(members, sortOrder);
      return { ...c, members };
    })
    .filter((c) => !trimmedFilter || c.members.length > 0);

  return (
    <div
      data-testid="container-panel"
      className="w-64 shrink-0 border-l border-zinc-800 bg-zinc-950 flex flex-col overflow-hidden"
    >
      <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between min-h-[36px] gap-2">
        <h3 className="text-xs font-semibold text-zinc-300 flex-1">
          Structures
          <span
            data-testid="container-count"
            className="text-zinc-500 font-normal ml-1.5"
          >
            {containerList.length}
          </span>
        </h3>
        {containerList.some((c) => c.dirty) && (
          <button
            type="button"
            data-testid="session-save-all"
            onClick={() => void containerActions.saveAllDirty()}
            className="text-[10px] uppercase font-semibold text-zinc-300 hover:text-emerald-300 px-1.5 py-0.5 border border-zinc-700 hover:border-emerald-500 rounded"
            title="Save all dirty containers"
            aria-label="save all dirty containers"
          >
            save all
          </button>
        )}
      </div>

      {containerList.length > 0 && (
        <div className="px-3 py-2 border-b border-zinc-800/70 flex flex-col gap-2">
          <div className="relative">
            <input
              type="text"
              data-testid="container-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter members…"
              className="w-full text-xs bg-zinc-900 text-zinc-200 placeholder:text-zinc-600 border border-zinc-800 focus:border-blue-500 rounded px-2 py-1 outline-none"
              aria-label="Filter members by name"
            />
            {filter && (
              <button
                type="button"
                data-testid="container-filter-clear"
                onClick={() => setFilter('')}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] text-zinc-500 hover:text-zinc-200 px-1"
                title="Clear filter"
                aria-label="clear filter"
              >
                ×
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <label
              htmlFor="container-sort"
              className="text-[10px] text-zinc-500"
            >
              Sort:
            </label>
            <select
              id="container-sort"
              data-testid="container-sort"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as SortOrder)}
              className="flex-1 text-[11px] bg-zinc-900 text-zinc-300 border border-zinc-800 rounded px-1 py-0.5 outline-none focus:border-blue-500"
              aria-label="Sort members"
            >
              <option value="default">{SORT_LABEL.default}</option>
              <option value="alphabetical">{SORT_LABEL.alphabetical}</option>
              <option value="segmentIndex">{SORT_LABEL.segmentIndex}</option>
            </select>
          </div>
        </div>
      )}

      {selectionSet.size > 0 && <BulkActionBar selectionSet={selectionSet} containers={containerList} />}

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
        ) : visibleContainers.length === 0 ? (
          <div
            data-testid="container-panel-no-matches"
            className="p-4 text-xs text-zinc-600 text-center leading-relaxed"
          >
            No matches for “{filter}”.
          </div>
        ) : (
          <ul className="py-0.5">
            {visibleContainers.map((container) => (
              <ContainerRow key={container.id} container={container} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Bulk action bar (D7.5 / D7.6) ──────────────────────────────────

function BulkActionBar({
  selectionSet,
  containers,
}: {
  selectionSet: ReadonlySet<string>;
  containers: Container[];
}) {
  // Resolve the selected memberIds to (member, container) pairs so we can
  // skip approved containers (edit-locked) when applying mutations.
  const selectedMembers: Array<{ member: Member; container: Container }> = [];
  for (const c of containers) {
    for (const m of c.members) {
      if (selectionSet.has(m.id)) selectedMembers.push({ member: m, container: c });
    }
  }
  const editable = selectedMembers.filter((p) => !p.container.approval.approved);

  const applyVisibility = (mode: VisibilityMode) => {
    for (const { member } of selectedMembers) {
      try {
        containerService.setMemberVisibility(member.id, mode);
      } catch (err) {
        console.warn('[ContainerListPanel] bulk setMemberVisibility failed', err);
      }
    }
  };
  const applyLock = (locked: boolean) => {
    for (const { member } of editable) {
      try {
        containerService.setMemberLock(member.id, locked);
      } catch (err) {
        console.warn('[ContainerListPanel] bulk setMemberLock failed', err);
      }
    }
  };
  const applyDelete = () => {
    if (editable.length === 0) return;
    if (typeof window !== 'undefined' && !window.confirm(
      `Delete ${editable.length} selected member${editable.length === 1 ? '' : 's'}?`,
    )) return;
    for (const { member } of editable) {
      try {
        containerService.deleteMember(member.id);
      } catch (err) {
        console.warn('[ContainerListPanel] bulk deleteMember failed', err);
      }
    }
    useContainerSelectionStore.getState().clearSelection();
  };
  const clearSelection = () => useContainerSelectionStore.getState().clearSelection();

  return (
    <div
      data-testid="bulk-action-bar"
      className="px-3 py-1.5 border-b border-blue-900/50 bg-blue-950/30 flex items-center gap-2 flex-wrap"
    >
      <span className="text-[10px] text-blue-300 font-mono">
        {selectionSet.size} selected
      </span>
      <button
        type="button"
        data-testid="bulk-show"
        onClick={() => applyVisibility('filled')}
        className="text-[10px] text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 px-1.5 py-0.5 rounded"
        title="Show selected members"
      >
        Show
      </button>
      <button
        type="button"
        data-testid="bulk-hide"
        onClick={() => applyVisibility('hidden')}
        className="text-[10px] text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 px-1.5 py-0.5 rounded"
        title="Hide selected members"
      >
        Hide
      </button>
      <button
        type="button"
        data-testid="bulk-lock"
        onClick={() => applyLock(true)}
        disabled={editable.length === 0}
        className="text-[10px] text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 px-1.5 py-0.5 rounded disabled:text-zinc-600 disabled:hover:bg-transparent"
        title="Lock selected members"
      >
        Lock
      </button>
      <button
        type="button"
        data-testid="bulk-unlock"
        onClick={() => applyLock(false)}
        disabled={editable.length === 0}
        className="text-[10px] text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 px-1.5 py-0.5 rounded disabled:text-zinc-600 disabled:hover:bg-transparent"
        title="Unlock selected members"
      >
        Unlock
      </button>
      <button
        type="button"
        data-testid="bulk-delete"
        onClick={applyDelete}
        disabled={editable.length === 0}
        className="text-[10px] text-red-400 hover:text-red-200 hover:bg-red-950/40 px-1.5 py-0.5 rounded disabled:text-zinc-600 disabled:hover:bg-transparent"
        title="Delete selected members"
      >
        Delete
      </button>
      <button
        type="button"
        data-testid="bulk-clear"
        onClick={clearSelection}
        className="ml-auto text-[10px] text-zinc-500 hover:text-zinc-200 px-1"
        title="Clear selection"
        aria-label="clear selection"
      >
        ×
      </button>
    </div>
  );
}

// ─── Kebab menu primitives ────────────────────────────────────────
//
// One row of the spec §4.4.1 popover. Test-id slug pattern is
// `container-menu-{slug}:{containerId}` so tests reference items
// without depending on label text.

function KebabItem({
  cid,
  slug,
  label,
  onClick,
  disabled = false,
  title,
  shortcut,
  destructive = false,
}: {
  cid: string;
  slug: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  shortcut?: string;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid={`container-menu-${slug}:${cid}`}
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className={`flex w-full items-center justify-between gap-3 px-2 py-1 text-left text-xs disabled:text-zinc-600 disabled:hover:bg-transparent ${
        destructive
          ? 'text-red-300 hover:bg-red-900/30'
          : 'text-zinc-200 hover:bg-zinc-800'
      }`}
    >
      <span className="truncate">{label}</span>
      {shortcut && (
        <span className="text-[10px] text-zinc-500 font-mono shrink-0">{shortcut}</span>
      )}
    </button>
  );
}

function KebabSeparator() {
  return <div role="separator" className="my-0.5 border-t border-zinc-800" />;
}

// ─── Container-level right-click context menu (spec §4.7) ──────────

function ContainerContextMenu({
  cid,
  position,
  approved,
  onShowAll,
  onHideAll,
  onLockAll,
  onUnlockAll,
  onExpand,
  onCollapse,
  innerRef,
}: {
  cid: string;
  position: { x: number; y: number };
  approved: boolean;
  onShowAll: () => void;
  onHideAll: () => void;
  onLockAll: () => void;
  onUnlockAll: () => void;
  onExpand: () => void;
  onCollapse: () => void;
  innerRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={innerRef}
      data-testid={`container-context-menu:${cid}`}
      role="menu"
      style={{ left: position.x, top: position.y }}
      className="fixed z-20 bg-zinc-900 border border-zinc-700 rounded shadow-lg py-0.5 min-w-[160px]"
      onClick={(e) => e.stopPropagation()}
    >
      <KebabItem cid={cid} slug="ctx-bulk-show" label="Show all members" onClick={onShowAll} />
      <KebabItem cid={cid} slug="ctx-bulk-hide" label="Hide all members" onClick={onHideAll} />
      <KebabItem
        cid={cid}
        slug="ctx-bulk-lock"
        label="Lock all members"
        onClick={onLockAll}
        disabled={approved}
        title={approved ? 'Edit-locked (container is approved)' : undefined}
      />
      <KebabItem
        cid={cid}
        slug="ctx-bulk-unlock"
        label="Unlock all members"
        onClick={onUnlockAll}
        disabled={approved}
        title={approved ? 'Edit-locked (container is approved)' : undefined}
      />
      <KebabSeparator />
      <KebabItem cid={cid} slug="ctx-expand" label="Expand" onClick={onExpand} />
      <KebabItem cid={cid} slug="ctx-collapse" label="Collapse" onClick={onCollapse} />
    </div>
  );
}

// ─── Row components ────────────────────────────────────────────────

function ContainerRow({ container }: { container: Container }) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [renameDraft, setRenameDraft] = useState<string | null>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const transport = useTransportStore((s) => s.records.get(container.id) ?? null);
  const isConnectedToXnat = useConnectionStore((s) => s.status === 'connected');
  // A container has an XNAT origin if it carries a SourceIdentity from
  // the transport layer (loaded from XNAT vs created locally).
  const hasXnatOrigin = container.sourceIdentity !== null;

  // Close the kebab menu on outside click.
  useEffect(() => {
    if (!actionMenuOpen) return;
    function onDocPointerDown(e: PointerEvent) {
      if (actionMenuRef.current && !actionMenuRef.current.contains(e.target as Node)) {
        setActionMenuOpen(false);
      }
    }
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => document.removeEventListener('pointerdown', onDocPointerDown);
  }, [actionMenuOpen]);

  // Close the right-click context menu on outside click + on Escape.
  useEffect(() => {
    if (!contextMenu) return;
    function onDocPointerDown(e: PointerEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setContextMenu(null);
    }
    document.addEventListener('pointerdown', onDocPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  const closeMenus = () => {
    setActionMenuOpen(false);
    setContextMenu(null);
  };

  // ─── Approval (kept from prior implementation; lives next to the kebab
  //    button on the row) ───
  const onApprove = () => {
    try {
      containerService.approveContainer(container.id, null);
    } catch (err) {
      console.warn('[ContainerListPanel] approve failed', err);
    }
  };

  const onRevoke = () => {
    if (typeof window !== 'undefined' && !window.confirm(`Revoke approval on "${container.name}"?`)) {
      return;
    }
    try {
      containerService.revokeApproval(container.id, null);
    } catch (err) {
      console.warn('[ContainerListPanel] revoke failed', err);
    }
  };

  // ─── Kebab actions (spec §4.4.1) ───

  const onSaveToFile = () => {
    closeMenus();
    void containerActions.exportContainer(container.id);
  };
  const onSaveToXnat = () => {
    closeMenus();
    void containerActions.uploadContainerToXnat(container.id);
  };
  const onRename = () => {
    closeMenus();
    setRenameDraft(container.name);
  };
  const onDuplicate = () => {
    closeMenus();
    // Service-level duplicate-container action lands in a follow-up
    // sub-task. The kebab item is rendered disabled in the menu so this
    // handler isn't reachable yet — but kept here so wiring is centralised.
  };
  const onReloadFromXnat = () => {
    closeMenus();
    // Service-level reload-from-XNAT action lands in a follow-up
    // sub-task. Rendered disabled when no XNAT origin is set.
  };
  const onDiscardChanges = () => {
    closeMenus();
    if (typeof window !== 'undefined' && !window.confirm(
      `Discard local changes to "${container.name}"? This cannot be undone.`,
    )) return;
    void containerActions.revertContainer(container.id);
  };
  const onExportCsv = () => {
    closeMenus();
    // MEAS Export-to-CSV writer lands with the MEAS container type
    // (no MEAS containers exist yet — gated by container.kind === 'MEAS'
    // on the menu item itself).
  };
  const onShowAll = () => {
    closeMenus();
    containerActions.setAllMembersVisibility(container.id, 'filled');
  };
  const onHideAll = () => {
    closeMenus();
    containerActions.setAllMembersVisibility(container.id, 'hidden');
  };
  const onLockAll = () => {
    closeMenus();
    containerActions.setAllMembersLock(container.id, true);
  };
  const onUnlockAll = () => {
    closeMenus();
    containerActions.setAllMembersLock(container.id, false);
  };
  const onRequestDelete = () => {
    closeMenus();
    // DeleteConfirmDialog lands in 7.3d. For now, use window.confirm so
    // the action chain is testable end-to-end.
    if (typeof window !== 'undefined' && !window.confirm(
      `Delete "${container.name}"? This cannot be undone.`,
    )) return;
    try {
      containerService.deleteContainer?.(container.id);
    } catch (err) {
      console.warn('[ContainerListPanel] delete failed', err);
    }
  };

  // Right-click on the container header opens the context menu (§4.7).
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  // Commit / cancel inline rename of the container name.
  const submitRename = () => {
    const next = (renameDraft ?? '').trim();
    if (next.length > 0 && next !== container.name) {
      try {
        containerService.renameContainer(container.id, next);
      } catch (err) {
        console.warn('[ContainerListPanel] container rename failed', err);
      }
    }
    setRenameDraft(null);
  };
  const cancelRename = () => setRenameDraft(null);

  return (
    <li
      data-testid={`container-row:${container.id}`}
      className="border-b border-zinc-800/50"
    >
      <div
        className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900/30"
        onContextMenu={onContextMenu}
      >
        <button
          type="button"
          data-testid={`container-toggle:${container.id}`}
          aria-expanded={isExpanded}
          aria-label={isExpanded ? 'collapse container' : 'expand container'}
          title={isExpanded ? 'Collapse' : 'Expand'}
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded((v) => !v);
          }}
          className="text-[10px] text-zinc-500 hover:text-zinc-200 transition-colors w-3 shrink-0 leading-none"
        >
          {isExpanded ? '▾' : '▸'}
        </button>
        <span
          className={`text-[10px] uppercase tracking-wider font-semibold ${kindColor(container.kind)}`}
        >
          {container.kind}
        </span>
        {renameDraft === null ? (
          <span className="flex-1 text-xs text-zinc-200 truncate" title={container.name}>
            {container.name}
          </span>
        ) : (
          <input
            type="text"
            data-testid={`container-rename-input:${container.id}`}
            autoFocus
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onBlur={submitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submitRename(); }
              else if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 text-xs bg-zinc-900 text-zinc-200 border border-blue-500 rounded px-1 py-0.5 outline-none"
            aria-label="rename container"
          />
        )}
        <button
          type="button"
          data-testid={`container-a2c-toggle:${container.id}`}
          aria-pressed={container.a2cOptedIn}
          aria-label={`A2c cross-series rendering ${container.a2cOptedIn ? 'on' : 'off'}`}
          title={
            container.a2cOptedIn
              ? 'A2c cross-series rendering: ON. Click to hide breath-hold / 4D-CT phase siblings.'
              : 'A2c cross-series rendering: OFF (default per §A2c). Click to show breath-hold / 4D-CT phase siblings.'
          }
          onClick={(e) => {
            e.stopPropagation();
            try {
              containerService.setA2cOptedIn(container.id, !container.a2cOptedIn);
            } catch (err) {
              console.warn('[ContainerListPanel] setA2cOptedIn failed', err);
            }
          }}
          className={`text-[9px] font-mono px-1 py-0 rounded border transition-colors ${
            container.a2cOptedIn
              ? 'bg-orange-900/40 border-orange-600 text-orange-300 hover:bg-orange-900/60'
              : 'bg-zinc-900/30 border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'
          }`}
        >
          A2c
        </button>
        {container.parseError && (
          <span
            data-testid={`container-parse-error:${container.id}`}
            className="text-[9px] uppercase font-semibold text-red-400 px-1 rounded bg-red-950/40"
            title={`Parse error: ${container.parseError.message}`}
            aria-label="parse error"
          >
            ⚠ parse
          </span>
        )}
        {transport?.loadInFlight && (
          <span
            data-testid={`container-load-inflight:${container.id}`}
            className="text-[10px] text-zinc-400 animate-pulse"
            title="Loading…"
            aria-label="loading"
          >
            ⟳
          </span>
        )}
        {transport?.saveInFlight && !transport?.loadInFlight && (
          <span
            data-testid={`container-save-inflight:${container.id}`}
            className="text-[10px] text-zinc-400 animate-pulse"
            title="Save in progress"
            aria-label="save in progress"
          >
            ⟳
          </span>
        )}
        {transport?.externalChangePending && (
          <span
            data-testid={`container-conflict:${container.id}`}
            className="text-[9px] uppercase font-semibold text-amber-400 px-1 rounded bg-amber-950/40"
            title="Server-side change detected (H6). Resolve conflict before saving."
            aria-label="conflict pending"
          >
            ⚠ conflict
          </span>
        )}
        {transport?.lastError && transport.lastOutcome === 'transient-failure' && (
          <span
            data-testid={`container-transient-error:${container.id}`}
            className="text-[9px] uppercase font-semibold text-amber-400 px-1 rounded bg-amber-950/40"
            title={`Transient error (retryable): ${transport.lastError.message}`}
            aria-label="transient save error"
          >
            ⚠ retry
          </span>
        )}
        {transport?.lastError && transport.lastOutcome === 'permanent-failure' && (
          <span
            data-testid={`container-permanent-error:${container.id}`}
            className="text-[9px] uppercase font-semibold text-red-400 px-1 rounded bg-red-950/40"
            title={`Permanent error: ${transport.lastError.message}`}
            aria-label="permanent save error"
          >
            ⨯ failed
          </span>
        )}
        {container.dirty && (
          <span
            data-testid={`container-dirty:${container.id}`}
            className="w-1.5 h-1.5 rounded-full bg-amber-500"
            title="Unsaved changes"
            aria-label="unsaved changes"
          />
        )}
        {container.approval.approved ? (
          <>
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
            <button
              type="button"
              data-testid={`container-revoke:${container.id}`}
              className="text-[9px] uppercase font-semibold text-zinc-500 hover:text-amber-300 transition-colors px-1"
              title="Revoke approval (requires confirmation)"
              aria-label="revoke approval"
              onClick={(e) => {
                e.stopPropagation();
                onRevoke();
              }}
            >
              revoke
            </button>
          </>
        ) : (
          <button
            type="button"
            data-testid={`container-approve:${container.id}`}
            className="text-[9px] uppercase font-semibold text-zinc-500 hover:text-emerald-400 transition-colors px-1 border border-zinc-700 hover:border-emerald-500 rounded"
            title="Approve container — locks all members from edits per §D7.11"
            aria-label="approve container"
            onClick={(e) => {
              e.stopPropagation();
              onApprove();
            }}
          >
            approve
          </button>
        )}
        <div ref={actionMenuRef} className="relative">
          <button
            type="button"
            data-testid={`container-menu:${container.id}`}
            className="text-[12px] text-zinc-500 hover:text-zinc-200 transition-colors px-0.5 leading-none"
            title="Container actions"
            aria-label="container actions"
            aria-haspopup="menu"
            aria-expanded={actionMenuOpen}
            onClick={(e) => {
              e.stopPropagation();
              setActionMenuOpen((v) => !v);
            }}
          >
            ⋯
          </button>
          {actionMenuOpen && (
            <div
              data-testid={`container-menu-popover:${container.id}`}
              className="absolute right-0 top-5 z-10 bg-zinc-900 border border-zinc-700 rounded shadow-lg py-0.5 min-w-[180px]"
              role="menu"
              onClick={(e) => e.stopPropagation()}
            >
              <KebabItem
                cid={container.id}
                slug="save-file"
                label="Save to file…"
                onClick={onSaveToFile}
              />
              <KebabItem
                cid={container.id}
                slug="save-xnat"
                label="Save to XNAT…"
                onClick={onSaveToXnat}
                disabled={!isConnectedToXnat || container.kind === 'POI'}
                title={
                  !isConnectedToXnat
                    ? 'Not connected to XNAT'
                    : container.kind === 'POI'
                      ? 'POI upload not yet supported'
                      : undefined
                }
              />
              <KebabSeparator />
              <KebabItem
                cid={container.id}
                slug="rename"
                label="Rename"
                onClick={onRename}
                disabled={container.approval.approved}
                title={container.approval.approved ? 'Edit-locked (container is approved)' : undefined}
                shortcut="F2"
              />
              <KebabItem
                cid={container.id}
                slug="duplicate"
                label="Duplicate"
                onClick={onDuplicate}
                disabled
                title="Duplicate-container lands in a follow-up sub-task"
              />
              <KebabItem
                cid={container.id}
                slug="reload"
                label="Reload from XNAT"
                onClick={onReloadFromXnat}
                disabled={!hasXnatOrigin}
                title={!hasXnatOrigin ? 'No XNAT origin recorded' : undefined}
              />
              <KebabItem
                cid={container.id}
                slug="discard"
                label="Discard local changes"
                onClick={onDiscardChanges}
                disabled={!container.dirty || container.approval.approved}
                title={
                  container.approval.approved
                    ? 'Edit-locked (container is approved)'
                    : !container.dirty
                      ? 'No local changes to discard'
                      : undefined
                }
              />
              {(container.kind as string) === 'MEAS' && (
                <>
                  <KebabSeparator />
                  <KebabItem
                    cid={container.id}
                    slug="export-csv"
                    label="Export to CSV"
                    onClick={onExportCsv}
                    disabled
                    title="MEAS CSV export lands with the Measurement container type"
                  />
                </>
              )}
              <KebabSeparator />
              <KebabItem
                cid={container.id}
                slug="bulk-show"
                label="Show all members"
                onClick={onShowAll}
              />
              <KebabItem
                cid={container.id}
                slug="bulk-hide"
                label="Hide all members"
                onClick={onHideAll}
              />
              <KebabItem
                cid={container.id}
                slug="bulk-lock"
                label="Lock all members"
                onClick={onLockAll}
                disabled={container.approval.approved}
                title={container.approval.approved ? 'Edit-locked (container is approved)' : undefined}
              />
              <KebabItem
                cid={container.id}
                slug="bulk-unlock"
                label="Unlock all members"
                onClick={onUnlockAll}
                disabled={container.approval.approved}
                title={container.approval.approved ? 'Edit-locked (container is approved)' : undefined}
              />
              <KebabSeparator />
              <KebabItem
                cid={container.id}
                slug="delete"
                label="Delete…"
                onClick={onRequestDelete}
                destructive
                disabled={container.approval.approved}
                title={container.approval.approved ? 'Edit-locked (container is approved)' : undefined}
              />
            </div>
          )}
        </div>
      </div>

      {isExpanded && (
        container.members.length === 0 ? (
          <div
            data-testid={`container-no-members:${container.id}`}
            className="px-6 py-1 text-[11px] text-zinc-600 italic"
          >
            (empty)
          </div>
        ) : (
          <ul>
            {container.members.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                containerKind={container.kind}
                containerApproved={container.approval.approved}
              />
            ))}
          </ul>
        )
      )}

      {contextMenu && (
        <ContainerContextMenu
          cid={container.id}
          position={contextMenu}
          approved={container.approval.approved}
          onShowAll={() => { onShowAll(); }}
          onHideAll={() => { onHideAll(); }}
          onLockAll={() => { onLockAll(); }}
          onUnlockAll={() => { onUnlockAll(); }}
          onExpand={() => { setIsExpanded(true); setContextMenu(null); }}
          onCollapse={() => { setIsExpanded(false); setContextMenu(null); }}
          innerRef={contextMenuRef}
        />
      )}
    </li>
  );
}

function MemberRow({
  member,
  containerKind,
  containerApproved,
}: {
  member: Member;
  containerKind: Container['kind'];
  containerApproved: boolean;
}) {
  const isSelected = useContainerSelectionStore((s) => s.selectionSet.has(member.id));
  const isActive = useContainerSelectionStore((s) => s.activeMemberId === member.id);
  const isHovered = useContainerSelectionStore((s) => s.hoverMemberId === member.id);
  const activeViewportId = useViewerStore((s) => s.activeViewportId);
  const eligibility = classifyMemberOnViewport(member, containerKind, activeViewportId);

  const [menuOpen, setMenuOpen] = useState(false);
  const [renameValue, setRenameValue] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Drag-and-drop reorder state (spec §4.5). `isDragSource` dims the row
  // while it is being dragged; `dropEdge` shows a blue 2px line above or
  // below to indicate the drop position. The dataTransfer payload carries
  // the source memberId; on drop, reorderMember is called.
  //
  // dropEdge is mirrored to a ref so the onDrop handler reads the latest
  // value even when React state updates from onDragOver haven't been
  // observed by the next event tick (matters in tests + fast drops).
  const [isDragSource, setIsDragSource] = useState(false);
  const [dropEdge, setDropEdgeState] = useState<'above' | 'below' | null>(null);
  const dropEdgeRef = useRef<'above' | 'below' | null>(null);
  const setDropEdge = (next: 'above' | 'below' | null) => {
    dropEdgeRef.current = next;
    setDropEdgeState(next);
  };

  // Color picker popover state (spec §4.5). Anchored to the swatch.
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const colorPickerRef = useRef<HTMLDivElement | null>(null);
  const customColorInputRef = useRef<HTMLInputElement | null>(null);

  // Close the color picker on outside click.
  useEffect(() => {
    if (!colorPickerOpen) return;
    function onDocPointerDown(e: PointerEvent) {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setColorPickerOpen(false);
      }
    }
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => document.removeEventListener('pointerdown', onDocPointerDown);
  }, [colorPickerOpen]);

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
    // Color swatch opens the color picker popover (spec §4.5). The
    // popover lists 16 presets and a Custom row that opens the OS
    // color picker via a hidden <input type="color">.
    e.stopPropagation();
    if (containerApproved) return;
    setColorPickerOpen((v) => !v);
  };

  const applyColor = (color: RGB) => {
    setColorPickerOpen(false);
    try {
      containerService.recolorMember(member.id, color);
    } catch (err) {
      console.warn('[ContainerListPanel] recolorMember failed', err);
    }
  };

  const onCustomColorInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // <input type="color"> emits "#rrggbb"; parse to RGB.
    const hex = e.target.value;
    const m = hex.match(/^#?([0-9a-fA-F]{6})$/);
    if (!m) return;
    const r = parseInt(m[1].slice(0, 2), 16);
    const g = parseInt(m[1].slice(2, 4), 16);
    const b = parseInt(m[1].slice(4, 6), 16);
    applyColor([r, g, b]);
  };

  // ─── Drag-and-drop reorder (spec §4.5) ───
  const onDragStart = (e: React.DragEvent<HTMLLIElement>) => {
    e.dataTransfer.setData('application/x-member-id', member.id);
    e.dataTransfer.effectAllowed = 'move';
    setIsDragSource(true);
  };
  const onDragEnd = () => {
    setIsDragSource(false);
    setDropEdge(null);
  };
  const onDragOver = (e: React.DragEvent<HTMLLIElement>) => {
    // Only treat as a drop target when a member is being dragged. The MIME
    // is checked via the standardised dataTransfer.types list (works during
    // dragover; the actual data isn't readable until drop).
    if (!e.dataTransfer.types.includes('application/x-member-id')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLLIElement).getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    setDropEdge(e.clientY < midpoint ? 'above' : 'below');
  };
  const onDragLeave = () => {
    setDropEdge(null);
  };
  const onDrop = (e: React.DragEvent<HTMLLIElement>) => {
    const sourceId = e.dataTransfer.getData('application/x-member-id');
    // Snapshot the drop edge BEFORE clearing it — setDropEdge mutates the
    // ref synchronously, so reading it after the clear would always be null.
    const edgeAtDrop = dropEdgeRef.current;
    if (!sourceId || sourceId === member.id) {
      setDropEdge(null);
      return;
    }
    e.preventDefault();
    setDropEdge(null);
    // Find the container that owns this row so we can compute the target
    // index inside its members array.
    const host = findContainerOf(member.id);
    if (!host) return;
    const currentIndex = host.members.findIndex((m) => m.id === member.id);
    if (currentIndex < 0) return;
    const targetIndex = edgeAtDrop === 'above' ? currentIndex : currentIndex + 1;
    try {
      containerService.reorderMember(sourceId, targetIndex);
    } catch (err) {
      console.warn('[ContainerListPanel] reorderMember failed', err);
    }
  };

  return (
    <li
      data-testid={`member-row:${member.id}`}
      onClick={onRowClick}
      onMouseEnter={onRowEnter}
      onMouseLeave={onRowLeave}
      draggable={!containerApproved}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`group relative flex items-center gap-2 pl-2 pr-3 py-1 cursor-pointer transition-colors border-l-2 ${
        isSelected
          ? 'bg-blue-900/30 border-blue-500'
          : isHovered
            ? 'bg-zinc-800/60 border-transparent'
            : 'border-transparent hover:bg-zinc-800/40'
      } ${isDragSource ? 'opacity-[0.35]' : ''}`}
      data-selected={isSelected || undefined}
      data-active={isActive || undefined}
      data-hovered={isHovered || undefined}
      data-drag-source={isDragSource || undefined}
      data-drop-edge={dropEdge ?? undefined}
    >
      {/* Drop-target indicator (spec §4.5): blue 2px line above or below. */}
      {dropEdge === 'above' && (
        <span
          data-testid={`member-drop-indicator:${member.id}`}
          className="pointer-events-none absolute left-0 right-0 top-0 h-0.5 bg-blue-500"
          aria-hidden
        />
      )}
      {dropEdge === 'below' && (
        <span
          data-testid={`member-drop-indicator:${member.id}`}
          className="pointer-events-none absolute left-0 right-0 bottom-0 h-0.5 bg-blue-500"
          aria-hidden
        />
      )}
      {/* Drag handle (spec §4.5). Hidden in approved containers (read-only). */}
      {!containerApproved && (
        <span
          data-testid={`member-drag-handle:${member.id}`}
          className="text-zinc-600 hover:text-zinc-300 cursor-grab active:cursor-grabbing select-none leading-none text-[10px] shrink-0"
          title="Drag to reorder"
          aria-label="drag to reorder"
        >
          ⠿
        </span>
      )}
      <div className="relative shrink-0">
        <button
          type="button"
          data-testid={`member-color:${member.id}`}
          onClick={onColorSwatchClick}
          disabled={containerApproved}
          className={`w-2.5 h-2.5 rounded-sm shrink-0 border transition-shadow ${
            isActive
              ? 'border-amber-300 ring-1 ring-amber-300'
              : 'border-zinc-700 hover:border-zinc-400'
          } ${containerApproved ? 'cursor-not-allowed opacity-60' : ''}`}
          style={{ backgroundColor: rgbCss(member.color) }}
          aria-label={`color ${rgbCss(member.color)} (click to change)`}
          aria-haspopup="dialog"
          aria-expanded={colorPickerOpen || undefined}
          title={containerApproved ? 'Container is approved (color locked)' : 'Click to change color'}
        />
        {colorPickerOpen && (
          <div
            ref={colorPickerRef}
            data-testid={`member-color-picker:${member.id}`}
            role="dialog"
            aria-label="Member color picker"
            className="absolute z-20 left-0 top-4 bg-zinc-900 border border-zinc-700 rounded shadow-lg p-2 w-[124px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="grid grid-cols-4 gap-1">
              {MEMBER_COLOR_PRESETS.map((c, i) => (
                <button
                  key={i}
                  type="button"
                  data-testid={`member-color-preset:${member.id}:${i}`}
                  onClick={() => applyColor(c)}
                  className="w-6 h-6 rounded-sm border border-zinc-700 hover:border-zinc-300"
                  style={{ backgroundColor: rgbCss(c) }}
                  aria-label={`preset color ${rgbCss(c)}`}
                  title={rgbCss(c)}
                />
              ))}
            </div>
            <button
              type="button"
              data-testid={`member-color-custom:${member.id}`}
              onClick={() => customColorInputRef.current?.click()}
              className="mt-2 w-full text-[10px] text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded px-2 py-1 text-left"
            >
              + Custom…
            </button>
            <input
              ref={customColorInputRef}
              type="color"
              onChange={onCustomColorInputChange}
              className="hidden"
              data-testid={`member-color-custom-input:${member.id}`}
              aria-hidden
            />
          </div>
        )}
      </div>
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
          className={`flex-1 text-xs truncate flex items-center gap-1 ${
            isActive ? 'text-amber-200 font-medium' : 'text-zinc-300'
          }`}
          title={member.name}
        >
          <span
            data-testid={`member-name:${member.id}`}
            className="truncate select-none"
            onDoubleClick={(e) => {
              // Double-click on the name → inline rename (spec §4.5).
              // Approved containers are read-only, so the rename
              // affordance is suppressed there.
              if (containerApproved) return;
              e.stopPropagation();
              startRename();
            }}
          >
            {member.name}
          </span>
          {containerKind === 'RTSTRUCT' && !containerApproved ? (
            <RoiTypeSelect member={member} />
          ) : (
            member.roiType && (
              <span
                data-testid={`member-roi-type:${member.id}`}
                className={`text-[8px] uppercase font-mono px-1 rounded shrink-0 ${roiTypeColor(member.roiType)}`}
                title={`ROI type: ${member.roiType}`}
              >
                {member.roiType}
              </span>
            )
          )}
          {member.provenance !== 'manual' && (
            <span
              data-testid={`member-provenance:${member.id}`}
              className="text-[8px] uppercase text-zinc-500 shrink-0"
              title={`Provenance: ${member.provenance}`}
            >
              {provenanceGlyph(member.provenance)}
            </span>
          )}
          {member.interpolationState === 'has-interpolated' && (
            <>
              <span
                data-testid={`member-auto-interpolated:${member.id}`}
                className="text-[8px] uppercase font-mono text-cyan-400 shrink-0"
                title="Has auto-interpolated contours pending acceptance (B5)"
                aria-label="has interpolated contours"
              >
                AI
              </span>
              <button
                type="button"
                data-testid={`member-step-through:${member.id}`}
                className="text-[10px] leading-none text-cyan-400 hover:text-cyan-200 shrink-0 px-1 rounded border border-cyan-700/40 hover:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400"
                title="Step through interpolated slices (B5)"
                aria-label="step through interpolated slices"
                onClick={(e) => {
                  e.stopPropagation();
                  containerActions.stepThroughInterpolated(member.id);
                }}
              >
                ▶
              </button>
            </>
          )}
          {eligibility && eligibility !== 'native' && (
            <span
              data-testid={`member-eligibility:${member.id}`}
              data-eligibility={eligibility}
              className={`text-[8px] uppercase font-mono shrink-0 px-1 rounded ${eligibilityBadgeColor(eligibility)}`}
              title={eligibilityTooltip(eligibility)}
              aria-label={`eligibility ${eligibility}`}
            >
              {eligibilityLabel(eligibility)}
            </span>
          )}
        </span>
      )}
      <button
        type="button"
        data-testid={`member-visibility:${member.id}`}
        className="text-[10px] text-zinc-500 hover:text-zinc-200 transition-colors px-0.5"
        title={`Visibility: ${member.visibility} (click to cycle, shift-click to solo, alt-click to hide on active viewport only)`}
        aria-label={`visibility ${member.visibility}`}
        onClick={(e) => {
          e.stopPropagation();
          // Shift+click: solo (spec §4.5). Hide every other member in
          // this container; ensure this one is visible.
          if (e.shiftKey) {
            const host = findContainerOf(member.id);
            if (host) {
              for (const m of host.members) {
                if (m.id === member.id) {
                  if (m.visibility === 'hidden') {
                    containerService.setMemberVisibility(m.id, 'filled');
                  }
                } else if (m.visibility !== 'hidden') {
                  containerService.setMemberVisibility(m.id, 'hidden');
                }
              }
            }
            return;
          }
          // Alt+click: per-viewport hide on the active viewport only (§A5,
          // signal G5). Lives in Cornerstone's per-viewport representation
          // state so closing+reopening the panel restores the global default.
          if (e.altKey) {
            const activeViewport = useViewerStore.getState().activeViewportId;
            if (activeViewport) {
              containerService.setMemberVisibilityOnViewport(member.id, activeViewport, false);
            }
            return;
          }
          containerService.setMemberVisibility(member.id, nextVisibilityMode(member.visibility));
        }}
      >
        {visibilityGlyph(member.visibility)}
      </button>
      {containerApproved ? (
        member.locked && (
          <span
            data-testid={`member-locked:${member.id}`}
            className="text-[10px] text-amber-500"
            title="Locked (container approved)"
            aria-label="locked"
          >
            🔒
          </span>
        )
      ) : (
        <button
          type="button"
          data-testid={
            member.locked ? `member-locked:${member.id}` : `member-lock-toggle:${member.id}`
          }
          aria-pressed={member.locked}
          aria-label={member.locked ? 'unlock member' : 'lock member'}
          title={
            member.locked
              ? 'Locked from edits (C5). Click to unlock.'
              : 'Click to lock from edits (C5).'
          }
          onClick={(e) => {
            e.stopPropagation();
            try {
              containerService.setMemberLock(member.id, !member.locked);
            } catch (err) {
              console.warn('[ContainerListPanel] setMemberLock failed', err);
            }
          }}
          className={`text-[10px] transition-colors px-0.5 ${
            member.locked
              ? 'text-amber-500 hover:text-amber-300'
              : 'text-zinc-600 hover:text-zinc-300 opacity-0 group-hover:opacity-100'
          }`}
        >
          {member.locked ? '🔒' : '🔓'}
        </button>
      )}
      <div ref={menuRef} className="relative">
        {!containerApproved && (
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
        )}
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

/**
 * Inline ROI-type editor for RTSTRUCT members (D7.2). Rendered as a
 * minimal <select> element styled to match the static badge. Empty
 * value = "no type" placeholder.
 */
function RoiTypeSelect({ member }: { member: Member }) {
  const value = member.roiType ?? '';
  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    e.stopPropagation();
    const next = e.target.value as Member['roiType'];
    if (!next) return;
    try {
      containerService.setRoiType(member.id, next as NonNullable<Member['roiType']>);
    } catch (err) {
      console.warn('[ContainerListPanel] setRoiType failed', err);
    }
  };
  return (
    <select
      data-testid={`member-roi-type-select:${member.id}`}
      value={value}
      onClick={(e) => e.stopPropagation()}
      onChange={onChange}
      className={`text-[8px] uppercase font-mono shrink-0 outline-none rounded border-0 ${
        member.roiType ? roiTypeColor(member.roiType) : 'bg-zinc-800 text-zinc-500'
      } px-0.5`}
      aria-label="ROI type"
      title={member.roiType ? `ROI type: ${member.roiType}` : 'Set ROI type'}
    >
      <option value="" disabled hidden>
        —
      </option>
      {ROI_TYPE_OPTIONS.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );
}

const ROI_TYPE_OPTIONS: Array<NonNullable<Member['roiType']>> = [
  'GTV',
  'CTV',
  'PTV',
  'ORGAN',
  'EXTERNAL',
  'SUPPORT',
  'FIXATION',
  'CAVITY',
  'BOLUS',
  'AVOIDANCE',
  'CONTROL',
  'DOSE_REGION',
  'MARKER',
  'REGISTRATION',
  'ISOCENTER',
  'CONTRAST_AGENT',
  'TREATED_VOLUME',
  'IRRAD_VOLUME',
  'BRACHY_CHANNEL',
  'BRACHY_ACCESSORY',
  'BRACHY_SRC_APP',
  'BRACHY_CHNL_SHLD',
];

// ─── Helpers ──────────────────────────────────────────────────────

function rgbCss(color: RGB): string {
  return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}

/**
 * Look up the container that owns a given memberId. Snapshots the
 * containerStore at call time — caller is in an event handler, so a
 * fresh snapshot is what we want.
 */
function findContainerOf(memberId: string): Container | null {
  for (const c of useContainerStore.getState().containers.values()) {
    if (c.members.some((m) => m.id === memberId)) return c;
  }
  return null;
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

/**
 * Per-DICOM-RTROIInterpretedType color hint. The radiotherapy GTV/CTV/PTV
 * triad gets warm tones (treatment volumes); ORGAN/EXTERNAL gets cool tones
 * (anatomic structures); AVOIDANCE gets red (organ at risk); everything
 * else falls back to neutral zinc.
 */
function roiTypeColor(roiType: NonNullable<Member['roiType']>): string {
  switch (roiType) {
    case 'GTV':
      return 'bg-rose-900/50 text-rose-200';
    case 'CTV':
      return 'bg-orange-900/50 text-orange-200';
    case 'PTV':
      return 'bg-amber-900/50 text-amber-200';
    case 'ORGAN':
      return 'bg-emerald-900/50 text-emerald-200';
    case 'EXTERNAL':
      return 'bg-blue-900/50 text-blue-200';
    case 'AVOIDANCE':
      return 'bg-red-900/60 text-red-200';
    case 'MARKER':
    case 'ISOCENTER':
      return 'bg-purple-900/50 text-purple-200';
    default:
      return 'bg-zinc-800 text-zinc-400';
  }
}

/**
 * Classify a member against the active viewport's source identity.
 * RTSTRUCT members route through `classifyAnnotationOnViewport` (using
 * the first attached annotation as a representative); SEG/POI members
 * route through `classifySegmentationOnViewport`. Returns null when the
 * adapter has no data — typical in tests where Cornerstone metadata is
 * not wired, and at runtime before the first image loads.
 */
function classifyMemberOnViewport(
  member: Member,
  containerKind: Container['kind'],
  viewportId: string | null,
): EligibilityClass | null {
  if (!viewportId) return null;
  if (containerKind === 'RTSTRUCT' && member.csAnnotationUIDs && member.csAnnotationUIDs.length > 0) {
    return classifyAnnotationOnViewport(member.csAnnotationUIDs[0], viewportId);
  }
  if (member.csSegmentationId) {
    return classifySegmentationOnViewport(member.csSegmentationId, viewportId);
  }
  return null;
}

function eligibilityLabel(e: Exclude<EligibilityClass, 'native'>): string {
  switch (e) {
    case 'cross-series-A2b':
      return 'X-S';
    case 'cross-series-A2c':
      return 'A2c';
    case 'cross-FoR':
      return 'FoR';
  }
}

function eligibilityBadgeColor(e: Exclude<EligibilityClass, 'native'>): string {
  switch (e) {
    case 'cross-series-A2b':
      return 'bg-blue-900/50 text-blue-200';
    case 'cross-series-A2c':
      return 'bg-orange-900/50 text-orange-200';
    case 'cross-FoR':
      return 'bg-red-900/60 text-red-200';
  }
}

function eligibilityTooltip(e: Exclude<EligibilityClass, 'native'>): string {
  switch (e) {
    case 'cross-series-A2b':
      return 'Cross-series render (§A2b) — different series, same FoR. Renders by default.';
    case 'cross-series-A2c':
      return 'Cross-series render (§A2c) — different acquisition. Off by default; opt in via the A2c toggle.';
    case 'cross-FoR':
      return 'Different Frame of Reference (§A2d) — not renderable without an SRO.';
  }
}

/**
 * Provenance glyph per §D7.2. Manual is the default and not rendered;
 * the others get distinct single-character markers.
 */
function provenanceGlyph(provenance: Member['provenance']): string {
  switch (provenance) {
    case 'interpolated':
      return '~';
    case 'imported':
      return '↓';
    case 'auto-segmented':
      return 'AI';
    case 'algebra':
      return 'ƒ';
    case 'deformably-mapped':
      return 'def';
    case 'manual':
    default:
      return '';
  }
}
