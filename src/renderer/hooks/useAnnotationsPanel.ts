/**
 * useAnnotationsPanel (Rebuild Phase 3, R3.8) — the connected hook that turns the
 * presentational annotation components into a live panel. It projects the unified
 * Container[] from the live stores, derives header/toolbox/selection state, and
 * binds the row/header callbacks to the real services (segmentationManager +
 * segmentationService) and the annotationSelectionStore.
 *
 * Activating a member mirrors into the LEGACY active state
 * (segmentationStore.setActiveSegmentation/Index) so existing drawing tools target
 * it — this is the bridge that makes the new active model drive editing, and the
 * value the Phase-2 gesture block / toolbar undo read (wired in R3.8b).
 *
 * Genuinely-not-built actions are graceful no-ops with a console.warn (marked
 * TODO): approval persistence (D7.11 — transport), SR-container create, save-to-
 * XNAT (transport workstream), and tool-id → Cornerstone routing (R3.8b).
 */
import { useMemo, useState } from 'react';
import type { ContainerKind } from '@shared/types/annotation';
import { useSegmentationStore } from '../stores/segmentationStore';
import { useSegmentationManagerStore } from '../stores/segmentationManagerStore';
import { useAnnotationStore } from '../stores/annotationStore';
import { useAnnotationSelectionStore } from '../stores/annotationSelectionStore';
import { useViewerStore } from '../stores/viewerStore';
import { segmentationService } from '../lib/cornerstone/segmentationService';
import { unifiedToolService } from '../lib/cornerstone/unifiedToolService';
import { segmentationManager } from '../lib/segmentation/segmentationManagerSingleton';
import { projectContainers } from '../lib/annotations/containerProjection';
import { CATALOG_TO_TOOLNAME, TOOLNAME_TO_CATALOG } from '../components/annotations/toolCatalog';
import type { ContainerListHandlers } from '../components/annotations/ContainerList';

function rgbaToCss(color?: [number, number, number, number]): string | undefined {
  if (!color) return undefined;
  return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}

export function useAnnotationsPanel(activeViewportId: string, sourceImageIds: string[]) {
  const segmentations = useSegmentationStore((s) => s.segmentations);
  const xnatOriginMap = useSegmentationStore((s) => s.xnatOriginMap);
  const hasUnsavedChanges = useSegmentationStore((s) => s.hasUnsavedChanges);
  const presentation = useSegmentationManagerStore((s) => s.presentation);
  const dirtySegIds = useSegmentationManagerStore((s) => s.dirtySegIds);
  const annotations = useAnnotationStore((s) => s.annotations);

  const activeMember = useAnnotationSelectionStore((s) => s.activeMember);
  const selection = useAnnotationSelectionStore((s) => s.selection);
  // The actually-active Cornerstone tool — the toolbox highlights its catalog id
  // (honest: only tools that really activated show as active).
  const activeTool = useViewerStore((s) => s.activeTool);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Create-in-edit-mode (D7.6): a freshly-created container/member starts in inline
  // rename; cleared once the row consumes it (onEditConsumed).
  const [autoEditContainerId, setAutoEditContainerId] = useState<string | null>(null);
  const [autoEditMemberKey, setAutoEditMemberKey] = useState<string | null>(null);
  // On create, after the container name is accepted, advance to editing its default
  // member's name (two-step create: container → member). Holds the pending member.
  const [createFlow, setCreateFlow] = useState<{ containerId: string; memberKey: string } | null>(null);

  const containers = useMemo(
    () =>
      projectContainers({
        segmentations,
        annotations,
        presentation,
        dirtySegIds,
        xnatOriginMap,
        kindOf: (id) => {
          try {
            return segmentationService.getPreferredDicomType(id) as ContainerKind;
          } catch {
            return 'SEG';
          }
        },
      }),
    [segmentations, annotations, presentation, dirtySegIds, xnatOriginMap],
  );

  const canCreate = sourceImageIds.length > 0;
  const anyDirty = hasUnsavedChanges || Object.values(dirtySegIds).some(Boolean);

  const activeContainer = activeMember ? containers.find((c) => c.id === activeMember.containerId) : undefined;
  const activeMemberObj = activeContainer?.members.find((m) => m.id === activeMember?.memberId);

  // ── Bridge: mirror the new active member into the legacy active state so drawing targets it. ──
  const activateAndBridge = (containerId: string, memberId: string) => {
    useAnnotationSelectionStore.getState().activate(containerId, memberId);
    const segStore = useSegmentationStore.getState();
    segStore.setActiveSegmentation(containerId);
    const idx = Number(memberId);
    if (Number.isInteger(idx) && idx > 0) segStore.setActiveSegmentIndex(idx);
  };

  const onCreate = (kind: ContainerKind) => {
    if (!canCreate) return;
    if (kind === 'SR') {
      console.warn('[annotationsPanel] New Measurement (SR) container — not yet implemented (use a measurement tool).');
      return;
    }
    void (async () => {
      try {
        let segId: string;
        if (kind === 'RTSTRUCT') {
          segId = await segmentationManager.createNewStructure(activeViewportId, sourceImageIds);
          await segmentationManager.addSegment(segId, 'ROI 1'); // D7.6 — create starts with a member
        } else {
          // SEG with a default Segment 1 (createDefaultSegment) so the container is drawable immediately.
          segId = await segmentationManager.createNewSegmentation(activeViewportId, sourceImageIds, undefined, true);
        }
        activateAndBridge(segId, '1');
        setAutoEditContainerId(segId); // create-in-edit-mode (D7.6): edit the container name first…
        setCreateFlow({ containerId: segId, memberKey: `${segId} 1` }); // …then its default member.
      } catch (err) {
        console.error('[annotationsPanel] create failed:', err);
      }
    })();
  };

  const handlers: ContainerListHandlers = {
    onToggleExpand: (id) =>
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    onApproveToggle: () => console.warn('[annotationsPanel] approve/revoke — D7.11 approval persistence is transport-workstream (TODO).'),
    onAddMember: (id) => {
      void (async () => {
        try {
          const container = containers.find((c) => c.id === id);
          const defaultLabel = `${container?.kind === 'RTSTRUCT' ? 'ROI' : 'Segment'} ${(container?.members.length ?? 0) + 1}`;
          const idx = await segmentationManager.addSegment(id, defaultLabel);
          activateAndBridge(id, String(idx));
          setAutoEditMemberKey(`${id} ${idx}`); // create-in-edit-mode (D7.6)
        } catch (err) {
          console.error('[annotationsPanel] add member failed:', err);
        }
      })();
    },
    onSaveContainer: () => console.warn('[annotationsPanel] save-to-XNAT — transport workstream (TODO); local autosave runs in background.'),
    onKebab: () => console.warn('[annotationsPanel] container kebab menu — TODO (hide-all/lock-all/export/revert).'),
    onDeleteContainer: (id) => segmentationManager.removeSegmentation(id),
    onRenameContainer: (id, name) => segmentationManager.renameSegmentation(id, name),
    onContainerEditCommit: (id) => {
      // Two-step create: once the freshly-created container's name is accepted,
      // advance to editing its default member's name (D7.6).
      if (createFlow?.containerId !== id) return;
      setCollapsed((prev) => {
        const next = new Set(prev);
        next.delete(id); // ensure the member row is visible to receive the edit
        return next;
      });
      setAutoEditMemberKey(createFlow.memberKey);
      setCreateFlow(null);
    },
    onSelectMember: (cid, mid, additive) => {
      const sel = useAnnotationSelectionStore.getState();
      if (additive) sel.toggleSelected(cid, mid);
      else sel.selectOnly(cid, mid);
    },
    onActivateMember: (cid, mid) => activateAndBridge(cid, mid),
    onCycleVisibility: (cid, mid) => {
      const idx = Number(mid);
      const container = containers.find((c) => c.id === cid);
      const member = container?.members.find((m) => m.id === mid);
      if (!member || !Number.isInteger(idx)) return;
      const next = !member.visible;
      segmentationService.setSegmentVisibility(activeViewportId, cid, idx, next);
      // setSegmentVisibility updates Cornerstone but NOT the presentation store the
      // projection reads — persist it so member.visible (and the eye icon) flip both
      // ways instead of sticking at the first toggle.
      useSegmentationManagerStore.getState().setPresentation(cid, idx, { visible: next });
    },
    onToggleLock: (cid, mid) => {
      const idx = Number(mid);
      if (Number.isInteger(idx) && idx > 0) segmentationService.toggleSegmentLocked(cid, idx);
    },
    onDeleteMember: (cid, mid) => {
      const idx = Number(mid);
      if (Number.isInteger(idx) && idx > 0) segmentationService.removeSegment(cid, idx);
    },
    onRenameMember: (cid, mid, name) => {
      const idx = Number(mid);
      if (Number.isInteger(idx) && idx > 0) segmentationManager.renameSegment(cid, idx, name);
    },
  };

  const onSelectTool = (toolId: string) => {
    const toolName = CATALOG_TO_TOOLNAME[toolId];
    if (toolName && unifiedToolService.isToolSupported(toolName)) {
      useViewerStore.getState().setActiveTool(toolName); // routes to unifiedToolService + updates activeTool
    } else {
      // Mapped but not yet registered on the unified path (e.g. Eraser, scissors,
      // splines) — registering the full tool set is a follow-on; the toolbox shows
      // it but it can't activate yet.
      console.warn(`[annotationsPanel] tool "${toolId}" is not yet registered on the unified path.`);
    }
  };

  const activeToolId = TOOLNAME_TO_CATALOG[activeTool] ?? null;

  return {
    containers,
    containerCount: containers.length,
    canCreate,
    anyDirty,
    onCreate,
    onSaveAll: () => console.warn('[annotationsPanel] Save all — transport workstream (TODO).'),
    handlers,
    // create-in-edit-mode (D7.6)
    autoEditContainerId,
    autoEditMemberKey,
    onEditConsumed: () => {
      setAutoEditContainerId(null);
      setAutoEditMemberKey(null);
    },
    // selection / expand resolvers
    isExpanded: (id: string) => !collapsed.has(id),
    isActive: (cid: string, mid: string) => activeMember?.containerId === cid && activeMember?.memberId === mid,
    isSelected: (cid: string, mid: string) => selection.some((r) => r.containerId === cid && r.memberId === mid),
    // toolbox
    toolbox: activeContainer
      ? {
          kind: activeContainer.kind,
          activeMemberName: activeMemberObj?.label ?? '',
          activeMemberColor: rgbaToCss(activeMemberObj?.color),
          activeToolId,
          onSelectTool,
        }
      : null,
  };
}
