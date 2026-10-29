/**
 * The Annotations panel's actions, outside React (extension framework X4 —
 * docs/extension-framework.md, R7): activate a member, create a container, add / rename / colour
 * members, save. The panel (useAnnotationsPanel) and the extension API (ext.annotations) both
 * call these, so an extension acts under exactly the panel's rules — an approved container is
 * edit-locked for both, a create starts the same way, a save is the same save.
 *
 * Lives beside the hooks because it needs both the tool catalog (components) and the services:
 * the extension host reaches it through the component layer (installExtensionHost).
 */
import type { ContainerKind } from '@shared/types/annotation';
import { ToolName } from '@shared/types/viewer';
import { useAnnotationSelectionStore } from '../stores/annotationSelectionStore';
import { useAnnotationStore } from '../stores/annotationStore';
import { useApprovalStore } from '../stores/approvalStore';
import { useSegmentationStore } from '../stores/segmentationStore';
import { useTransportStore } from '../stores/transportStore';
import { useViewerStore } from '../stores/viewerStore';
import { segmentationService } from '../lib/cornerstone/segmentationService';
import { unifiedToolService } from '../lib/cornerstone/unifiedToolService';
import { annotationService } from '../lib/cornerstone/annotationService';
import { segmentationManager } from '../lib/segmentation/segmentationManagerSingleton';
import { currentContainers } from '../lib/annotations/currentContainers';
import { TOOLNAME_TO_CATALOG, toolsForKind } from '../components/annotations/toolCatalog';

/** The tool a kind activates by default when its container becomes active and the
 *  current tool doesn't belong to that kind — so drawing produces the active
 *  container's annotation type (SEG → brush, RTSTRUCT → freehand contour, SR → length).
 *  Each is a registered/supported tool on the unified group. */
export const DEFAULT_TOOL_BY_KIND: Record<ContainerKind, ToolName> = {
  SEG: ToolName.Brush,
  RTSTRUCT: ToolName.FreehandContour,
  SR: ToolName.Length,
};

/** Make the active tool one of `kind`'s, unless it already is. */
export function ensureToolForKind(kind: ContainerKind): void {
  const activeTool = useViewerStore.getState().activeTool;
  const currentCatalogId = activeTool ? TOOLNAME_TO_CATALOG[activeTool] : undefined;
  const validIds = new Set(toolsForKind(kind).map((t) => t.id));
  if (currentCatalogId && validIds.has(currentCatalogId)) return; // current tool already fits
  const next = DEFAULT_TOOL_BY_KIND[kind];
  if (unifiedToolService.isToolSupported(next)) useViewerStore.getState().setActiveTool(next);
}

/**
 * Make a member active — the draw target — and mirror it into the legacy active state so
 * drawing targets it. `kindHint` is needed for a JUST-CREATED container, which the projection
 * may not list yet.
 */
export function activateMember(containerId: string, memberId: string, kindHint?: ContainerKind): void {
  useAnnotationSelectionStore.getState().activate(containerId, memberId);
  const kind = kindHint ?? currentContainers().find((c) => c.id === containerId)?.kind;
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
}

/** D7.11: an approved container is edit-locked until its approval is revoked. */
export function isApproved(containerId: string): boolean {
  return useApprovalStore.getState().isApproved(containerId);
}

function refuseIfApproved(containerId: string, action: string): boolean {
  if (!isApproved(containerId)) return false;
  console.warn(`[annotationActions] ${action} blocked — ${containerId} is approved (revoke to edit).`);
  return true;
}

/**
 * Create a container on `viewportId`, as the panel's create button does: a SEG with Segment 1,
 * a Structure with ROI 1, or an empty Measurement set stamped with the session. Returns its id.
 */
export async function createContainer(kind: ContainerKind, viewportId: string, sourceImageIds: string[]): Promise<string> {
  if (kind === 'SR') {
    return useAnnotationStore.getState().createSrContainer('Measurement', useViewerStore.getState().sessionId ?? undefined);
  }
  if (kind === 'RTSTRUCT') {
    const id = await segmentationManager.createNewStructure(viewportId, sourceImageIds);
    await segmentationManager.addSegment(id, 'ROI 1'); // D7.6 — create starts with a member
    return id;
  }
  // SEG with a default Segment 1 (createDefaultSegment) so the container is drawable immediately.
  return segmentationManager.createNewSegmentation(viewportId, sourceImageIds, undefined, true);
}

/** Add a member (SEG / RTSTRUCT); returns its index, or null when refused. */
export async function addMember(containerId: string, label?: string): Promise<number | null> {
  if (refuseIfApproved(containerId, 'add member')) return null;
  const container = currentContainers().find((c) => c.id === containerId);
  // Measurements are drawn, not added.
  if (container?.kind === 'SR' || containerId.startsWith('sr:')) return null;
  const defaultLabel = `${container?.kind === 'RTSTRUCT' ? 'ROI' : 'Segment'} ${(container?.members.length ?? 0) + 1}`;
  return segmentationManager.addSegment(containerId, label ?? defaultLabel);
}

/** Rename a container; false when refused. */
export function renameContainer(containerId: string, name: string): boolean {
  if (refuseIfApproved(containerId, 'rename container')) return false;
  if (containerId.startsWith('sr:')) useAnnotationStore.getState().renameSrContainer(containerId, name);
  else segmentationManager.renameSegmentation(containerId, name);
  return true;
}

/** Rename a member; false when refused. */
export function renameMember(containerId: string, memberId: string, name: string): boolean {
  if (refuseIfApproved(containerId, 'rename member')) return false;
  if (containerId.startsWith('sr:')) { annotationService.setAnnotationLabel(memberId, name); return true; }
  const idx = Number(memberId);
  if (!Number.isInteger(idx) || idx <= 0) return false;
  segmentationManager.renameSegment(containerId, idx, name);
  return true;
}

/** Set a member's colour (RGBA 0–255); false when refused. */
export function setMemberColor(containerId: string, memberId: string, color: [number, number, number, number]): boolean {
  if (refuseIfApproved(containerId, 'change member color')) return false;
  // SR measurement members are keyed by annotationUID — set the Cornerstone
  // annotation's display color directly (the numeric-index SEG path NaNs on a UID).
  if (containerId.startsWith('sr:')) { annotationService.setAnnotationColor(memberId, color); return true; }
  const idx = Number(memberId);
  if (!Number.isInteger(idx) || idx <= 0) return false;
  // userChangedSegmentColor updates Cornerstone AND persists to the presentation
  // cache (so the projection's member.color reflects it + it survives reload).
  segmentationManager.userChangedSegmentColor(containerId, idx, color);
  return true;
}

export type SaveResult = { outcome: 'saved' | 'conflict' | 'failed'; reason?: string; versionToken?: string };

/**
 * Save a container now: the panel's per-container save — the injected XNAT transport, with its
 * conflict detection. An approved container is refused, as the panel's save button is.
 */
export async function saveContainer(containerId: string): Promise<SaveResult> {
  if (!currentContainers().some((c) => c.id === containerId)) return { outcome: 'failed', reason: `No annotation ${containerId}` };
  if (isApproved(containerId)) return { outcome: 'failed', reason: 'The annotation is approved: revoke its approval to edit or save it' };
  await segmentationService.flushContainerSave(containerId);
  const entry = useTransportStore.getState().entries[containerId];
  if (entry?.phase === 'error') {
    return { outcome: entry.errorKind === 'conflict' ? 'conflict' : 'failed', reason: entry.error, versionToken: entry.versionToken };
  }
  return { outcome: 'saved', versionToken: entry?.versionToken };
}

/** The version token of the container's last save or load (save-conflict detection), if any. */
export function versionToken(containerId: string): string | undefined {
  return useTransportStore.getState().entries[containerId]?.versionToken;
}
