/**
 * Region+ (Cornerstone's one-click grow-cut), made to answer a click.
 *
 * Cornerstone's tool decides whether a click may proceed only after the pointer has rested
 * 500 ms on the image (its seed heuristic runs on a timer from mouse-move); a click before that
 * — the natural way to use a one-click tool — was silently ignored, and so was a click its
 * heuristic rejects (the cursor turning to "not-allowed" was the only sign). Here the click
 * itself computes the seeds when they are not ready, and a click it cannot use says why.
 */
import { RegionSegmentPlusTool } from '@cornerstonejs/tools';
import { showToast } from '../../../stores/toastStore';

type MouseDownEvt = Parameters<RegionSegmentPlusTool['preMouseDownCallback']>[0];
type Stable = (evt: MouseDownEvt, world: unknown, element: HTMLDivElement) => Promise<void>;

export class AppRegionSegmentPlusTool extends RegionSegmentPlusTool {
  static toolName = RegionSegmentPlusTool.toolName;

  async preMouseDownCallback(evt: MouseDownEvt): Promise<boolean> {
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
}
