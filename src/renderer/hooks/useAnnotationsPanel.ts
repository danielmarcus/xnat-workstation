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
import { useTransportStore } from '../stores/transportStore';
import { usePreferencesStore } from '../stores/preferencesStore';
import { segmentationService } from '../lib/cornerstone/segmentationService';
import { rtStructService } from '../lib/cornerstone/rtStructService';
import { unifiedToolService } from '../lib/cornerstone/unifiedToolService';
import { segmentationManager } from '../lib/segmentation/segmentationManagerSingleton';
import { projectContainers } from '../lib/annotations/containerProjection';
import { buildContainerCsv, type MemberStats } from '../lib/annotations/containerCsv';
import { CATALOG_TO_TOOLNAME, TOOLNAME_TO_CATALOG } from '../components/annotations/toolCatalog';
import type { ContainerListHandlers } from '../components/annotations/ContainerList';
import type { RowTransport } from '../components/annotations/ContainerRow';

function rgbaToCss(color?: [number, number, number, number]): string | undefined {
  if (!color) return undefined;
  return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}

function hexToRgba(hex: string): [number, number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

export function useAnnotationsPanel(activeViewportId: string, sourceImageIds: string[]) {
  const segmentations = useSegmentationStore((s) => s.segmentations);
  const xnatOriginMap = useSegmentationStore((s) => s.xnatOriginMap);
  const hasUnsavedChanges = useSegmentationStore((s) => s.hasUnsavedChanges);
  const presentation = useSegmentationManagerStore((s) => s.presentation);
  const dirtySegIds = useSegmentationManagerStore((s) => s.dirtySegIds);
  const annotations = useAnnotationStore((s) => s.annotations);
  const srContainers = useAnnotationStore((s) => s.srContainers);
  const srAffiliation = useAnnotationStore((s) => s.srAffiliation);
  // Live per-container transport state (saving / conflict / error) surfaced in-place.
  const transportEntries = useTransportStore((s) => s.entries);
  // Settings color sequence → palette swatches offered in the member color picker.
  const colorSequence = usePreferencesStore((s) => s.preferences.annotation.defaultColorSequence);

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
  // H7 conflict resolver: which container's conflict dialog is open (opened from the
  // in-place conflict badge; closes when resolved or cancelled).
  const [conflictDialogId, setConflictDialogId] = useState<string | null>(null);
  // Review & save unsaved annotations dialog (opened from the in-panel indicator).
  const [reviewOpen, setReviewOpen] = useState(false);
  const activeSessionId = useViewerStore((s) => s.sessionId);

  const containers = useMemo(
    () =>
      projectContainers({
        segmentations,
        annotations,
        presentation,
        dirtySegIds,
        xnatOriginMap,
        srContainers,
        srAffiliation,
        activeSessionId: activeSessionId ?? undefined,
        kindOf: (id) => {
          try {
            return segmentationService.getPreferredDicomType(id) as ContainerKind;
          } catch {
            return 'SEG';
          }
        },
      }),
    [segmentations, annotations, presentation, dirtySegIds, xnatOriginMap, srContainers, srAffiliation, activeSessionId],
  );

  const canCreate = sourceImageIds.length > 0;
  const anyDirty = hasUnsavedChanges || Object.values(dirtySegIds).some(Boolean);
  // Unsaved containers (per-container dirty drives the in-panel indicator + review dialog).
  const unsavedContainers = containers.filter((c) => c.dirty);
  const unsavedCount = unsavedContainers.length;

  const activeContainer = activeMember ? containers.find((c) => c.id === activeMember.containerId) : undefined;
  const activeMemberObj = activeContainer?.members.find((m) => m.id === activeMember?.memberId);

  // ── Bridge: mirror the new active member into the legacy active state so drawing targets it. ──
  const activateAndBridge = (containerId: string, memberId: string) => {
    useAnnotationSelectionStore.getState().activate(containerId, memberId);
    if (containerId.startsWith('sr:')) {
      // Activating an SR container routes subsequently-drawn measurements into it (D7.1).
      useAnnotationStore.getState().setActiveSrContainer(containerId);
      return;
    }
    const segStore = useSegmentationStore.getState();
    segStore.setActiveSegmentation(containerId);
    const idx = Number(memberId);
    if (Number.isInteger(idx) && idx > 0) segStore.setActiveSegmentIndex(idx);
  };

  const onCreate = (kind: ContainerKind) => {
    if (!canCreate) return;
    if (kind === 'SR') {
      // D7.1: create an empty Measurement (SR) container, make it active (so drawn
      // measurements route into it), and start its name in inline-edit mode.
      const srId = useAnnotationStore.getState().createSrContainer('Measurement');
      useAnnotationSelectionStore.getState().activate(srId, srId);
      setAutoEditContainerId(srId);
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
    onSaveContainer: (id) => { void segmentationService.flushContainerSave(id); }, // manual save → injected transport
    onResolveConflict: (id) => setConflictDialogId(id), // open the H7 resolver (in-place badge → dialog)
    onKebab: () => {}, // open/close handled in-row (ContainerRow owns the menu state)
    onSetAllVisible: (id, visible) => segmentationManager.setAllMembersVisible(id, visible),
    onSetAllLocked: (id, locked) => segmentationManager.setAllMembersLocked(id, locked),
    onExportContainerDicom: (id) => {
      void (async () => {
        try {
          const container = containers.find((c) => c.id === id);
          const kind = container?.kind ?? segmentationService.getPreferredDicomType(id);
          const name = `${(container?.label || 'annotation').replace(/[^\w.-]+/g, '_')}.dcm`;
          if (kind === 'RTSTRUCT') {
            const base64 = await rtStructService.exportToRtStruct(id);
            await window.electronAPI?.export?.saveDicomRtStruct(base64, name);
          } else {
            const base64 = await segmentationService.exportToDicomSeg(id);
            await window.electronAPI?.export?.saveDicomSeg(base64, name);
          }
        } catch (err) {
          console.error('[annotationsPanel] export to DICOM failed:', err);
        }
      })();
    },
    onExportContainerCsv: (id) => {
      void (async () => {
        try {
          const container = containers.find((c) => c.id === id);
          if (!container) return;
          // Compute per-segment metrics (voxel count / volume / intensity) before
          // building the CSV; best-effort (blank cells if stats are unavailable).
          const indices = container.members
            .map((m) => m.segmentIndex ?? Number(m.id))
            .filter((n) => Number.isInteger(n) && n > 0);
          const byIndex = await segmentationService.getSegmentStatistics(id, indices);
          const byMember: Record<string, MemberStats> = {};
          for (const m of container.members) {
            const idx = m.segmentIndex ?? Number(m.id);
            if (Number.isInteger(idx) && byIndex[idx]) byMember[m.id] = byIndex[idx];
          }
          const name = `${(container.label || 'annotation').replace(/[^\w.-]+/g, '_')}.csv`;
          await window.electronAPI?.export?.saveReport(buildContainerCsv(container, byMember), name);
        } catch (err) {
          console.error('[annotationsPanel] export to CSV failed:', err);
        }
      })();
    },
    onDeleteContainer: (id) =>
      id.startsWith('sr:')
        ? useAnnotationStore.getState().removeSrContainer(id)
        : segmentationManager.removeSegmentation(id),
    onRenameContainer: (id, name) =>
      id.startsWith('sr:')
        ? useAnnotationStore.getState().renameSrContainer(id, name)
        : segmentationManager.renameSegmentation(id, name),
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
    onColorChange: (cid, mid, color) => {
      const idx = Number(mid);
      // userChangedSegmentColor updates Cornerstone AND persists to the presentation
      // cache (so the projection's member.color reflects it + it survives reload).
      if (Number.isInteger(idx) && idx > 0) segmentationManager.userChangedSegmentColor(cid, idx, color);
    },
  };

  // Settings color sequence as an RGBA palette for the member color picker.
  const palette = colorSequence
    .map((hex) => hexToRgba(hex))
    .filter((c): c is [number, number, number, number] => c !== null);

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

  // ── Transport state surfaced in-place on the row + the H7 conflict dialog ──
  const transportOf = (containerId: string): RowTransport | undefined => {
    const e = transportEntries[containerId];
    return e ? { phase: e.phase, errorKind: e.errorKind } : undefined;
  };
  // ── Review & save unsaved annotations (in-panel indicator → dialog) ──
  const saveOne = (id: string) => { void segmentationService.flushContainerSave(id); };
  const saveAllUnsaved = () => unsavedContainers.forEach((c) => { void segmentationService.flushContainerSave(c.id); });
  const transportSavingOf = (id: string) => transportEntries[id]?.phase === 'saving';
  const reviewDialog = reviewOpen
    ? {
        entries: unsavedContainers.map((c) => ({
          containerId: c.id,
          label: c.label,
          isOtherSession: !!c.source.sessionId && c.source.sessionId !== activeSessionId,
          sessionLabel: c.source.sessionId || undefined,
          saving: transportSavingOf(c.id),
        })),
        onSaveOne: saveOne,
        onSaveAll: saveAllUnsaved,
        onClose: () => setReviewOpen(false),
      }
    : null;

  const conflictContainer = conflictDialogId ? containers.find((c) => c.id === conflictDialogId) : undefined;
  const conflictStillActive = conflictDialogId ? transportEntries[conflictDialogId]?.errorKind === 'conflict' : false;
  const conflictDialog =
    conflictDialogId && conflictContainer && conflictStillActive
      ? {
          containerId: conflictDialogId,
          containerLabel: conflictContainer.label,
          onKeepLocal: () => {
            void segmentationService.resolveContainerConflict(conflictDialogId, 'keep-local');
            setConflictDialogId(null);
          },
          onDiscardLocal: () =>
            console.warn('[annotationsPanel] Discard local — reloading the server version needs the live download path (TODO, track D).'),
          onInspect: () =>
            console.warn('[annotationsPanel] Inspect differences — deferred (conflict-UX diff is an open spec question, D3).'),
          onCancel: () => setConflictDialogId(null),
        }
      : null;

  // Measurement value/unit per member (signal 32): SR members carry an annotationUID
  // → the annotation's formatted displayText (e.g. "12.5 mm", "45°").
  const measurementText = new Map(annotations.map((a) => [a.annotationUID, a.displayText]));
  const metricOf = (_containerId: string, member: { annotationUID?: string }): string | undefined =>
    member.annotationUID ? measurementText.get(member.annotationUID) || undefined : undefined;

  return {
    containers,
    containerCount: containers.length,
    canCreate,
    anyDirty,
    onCreate,
    // Unsaved-work surfacing: in-panel indicator count + the review/save dialog.
    unsavedCount,
    onReviewUnsaved: () => setReviewOpen(true),
    reviewDialog,
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
    metricOf,
    palette,
    // transport (in-place row state) + H7 conflict dialog
    transportOf,
    conflictDialog,
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
