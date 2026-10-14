/**
 * Region and Region+ (Cornerstone's grow-cut tools), made to behave like the app's other
 * editing tools:
 *
 *  - their write is ONE undo step and never lands in a locked segment — Cornerstone writes the
 *    labelmap directly, with no history memo and no lock check (labelmapTransaction's
 *    `beginDirectEdit` records it, or puts it back);
 *  - Region+ answers a click. Cornerstone's tool lets a click through only after the pointer has
 *    rested 500 ms (its seed heuristic runs on a mouse-move timer), so the natural click was
 *    ignored silently, and a click its heuristic rejects showed only a cursor change. Here the
 *    click computes the seeds when they are not ready, and a click it cannot use says why.
 */
import { RegionSegmentPlusTool, RegionSegmentTool } from '@cornerstonejs/tools';
import { showToast } from '../../../stores/toastStore';
import { useSegmentationStore } from '../../../stores/segmentationStore';
import { beginDirectEdit, isSegmentLockedHere, type MemberRef } from '../labelmapTransaction';
import { warnMemberLocked } from '../../annotations/lockWarning';

type MouseDownEvt = Parameters<RegionSegmentPlusTool['preMouseDownCallback']>[0];
type Stable = (evt: MouseDownEvt, world: unknown, element: HTMLDivElement) => Promise<void>;

function activeMember(): MemberRef | null {
  const { activeSegmentationId, activeSegmentIndex } = useSegmentationStore.getState();
  return activeSegmentationId && activeSegmentIndex > 0 ? { containerId: activeSegmentationId, segmentIndex: activeSegmentIndex } : null;
}

/** False (with the lock warning) when the active segment is locked. */
function mayEdit(): boolean {
  const m = activeMember();
  if (m && isSegmentLockedHere(m.containerId, m.segmentIndex)) {
    warnMemberLocked(m.containerId, m.segmentIndex, 'segment it');
    return false;
  }
  return true;
}

/** Run Cornerstone's grow-cut write as a recorded edit of the active segment. */
async function recorded(run: () => Promise<void>): Promise<void> {
  const m = activeMember();
  const edit = m ? beginDirectEdit(m) : null;
  try {
    await run();
  } finally {
    if (edit?.finish() === 'reverted' && m) warnMemberLocked(m.containerId, m.segmentIndex, 'segment it');
  }
}

export class AppRegionSegmentTool extends RegionSegmentTool {
  static toolName = RegionSegmentTool.toolName;

  async preMouseDownCallback(evt: MouseDownEvt): Promise<boolean> {
    if (!mayEdit()) return false;
    return super.preMouseDownCallback(evt as never);
  }

  async runGrowCut(): Promise<void> {
    await recorded(() => super.runGrowCut());
  }
}

export class AppRegionSegmentPlusTool extends RegionSegmentPlusTool {
  static toolName = RegionSegmentPlusTool.toolName;

  async preMouseDownCallback(evt: MouseDownEvt): Promise<boolean> {
    if (!mayEdit()) return false;
    const self = this as unknown as { allowedToProceed: boolean; mouseTimer: number | null; onMouseStable: Stable };
    if (!self.allowedToProceed) {
      if (self.mouseTimer !== null) { window.clearTimeout(self.mouseTimer); self.mouseTimer = null; }
      const { currentPoints, element } = evt.detail;
      await self.onMouseStable(evt, currentPoints.world, element);
      if (!self.allowedToProceed) {
        showToast('Region+ cannot find a distinct structure here — click inside a structure that differs from its surroundings, or use Region (drag a circle).', 'warning');
        return false;
      }
    }
    return super.preMouseDownCallback(evt);
  }

  async runGrowCut(): Promise<void> {
    await recorded(() => super.runGrowCut());
  }
}
