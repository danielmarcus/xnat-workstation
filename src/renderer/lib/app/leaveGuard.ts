/**
 * Leave guard (proposal §4.2) — run before a scan load mutates anything.
 *
 * Asks whether the load would leave any container with unsaved edits showing in no
 * viewport at all, and if so blocks on the Save / Discard / Cancel dialog. Cancel aborts
 * the load. Clean orphans are unloaded silently; there is nothing to lose.
 *
 * This replaces `segmentationManager.applySessionSwitch`'s retain-dirty-forever rule.
 * Retention never lost work, but it produced containers listed in the panel while
 * rendering nowhere, identified by a scan-id badge that is blank for exactly this work —
 * it is only populated once saved. The user's summary of it: "impossible to tell which
 * previous image it is associated with".
 *
 * Kept out of App.tsx so the live-state gathering is testable on its own; the pure
 * decision lives in sessionLifecycle.decideOrphans.
 */
import {
  decideOrphans,
  containersNeedingDecision,
  containersToUnload,
  type AttachedContainerRef,
  type PendingViewportLoad,
} from '../annotations/sessionLifecycle';
import { viewportIdsForContainer, isContainerNativeToViewport } from '../cornerstone/unifiedSegService';
import { segmentationService } from '../cornerstone/segmentationService';
import { segmentationManager } from '../segmentation/segmentationManagerSingleton';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { useAnnotationStore } from '../../stores/annotationStore';
import { useSegmentationManagerStore } from '../../stores/segmentationManagerStore';
import { useViewerStore } from '../../stores/viewerStore';
import { requestLeaveDecision } from '../../stores/leavePromptStore';

/**
 * Every loaded container, with the viewports it currently renders on.
 *
 * `replacingViewportId` is the viewport whose images are about to change. It matters for
 * one case: a container Cornerstone reports NO attachment for. That is common — a contour
 * container between representations, a multi-layer group with no painted sub-seg yet — and
 * treating it as "shown nowhere, so not leaving" means a scan switch silently walks over
 * unsaved work. When the attachment is unreadable, the container's own spatial identity
 * decides instead: if it is native to the viewport being replaced, it belongs to the scan
 * on the way out and is leaving with it.
 */
export function attachedContainers(
  replacingViewportId?: string | null,
): (AttachedContainerRef & { label: string })[] {
  const { segmentations, xnatOriginMap } = useSegmentationStore.getState();
  const { srContainers } = useAnnotationStore.getState();
  const { dirtySegIds } = useSegmentationManagerStore.getState();
  const fallbackSessionId =
    useViewerStore.getState().xnatContext?.sessionId ?? useViewerStore.getState().sessionId ?? '';

  const viewportsFor = (containerId: string): string[] => {
    let ids: string[] = [];
    try {
      ids = viewportIdsForContainer(containerId);
    } catch {
      // A Cornerstone read failure must not turn into a spurious prompt; an unknown
      // attachment is treated as "still shown somewhere", the safe direction.
      return ['unknown'];
    }
    if (ids.length > 0 || !replacingViewportId) return ids;
    try {
      // Unreadable attachment: fall back to identity. Native to the viewport being
      // replaced ⇒ it is this scan's annotation and is leaving with it.
      return isContainerNativeToViewport(containerId, replacingViewportId) ? [replacingViewportId] : [];
    } catch {
      return [];
    }
  };

  const fromSegmentations = segmentations.map((seg) => ({
    containerId: seg.segmentationId,
    // A container with no XNAT origin was never saved, so it belongs to whatever session
    // is on screen — the same rule decideSessionLifecycle used.
    sessionId: xnatOriginMap[seg.segmentationId]?.sessionId ?? fallbackSessionId,
    dirty: !!dirtySegIds[seg.segmentationId],
    viewportIds: viewportsFor(seg.segmentationId),
    label: seg.label,
  }));

  // Measurement (SR) containers are not Cornerstone segmentations and live in their own
  // store, so reading `segmentations` alone made them invisible to this guard entirely —
  // a session or scan could be left with unsaved measurements and no prompt at all. They
  // never report a Cornerstone attachment, so identity is the only signal available.
  const fromSr = srContainers.map((c) => ({
    containerId: c.id,
    sessionId: c.sessionId ?? fallbackSessionId,
    dirty: !!dirtySegIds[c.id],
    viewportIds: replacingViewportId ? [replacingViewportId] : [],
    label: c.label,
  }));

  return [...fromSegmentations, ...fromSr];
}

/**
 * Save the given containers and confirm they actually saved.
 *
 * `flushContainerSave` resolves whether or not the upload succeeded — the save queue
 * swallows the failure, marks the container dirty again and surfaces the error through
 * the transport store. So completion is verified by re-reading the dirty flag rather than
 * by the promise resolving, or a failed upload would look like a successful save and the
 * load would proceed over work that was never persisted.
 */
async function saveContainers(containerIds: string[]): Promise<void> {
  await Promise.all(containerIds.map((id) => segmentationService.flushContainerSave(id)));
  const unsaved = containerIds.filter((id) => segmentationService.getContainerSaveState(id).dirty);
  if (unsaved.length > 0) {
    throw new Error(
      unsaved.length === 1
        ? 'Could not save this annotation. Retry, or discard it to continue.'
        : `Could not save ${unsaved.length} annotations. Retry, or discard them to continue.`,
    );
  }
}

export type LeaveGuardOutcome = 'proceed' | 'cancel';

/**
 * @param leavingLabel what the dialog names as being left ("scan 4", a session label).
 * @returns 'cancel' when the user aborted — the caller must return without loading.
 */
export async function guardLoad(
  load: PendingViewportLoad,
  leavingLabel?: string,
): Promise<LeaveGuardOutcome> {
  const containers = attachedContainers(load.viewportId);
  const decisions = decideOrphans({ load, containers });
  const needDecision = new Set(containersNeedingDecision(decisions));

  if (needDecision.size > 0) {
    const choice = await requestLeaveDecision({
      entries: containers
        .filter((c) => needDecision.has(c.containerId))
        .map((c) => ({ containerId: c.containerId, label: c.label })),
      leavingLabel,
      save: saveContainers,
    });
    if (choice === 'cancel') return 'cancel';
  }

  // Unload every orphan — saved, discarded, or clean. Nothing stays loaded that renders
  // in no viewport; re-opening the scan reloads it (transport/scan-click-autoload).
  for (const containerId of containersToUnload(decisions)) {
    try {
      segmentationManager.removeSegmentation(containerId);
    } catch (err) {
      console.warn(`[leaveGuard] could not unload ${containerId}:`, err);
    }
  }
  return 'proceed';
}
