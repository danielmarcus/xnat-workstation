/**
 * The rules that keep the image selection inside the active member, on the current slice
 * (unified selection — docs/unified-selection.md).
 *
 * The selection is Cornerstone's annotation selection (what Ctrl+C / delete act on, and
 * what is drawn in the selected style). Two things invalidate it:
 *  - Changing slice: the selection is the current slice's, so leaving the slice clears
 *    it — nothing you cannot see is ever copied or deleted.
 *  - Changing the active member: a selection lives inside the active member, so anything
 *    selected that is not part of the new active member is dropped.
 */
import { annotation as csAnnotation } from '@cornerstonejs/tools';
import { useViewerStore } from '../../stores/viewerStore';
import { useAnnotationSelectionStore, type MemberRef } from '../../stores/annotationSelectionStore';

interface SelectableAnnotation {
  data?: { segmentation?: { segmentationId?: string; segmentIndex?: number } };
}

/** Whether an annotation is part of a member: a contour of its segment, or (for a
 *  Measurement, whose member id IS its annotation UID) the measurement itself. */
function belongsTo(uid: string, member: MemberRef): boolean {
  const seg = (csAnnotation.state.getAnnotation(uid) as SelectableAnnotation | undefined)?.data?.segmentation;
  if (seg?.segmentationId) {
    return seg.segmentationId === member.containerId && String(seg.segmentIndex) === member.memberId;
  }
  return uid === member.memberId;
}

/** Keep only the selected annotations that pass `keep` (no event if nothing changes). */
function retainSelected(keep: (uid: string) => boolean): void {
  const selected = csAnnotation.selection.getAnnotationsSelected() ?? [];
  const kept = selected.filter((uid) => !!csAnnotation.state.getAnnotation(uid) && keep(uid));
  if (kept.length === selected.length) return;
  csAnnotation.selection.deselectAnnotation(); // clears the set (tolerates removed annotations)
  kept.forEach((uid, i) => csAnnotation.selection.setAnnotationSelected(uid, true, i > 0));
}

let installed = false;

/** Install once, at init. */
export function installComponentSelection(): void {
  if (installed) return;
  installed = true;

  useViewerStore.subscribe((state, prev) => {
    const vp = state.activeViewportId;
    if (vp !== prev.activeViewportId) return;
    if (state.viewports[vp]?.imageIndex !== prev.viewports[vp]?.imageIndex) retainSelected(() => false);
  });

  useAnnotationSelectionStore.subscribe((state, prev) => {
    const member = state.activeMember;
    if (member === prev.activeMember) return;
    retainSelected((uid) => !!member && belongsTo(uid, member));
  });
}
