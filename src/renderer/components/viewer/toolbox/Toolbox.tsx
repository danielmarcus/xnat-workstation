/**
 * Toolbox — context-sensitive tool grid pinned above the autosave row.
 * Spec §4.8.
 *
 * Renders three states based on what the active container is and
 * where it lives:
 *  - No active container             → empty-state copy.
 *  - Active member locked            → amber locked banner, tools hidden.
 *  - Active container off this panel → amber off-panel banner, tools hidden.
 *  - Otherwise                       → header chip + 3-col grid +
 *                                      `ToolboxControls` (§4.8.4).
 *
 * Pure subscription-based component. Reads active container/member
 * from the containerStore + selection store; active tool + active
 * viewport from viewerStore; preferences for the controls section
 * are read inside `ToolboxControls`.
 *
 * Tool activation goes through `useViewerStore.setActiveTool` so the
 * existing `toolService` wiring takes over (cursor, brush size, etc).
 */
import { useMemo } from 'react';
import { useViewerStore } from '../../../stores/viewerStore';
import { useContainerStore } from '../../../stores/containerStore';
import { useContainerSelectionStore } from '../../../stores/containerSelectionStore';
import type { ToolName } from '@shared/types/viewer';
import type { Container, Member } from '../../../types/annotation';
import {
  catalogFor,
  controlsFamilyForTool,
  toolboxKindForContainerKind,
  type ToolboxEntry,
} from './toolboxCatalog';
import ToolboxControls from './ToolboxControls';
import {
  ANNOTATION_PANEL_COMPACT_TOOLS_WIDTH,
} from '@shared/types/preferences';
import { usePreferencesStore } from '../../../stores/preferencesStore';

export interface ToolboxProps {
  /**
   * Panel width in px (drives the compact-tools threshold per spec §4.1).
   * Optional — if omitted, the toolbox reads it from preferences.
   */
  panelWidth?: number;
  /**
   * Optional viewport→container mapping. When provided, the toolbox
   * uses the returned list to decide whether the active container
   * is on the active viewport (and renders the off-panel banner if
   * not). Defaults to `() => [activeViewport]` — i.e. assume the
   * container is on whatever viewport is currently active. Wiring
   * to a real Frame-of-Reference resolver lands with #87.
   */
  getContainerPanelIds?: (containerId: string) => string[];
}

export default function Toolbox({ panelWidth, getContainerPanelIds }: ToolboxProps) {
  const containers = useContainerStore((s) => s.containers);
  const activeMemberId = useContainerSelectionStore((s) => s.activeMemberId);
  const activeViewportId = useViewerStore((s) => s.activeViewportId);
  const activeTool = useViewerStore((s) => s.activeTool);
  const setActiveTool = useViewerStore((s) => s.setActiveTool);
  const persistedWidth = usePreferencesStore((s) => s.preferences.annotationPanel.width);
  const width = panelWidth ?? persistedWidth;
  const compactTools = width < ANNOTATION_PANEL_COMPACT_TOOLS_WIDTH;

  // Find the active member + its container (the active member is
  // the canonical anchor for which toolbox to show).
  const { container: activeContainer, member: activeMember } = useMemo(
    () => findActive(containers, activeMemberId),
    [containers, activeMemberId],
  );

  // Empty state: no active container/member → tools hidden.
  if (!activeContainer || !activeMember) {
    return (
      <section
        data-testid="toolbox"
        data-state="empty"
        className="border-t border-zinc-800 px-3 py-3 text-[11px] text-zinc-500"
      >
        Select or create an annotation above to enable tools.
      </section>
    );
  }

  // Locked-member state — amber banner, tools hidden.
  if (activeMember.locked) {
    return (
      <section
        data-testid="toolbox"
        data-state="locked"
        className="border-t border-zinc-800 px-3 py-3 text-[11px]"
      >
        <p className="rounded border border-amber-700/50 bg-amber-900/20 text-amber-200 px-2 py-1.5">
          🔒 Active {activeMember.name} is locked. Unlock to edit.
        </p>
      </section>
    );
  }

  // Off-panel state — active container isn't attached to the active
  // viewport. The caller (the panel) supplies the resolver; when
  // omitted we assume the container is on the active viewport, which
  // matches single-viewport mode.
  const containerPanels = getContainerPanelIds
    ? getContainerPanelIds(activeContainer.id)
    : [activeViewportId];
  const onActivePanel = containerPanels.length === 0
    ? true // unconstrained — assume edits land
    : containerPanels.includes(activeViewportId);
  if (!onActivePanel) {
    const panelList = containerPanels.join(', ');
    return (
      <section
        data-testid="toolbox"
        data-state="off-panel"
        className="border-t border-zinc-800 px-3 py-3 text-[11px]"
      >
        <p className="rounded border border-amber-700/50 bg-amber-900/20 text-amber-200 px-2 py-1.5">
          ⚠ Active annotation isn&rsquo;t on this panel. Switch to {panelList} to edit,
          or pick a different annotation.
        </p>
      </section>
    );
  }

  const kind = toolboxKindForContainerKind(activeContainer.kind);
  const catalog = catalogFor(kind);
  const typeLabel = TYPE_LABEL[kind];
  const family = controlsFamilyForTool(activeTool);
  // "Editing across N panes" pill — appears when the active
  // container is attached to >1 viewport (spec §4.8.1, §5.8).
  const panelCount = containerPanels.length;
  const showMultiPanelPill = panelCount > 1;

  return (
    <section
      data-testid="toolbox"
      data-state="active"
      data-toolbox-kind={kind}
      className="border-t border-zinc-800 flex flex-col"
    >
      <div className="px-3 py-1.5 flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-zinc-500">
        <span>Toolbox</span>
        <div className="flex items-center gap-1.5 normal-case text-zinc-400">
          {showMultiPanelPill && (
            <span
              data-testid="toolbox-multi-panel-pill"
              className="text-[10px] px-1.5 py-[1px] rounded bg-blue-900/30 border border-blue-800/40 text-blue-200"
              title={`Edits propagate to ${panelCount} viewports`}
            >
              Editing across {panelCount} panes
            </span>
          )}
          <span className="text-zinc-300 text-[11px]">
            {typeLabel} · <span className="truncate inline-block max-w-[140px] align-middle">{activeContainer.name}</span>
          </span>
        </div>
      </div>

      <div
        data-testid="toolbox-grid"
        data-compact-tools={compactTools || undefined}
        className="grid grid-cols-3 gap-1 px-2 pb-2"
      >
        {catalog.map((entry) => (
          <ToolboxButton
            key={entry.id}
            entry={entry}
            compact={compactTools}
            active={entry.tool !== null && entry.tool === activeTool}
            onActivate={(tool) => setActiveTool(tool)}
          />
        ))}
      </div>

      <ToolboxControls
        family={family}
        activeMemberName={activeMember.name}
        activeMemberColor={activeMember.color ?? null}
      />
    </section>
  );
}

function ToolboxButton({
  entry,
  compact,
  active,
  onActivate,
}: {
  entry: ToolboxEntry;
  compact: boolean;
  active: boolean;
  onActivate: (tool: ToolName) => void;
}) {
  const disabled = !entry.wired;
  const title = entry.wired
    ? entry.fullName
    : `${entry.fullName} *`;
  return (
    <button
      type="button"
      data-testid={`toolbox-btn:${entry.id}`}
      data-wired={entry.wired || undefined}
      data-active={active || undefined}
      onClick={() => {
        if (!entry.wired || entry.tool === null) return;
        onActivate(entry.tool);
      }}
      title={title}
      aria-label={entry.fullName}
      aria-pressed={active}
      disabled={disabled}
      className={[
        'h-[26px] px-1.5 text-[10px] flex items-center justify-center gap-1 rounded border transition-colors truncate',
        entry.wired
          ? active
            ? 'border-blue-500 bg-blue-900/30 text-blue-100'
            : 'border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 hover:border-zinc-600'
          : 'border-dashed border-zinc-700 text-zinc-500 cursor-not-allowed',
      ].join(' ')}
    >
      {!compact && <span className="truncate">{entry.label}</span>}
      {compact && <span className="sr-only">{entry.label}</span>}
    </button>
  );
}

const TYPE_LABEL: Record<'SEG' | 'STRUCT' | 'MEAS', string> = {
  SEG: 'Segmentation',
  STRUCT: 'Structure',
  MEAS: 'Measurement',
};

// ─── Helpers ─────────────────────────────────────────────────────

function findActive(
  containers: ReadonlyMap<string, Container>,
  memberId: string | null,
): { container: Container | null; member: Member | null } {
  if (!memberId) return { container: null, member: null };
  for (const c of containers.values()) {
    const m = c.members.find((mm) => mm.id === memberId);
    if (m) return { container: c, member: m };
  }
  return { container: null, member: null };
}
