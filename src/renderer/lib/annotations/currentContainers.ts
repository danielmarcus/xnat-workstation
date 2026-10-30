/**
 * The annotation containers as the Annotations panel lists them, read outside React (extension
 * framework X3: ext.annotations). The same projection, over the same store slices, as
 * useAnnotationsPanel — so an extension sees exactly what the panel shows.
 */
import type { Container, ContainerKind } from '@shared/types/annotation';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { useSegmentationManagerStore } from '../../stores/segmentationManagerStore';
import { useAnnotationStore } from '../../stores/annotationStore';
import { useApprovalStore } from '../../stores/approvalStore';
import { useViewerStore } from '../../stores/viewerStore';
import { segmentationService } from '../cornerstone/segmentationService';
import { projectContainers } from './containerProjection';

/** A container's kind as the panel decides it (shared with useAnnotationsPanel). */
export function containerKindOf(id: string): ContainerKind {
  try {
    return segmentationService.getPreferredDicomType(id) as ContainerKind;
  } catch {
    return 'SEG';
  }
}

export function currentContainers(): Container[] {
  const seg = useSegmentationStore.getState();
  const mgr = useSegmentationManagerStore.getState();
  const ann = useAnnotationStore.getState();
  const approvals = useApprovalStore.getState().approvals;
  return projectContainers({
    segmentations: seg.segmentations,
    annotations: ann.annotations,
    presentation: mgr.presentation,
    dirtySegIds: mgr.dirtySegIds,
    xnatOriginMap: seg.xnatOriginMap,
    srContainers: ann.srContainers,
    srAffiliation: ann.srAffiliation,
    activeSessionId: useViewerStore.getState().sessionId ?? undefined,
    approvalOf: (id) => (approvals[id]?.approved ? 'APPROVED' : 'UNAPPROVED'),
    kindOf: containerKindOf,
  });
}

/** The stores the containers are projected from (for change subscriptions). */
export const CONTAINER_SOURCES = [useSegmentationStore, useSegmentationManagerStore, useAnnotationStore, useApprovalStore] as const;
