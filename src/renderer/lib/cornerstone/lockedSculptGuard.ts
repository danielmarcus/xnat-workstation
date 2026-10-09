/**
 * The Sculptor never reshapes a locked member's contour — and says so.
 *
 * Cornerstone's SculptorTool grabs the contour CLOSEST to the press, of any ROI. It skips
 * annotations flagged `isLocked` (locking a segment flags its contours), so a press
 * whose only candidates are locked sculpts nothing — silently. The viewport's draw gate
 * cannot see that choice (it hit-tests what is under the pointer), so the guard asks the
 * Sculptor which contour it would take: a locked one (by segment) is refused, and when it
 * would take none because every candidate is locked, the press is refused as well — both
 * with the lock warning.
 * Patching twice is a no-op.
 */
import { annotation as csAnnotation, segmentation as csSegmentation } from '@cornerstonejs/tools';
import { warnMemberLocked } from '../annotations/lockWarning';

const PATCH_FLAG = '__xnatLockedSculptGuard';

interface SculptorLike {
  preMouseDownCallback?: (evt: { detail: unknown }) => unknown;
  getClosestFreehandToolOnElement?: (eventData: unknown) => string | undefined;
  filterSculptableAnnotationsForElement?: (element: unknown) => unknown[] | undefined;
  [PATCH_FLAG]?: boolean;
}

/** The locked member a contour belongs to (locked annotation or locked segment), or null. */
function lockedMemberOf(annotation: unknown): { segmentationId: string; segmentIndex: number } | null {
  const a = annotation as { isLocked?: boolean; isVisible?: boolean; data?: { segmentation?: { segmentationId?: string; segmentIndex?: number } } } | undefined;
  const seg = a?.data?.segmentation;
  const segmentIndex = Number(seg?.segmentIndex);
  if (!a || a.isVisible === false || !seg?.segmentationId || !Number.isInteger(segmentIndex)) return null;
  const locked = !!a.isLocked || csSegmentation.segmentLocking.isSegmentIndexLocked(seg.segmentationId, segmentIndex);
  return locked ? { segmentationId: seg.segmentationId, segmentIndex } : null;
}

export function applyLockedSculptGuard(toolInstance: unknown): void {
  const tool = toolInstance as SculptorLike | null;
  if (!tool || typeof tool.preMouseDownCallback !== 'function' || tool[PATCH_FLAG]) return;
  if (typeof tool.getClosestFreehandToolOnElement !== 'function') return;
  tool[PATCH_FLAG] = true;
  const original = tool.preMouseDownCallback.bind(tool);
  tool.preMouseDownCallback = (evt) => {
    // Check the candidates first: with every one locked, Cornerstone's own closest-contour
    // search skips them all and then reads `annotations[undefined]` — it throws, which is
    // the only reason a locked contour was not sculpted before (silently, by crashing).
    const element = (evt.detail as { element?: unknown }).element;
    const candidates = (tool.filterSculptableAnnotationsForElement?.(element) ?? [])
      .filter((a) => (a as { isVisible?: boolean }).isVisible !== false);
    const locked = candidates.map((a) => lockedMemberOf(a)).find((m) => m !== null);
    if (candidates.length > 0 && candidates.every((a) => lockedMemberOf(a) !== null)) {
      warnMemberLocked(locked!.segmentationId, locked!.segmentIndex);
      return true; // consumed: nothing is sculpted
    }
    if (candidates.length > 0) {
      // The one it would take is unlocked as an annotation — but is its SEGMENT locked?
      const uid = tool.getClosestFreehandToolOnElement!(evt.detail);
      const target = uid ? lockedMemberOf(csAnnotation.state.getAnnotation(uid)) : null;
      if (target) {
        warnMemberLocked(target.segmentationId, target.segmentIndex);
        return true;
      }
    }
    return original(evt);
  };
}
