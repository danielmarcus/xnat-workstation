/**
 * The one warning every refused edit of a locked member raises — delete, paste, drawing,
 * editing a contour, sculpting, undo/redo. A toast in the viewport area (non-blocking,
 * gone after 3 s, dismissable), never a modal: the user only has to unlock and retry.
 */
import { showToast } from '../../stores/toastStore';
import { useSegmentationStore } from '../../stores/segmentationStore';

/** A member's display name from the panel's segmentation summaries (container + index). */
export function memberLabel(containerId: string | null | undefined, segmentIndex: number | null | undefined): string | null {
  if (!containerId || !segmentIndex) return null;
  const seg = useSegmentationStore.getState().segmentations.find((s) => s.segmentationId === containerId);
  return seg?.segments.find((m) => m.segmentIndex === Number(segmentIndex))?.label ?? null;
}

/** "“ROI 1” is locked — unlock it to edit." (`to` names the refused action.) */
export function warnLocked(label: string | null | undefined, to = 'edit'): void {
  showToast(`${label ? `“${label}”` : 'This item'} is locked — unlock it to ${to}.`, 'warning');
}

export function warnMemberLocked(containerId: string | null | undefined, segmentIndex: number | null | undefined, to = 'edit'): void {
  warnLocked(memberLabel(containerId, segmentIndex), to);
}
