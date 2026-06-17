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
import { ToolName } from '@shared/types/viewer';
import { useSegmentationStore } from '../stores/segmentationStore';
import { useSegmentationManagerStore } from '../stores/segmentationManagerStore';
import { useAnnotationStore } from '../stores/annotationStore';
import { useAnnotationSelectionStore } from '../stores/annotationSelectionStore';
import { useViewerStore } from '../stores/viewerStore';
import { useTransportStore } from '../stores/transportStore';
import { usePreferencesStore } from '../stores/preferencesStore';
import { segmentationService } from '../lib/cornerstone/segmentationService';
import { annotationService } from '../lib/cornerstone/annotationService';
import { rtStructService } from '../lib/cornerstone/rtStructService';
import { segmentProvenance } from '../lib/cornerstone/interpolationAcceptance';
import { getAnnotationUIDs } from '../lib/cornerstone/contourRepresentation';
import { unifiedToolService } from '../lib/cornerstone/unifiedToolService';
import { segmentationManager } from '../lib/segmentation/segmentationManagerSingleton';
import { projectContainers } from '../lib/annotations/containerProjection';
import { buildContainerCsv, type MemberStats } from '../lib/annotations/containerCsv';
import { CATALOG_TO_TOOLNAME, TOOLNAME_TO_CATALOG, toolsForKind } from '../components/annotations/toolCatalog';
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

/** The tool a kind activates by default when its container becomes active and the
 *  current tool doesn't belong to that kind — so drawing produces the active
 *  container's annotation type (SEG → brush, RTSTRUCT → freehand contour, SR → length).
 *  Each is a registered/supported tool on the unified group. */
const DEFAULT_TOOL_BY_KIND: Record<ContainerKind, ToolName> = {
  SEG: ToolName.Brush,
  RTSTRUCT: ToolName.FreehandContour,
  SR: ToolName.Length,
};

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
  // SEG controls strip: labelmap opacity (global style) + brush radius. Opacity lives
  // in the store; brush size has no service getter, so track it locally (the slider is
  // the only brush-size control).
  const fillAlpha = useSegmentationStore((s) => s.fillAlpha);
  const renderOutline = useSegmentationStore((s) => s.renderOutline);
  const setFillAlpha = useSegmentationStore((s) => s.setFillAlpha);
  const [brushSize, setBrushSize] = useState(
    () => usePreferencesStore.getState().preferences.annotation.defaultBrushSize,
  );

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

  // Switch the active tool to the kind's default when the current tool doesn't belong
  // to that kind — so moving between annotation types switches the drawing tool to
  // match (a measurement tool stays selected across SR containers, but moving to a SEG
  // container swaps to the brush, etc.).
  const ensureToolForKind = (kind: ContainerKind) => {
    const currentCatalogId = activeTool ? TOOLNAME_TO_CATALOG[activeTool] : undefined;
    const validIds = new Set(toolsForKind(kind).map((t) => t.id));
    if (currentCatalogId && validIds.has(currentCatalogId)) return; // current tool already fits
    const next = DEFAULT_TOOL_BY_KIND[kind];
    if (unifiedToolService.isToolSupported(next)) useViewerStore.getState().setActiveTool(next);
  };

  // ── Bridge: mirror the new active member into the legacy active state so drawing targets it. ──
  // `kindHint` is required when activating a JUST-CREATED container: the projected
  // `containers` list is captured at the last render and does not yet include the new
  // container, so the fallback lookup returns undefined and the drawing tool would never
  // switch (the create's "no tool active → can't draw" bug). Existing-container callers
  // (row/name click) omit it and the lookup resolves normally.
  const activateAndBridge = (containerId: string, memberId: string, kindHint?: ContainerKind) => {
    useAnnotationSelectionStore.getState().activate(containerId, memberId);
    const kind = kindHint ?? containers.find((c) => c.id === containerId)?.kind;
    if (kind) ensureToolForKind(kind);
    if (containerId.startsWith('sr:')) {
      // Activating an SR container routes subsequently-drawn measurements into it (D7.1).
      useAnnotationStore.getState().setActiveSrContainer(containerId);
      return;
    }
    const segStore = useSegmentationStore.getState();
    segStore.setActiveSegmentation(containerId);
    const idx = Number(memberId);
    if (Number.isInteger(idx) && idx > 0) {
      // Route CORNERSTONE's active segmentation (the brush target), not just the
      // store. For a multi-layer group this activates the selected segment's sub-seg
      // layer; the store-only setActiveSegmentIndex left the brush painting whichever
      // segmentation Cornerstone last activated (e.g. the most-recently-created one),
      // so selecting one segment but painting into another.
      segmentationService.setActiveSegmentIndex(containerId, idx);
    }
    segmentationService.activateOnViewport(useViewerStore.getState().activeViewportId, containerId);
  };

  const onCreate = (kind: ContainerKind) => {
    if (!canCreate) return;
    if (kind === 'SR') {
      // D7.1: create an empty Measurement (SR) container, make it active (so drawn
      // measurements route into it), and start its name in inline-edit mode. Stamp the
      // current session so the panel scopes it to this study (A13).
      const srId = useAnnotationStore
        .getState()
        .createSrContainer('Measurement', useViewerStore.getState().sessionId ?? undefined);
      useAnnotationSelectionStore.getState().activate(srId, srId);
      ensureToolForKind('SR'); // ready a measurement tool so drawing targets the new set
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
        activateAndBridge(segId, '1', kind); // pass the kind — the new container isn't in `containers` yet
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
      const container = containers.find((c) => c.id === id);
      // Measurement (SR) containers have no "+" affordance (the button isn't rendered):
      // a measurement is authored by drawing with a measurement tool, not by adding an
      // empty member. Defensive no-op in case the handler is invoked for an SR id.
      if (container?.kind === 'SR') return;
      void (async () => {
        try {
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
    onDeleteContainer: (id) => {
      if (id.startsWith('sr:')) {
        // Remove the underlying Cornerstone measurement annotations first (otherwise
        // they linger on the viewport after the panel row is gone), then drop the
        // container entry + its affiliations.
        containers.find((c) => c.id === id)?.members.forEach((m) => annotationService.removeAnnotation(m.id));
        useAnnotationStore.getState().removeSrContainer(id);
      } else {
        segmentationManager.removeSegmentation(id);
      }
    },
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
    onActivateContainer: (cid) => {
      // Clicking a container's name activates it (no specific member): switches the
      // active annotation type (toolbox + drawing tool) and, for SR, makes it the
      // active Measurement container so new measurements route into it.
      const container = containers.find((c) => c.id === cid);
      activateAndBridge(cid, container?.members[0]?.id ?? '');
    },
    onCycleVisibility: (cid, mid) => {
      const container = containers.find((c) => c.id === cid);
      const member = container?.members.find((m) => m.id === mid);
      if (!member) return;
      // SR measurement members are keyed by annotationUID (a string), not a numeric
      // SEG segment index — operate on the Cornerstone annotation directly.
      if (cid.startsWith('sr:')) {
        annotationService.setAnnotationVisibility(mid, !member.visible);
        return;
      }
      const idx = Number(mid);
      if (!Number.isInteger(idx)) return;
      const next = !member.visible;
      segmentationService.setSegmentVisibility(activeViewportId, cid, idx, next);
      // setSegmentVisibility updates Cornerstone but NOT the presentation store the
      // projection reads — persist it so member.visible (and the eye icon) flip both
      // ways instead of sticking at the first toggle.
      useSegmentationManagerStore.getState().setPresentation(cid, idx, { visible: next });
    },
    onToggleLock: (cid, mid) => {
      if (cid.startsWith('sr:')) {
        const member = containers.find((c) => c.id === cid)?.members.find((m) => m.id === mid);
        annotationService.setAnnotationLocked(mid, !(member?.locked ?? false));
        return;
      }
      const idx = Number(mid);
      if (Number.isInteger(idx) && idx > 0) segmentationService.toggleSegmentLocked(cid, idx);
    },
    onDeleteMember: (cid, mid) => {
      if (cid.startsWith('sr:')) { annotationService.removeAnnotation(mid); return; }
      const idx = Number(mid);
      if (Number.isInteger(idx) && idx > 0) segmentationService.removeSegment(cid, idx);
    },
    onRenameMember: (cid, mid, name) => {
      if (cid.startsWith('sr:')) { annotationService.setAnnotationLabel(mid, name); return; }
      const idx = Number(mid);
      if (Number.isInteger(idx) && idx > 0) segmentationManager.renameSegment(cid, idx, name);
    },
    onColorChange: (cid, mid, color) => {
      // SR measurement members are keyed by annotationUID — set the Cornerstone
      // annotation's display color directly (the numeric-index SEG path NaNs on a UID).
      if (cid.startsWith('sr:')) { annotationService.setAnnotationColor(mid, color); return; }
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

  // Provenance badge (signal 22): a contour member is 'interpolated' when any of its
  // contours was stamped by interpolation (interpolationAcceptance). The container id
  // is the Cornerstone segmentationId; the member's segment index is its ROI/segment.
  const provenanceOf = (containerId: string, member: { segmentIndex?: number; roiNumber?: number }) => {
    const idx = member.segmentIndex ?? member.roiNumber;
    return idx == null ? undefined : segmentProvenance(containerId, idx);
  };

  // Empty-member marker (signal 17): a contour (RTSTRUCT) member with no contour
  // geometry yet. Drawing into the active member appends to it (the active-member is
  // the draw target) and this marker clears on the next projection. SEG emptiness is
  // not cheaply derivable here (no per-segment voxel count in the summary) — surfaced
  // only for contour members for now.
  const kindById = new Map(containers.map((c) => [c.id, c.kind]));
  const emptyOf = (containerId: string, member: { segmentIndex?: number; roiNumber?: number }): boolean => {
    if (kindById.get(containerId) !== 'RTSTRUCT') return false;
    const idx = member.segmentIndex ?? member.roiNumber;
    if (idx == null) return false;
    return (getAnnotationUIDs(containerId, idx)?.size ?? 0) === 0;
  };

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
    provenanceOf,
    emptyOf,
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
          // SEG-only controls strip: labelmap opacity + brush radius apply to the
          // labelmap; RTSTRUCT/SR have no equivalent here.
          controls: activeContainer.kind === 'SEG'
            ? {
                activeSegmentLabel: activeMemberObj?.label ?? '',
                activeSegmentColor: rgbaToCss(activeMemberObj?.color),
                opacity: fillAlpha,
                onOpacityChange: (v: number) => {
                  setFillAlpha(v);
                  segmentationService.updateStyle(v, renderOutline);
                },
                brushSize,
                onBrushSizeChange: (v: number) => {
                  setBrushSize(v);
                  unifiedToolService.setBrushSize(v);
                },
              }
            : undefined,
        }
      : null,
  };
}
