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
 *    click computes the seeds when they are not ready, and a click it cannot use says why;
 *  - they need WebGPU (Cornerstone's grow-cut has no other engine). Where there is none the
 *    gesture is refused with a toast before anything starts — the toolbox disables both too
 *    (growCutGpu) — and a run that fails anyway puts back what it wrote, records no undo step,
 *    says so, and lets no rejection escape (Region's mouse-up calls `runGrowCut` un-awaited).
 */
import { RegionSegmentPlusTool, RegionSegmentTool } from '@cornerstonejs/tools';
import { getEnabledElement } from '@cornerstonejs/core';
import { readSegmentVoxelGrid } from '../segmentVoxelGrid';
import { OBLIQUE_VIEW_MESSAGE, viewAlignedWithGrid } from '../maskIslands';
import { showToast } from '../../../stores/toastStore';
import { useSegmentationStore } from '../../../stores/segmentationStore';
import { beginDirectEdit, isSegmentLockedHere, type MemberRef } from '../labelmapTransaction';
import { warnMemberLocked } from '../../annotations/lockWarning';
import { GROW_CUT_GPU_UNAVAILABLE_MESSAGE, probeGrowCutGpu } from '../growCutGpu';

type MouseDownEvt = Parameters<RegionSegmentPlusTool['preMouseDownCallback']>[0];
type Stable = (evt: MouseDownEvt, world: unknown, element: HTMLDivElement) => Promise<void>;

function activeMember(): MemberRef | null {
  const { activeSegmentationId, activeSegmentIndex } = useSegmentationStore.getState();
  return activeSegmentationId && activeSegmentIndex > 0 ? { containerId: activeSegmentationId, segmentIndex: activeSegmentIndex } : null;
}

/**
 * False (with the reason) when there is no WebGPU to run the grow-cut on, when the active segment
 * is locked, or when the view is an oblique reformat — Cornerstone's grow-cut works in the grid's
 * axes and segmented nothing there.
 */
async function mayEdit(element?: HTMLDivElement): Promise<boolean> {
  if (!(await probeGrowCutGpu())) {
    showToast(GROW_CUT_GPU_UNAVAILABLE_MESSAGE, 'warning');
    return false;
  }
  const m = activeMember();
  if (m && isSegmentLockedHere(m.containerId, m.segmentIndex)) {
    warnMemberLocked(m.containerId, m.segmentIndex, 'segment it');
    return false;
  }
  if (!aligned(element)) {
    showToast(OBLIQUE_VIEW_MESSAGE, 'warning');
    return false;
  }
  return true;
}

/** Whether the element's view shows planes of the active segment's grid (not an oblique reformat). */
function aligned(element: HTMLDivElement | undefined): boolean {
  const m = activeMember();
  const grid = m ? readSegmentVoxelGrid(m.containerId, m.segmentIndex) : null;
  const normal = element ? (getEnabledElement(element)?.viewport as { getCamera?: () => { viewPlaneNormal?: number[] } } | undefined)?.getCamera?.()?.viewPlaneNormal : undefined;
  return !grid || !normal || viewAlignedWithGrid(grid.geometry.direction, normal);
}

/**
 * Run Cornerstone's grow-cut write as a recorded edit of the active segment. Never rejects: a
 * failed run is put back and reported here.
 */
async function recorded(tool: { growCutData: unknown }, label: string, run: () => Promise<void>): Promise<void> {
  const m = activeMember();
  const edit = m ? beginDirectEdit(m) : null;
  try {
    await run();
  } catch (err) {
    console.warn(`[AppRegionSegmentPlusTool] ${label} grow-cut failed:`, err);
    edit?.abort();
    tool.growCutData = null; // Cornerstone clears it only on success
    showToast(`${label} failed and changed nothing.`, 'error');
    return;
  }
  if (edit?.finish() === 'reverted' && m) warnMemberLocked(m.containerId, m.segmentIndex, 'segment it');
}

type GrowCutState = { growCutData: unknown };

export class AppRegionSegmentTool extends RegionSegmentTool {
  static toolName = RegionSegmentTool.toolName;

  async preMouseDownCallback(evt: MouseDownEvt): Promise<boolean> {
    if (!(await mayEdit(evt.detail.element as HTMLDivElement))) return false;
    return super.preMouseDownCallback(evt as never);
  }

  async runGrowCut(): Promise<void> {
    await recorded(this as unknown as GrowCutState, 'Region', () => super.runGrowCut());
  }
}

export class AppRegionSegmentPlusTool extends RegionSegmentPlusTool {
  static toolName = RegionSegmentPlusTool.toolName;

  /**
   * Cornerstone runs its seed heuristic on a timer while the pointer merely hovers — and it
   * THROWS on an oblique view ("Oblique view is not supported yet"), an uncaught error per rest.
   * Not on an oblique reformat, then; anywhere else its errors are contained.
   */
  mouseMoveCallback(evt: Parameters<RegionSegmentPlusTool['mouseMoveCallback']>[0]): void {
    if (!aligned(evt.detail.element as HTMLDivElement)) return;
    super.mouseMoveCallback(evt);
  }

  async onMouseStable(...args: Parameters<Stable>): Promise<void> {
    try {
      await (RegionSegmentPlusTool.prototype as unknown as { onMouseStable: Stable }).onMouseStable.apply(this, args);
    } catch (err) {
      console.warn('[AppRegionSegmentPlusTool] seed heuristic failed:', err);
      (this as unknown as { allowedToProceed: boolean }).allowedToProceed = false;
    }
  }

  async preMouseDownCallback(evt: MouseDownEvt): Promise<boolean> {
    if (!(await mayEdit(evt.detail.element as HTMLDivElement))) return false;
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
    await recorded(this as unknown as GrowCutState, 'Region+', () => super.runGrowCut());
  }
}
