/**
 * Live Wire with SegWorks' settings (parity branch 6, F2; inventory #75–81 —
 * docs/segworks-parity.md §10).
 *
 * Extends Cornerstone's LivewireContourSegmentationTool rather than forking it, and is
 * registered under the SAME tool name, so annotations, RTSTRUCT export and the tool group
 * see the one Live Wire they always did:
 *
 *  - Advanced mode (#75–79): after Cornerstone builds its scissors, they are rebuilt as
 *    AdvancedLivewireScissors on the same normalised image, whose link cost is ours
 *    (pre-smoothing, Scharr/Sobel, Laplacian cue, direction term, user weights). Basic mode
 *    leaves Cornerstone's cost untouched.
 *  - Close tolerance (#80): Cornerstone closes a click within a fixed 10 screen px of the
 *    first anchor, judged on the click's CANVAS position only (the anchor itself uses the
 *    world position). The click's canvas position is adjusted before Cornerstone sees it:
 *    snapped onto the first anchor within the tolerance, moved away from it when it is only
 *    inside Cornerstone's 10 px.
 *  - Commit smoothing (#81): Chaikin passes on the closed path as it is committed.
 *
 * Cornerstone declares the members involved `private`; they are replaced on the instance
 * (as selectedStyle and the scissor-outline patches do), with the reason here.
 */
import { getEnabledElement } from '@cornerstonejs/core';
import { LivewireContourSegmentationTool } from '@cornerstonejs/tools';
import { LivewireScissors } from '@cornerstonejs/tools/utilities/livewire/LivewireScissors';
import { linkCost, livewireCostMaps, type LivewireCostMaps } from '../../segmentation/contours/livewireCost';
import { chaikin } from '../../segmentation/contours/polygon';
import { getContourToolSettings, type LivewireSettings } from './contourToolSettings';

type Point2 = [number, number];

/** Cornerstone's fixed click-to-close distance (screen px), LivewireContourTool.ts. */
const CORNERSTONE_CLOSE_PX = 10;

/** Scissors whose link cost comes from our maps and weights. */
export class AdvancedLivewireScissors extends LivewireScissors {
  readonly maps: LivewireCostMaps;

  constructor(grayscale: Float32Array, width: number, height: number, settings: LivewireSettings) {
    super(grayscale, width, height);
    this.maps = livewireCostMaps(grayscale, width, height, settings);
    const maps = this.maps;
    // Replaces Cornerstone's fixed 0.43 / 0.43 / 0.11 blend (a private method).
    (this as unknown as { _getWeightedDistance: (a: Point2, b: Point2) => number })._getWeightedDistance = (a, b) => {
      if (b[0] < 0 || b[0] >= width || b[1] < 0 || b[1] >= height) return 1;
      if (a[0] < 0 || a[1] < 0 || a[0] >= width || a[1] >= height) return 0;
      return linkCost(maps, a[0], a[1], b[0], b[1], settings);
    };
  }

  /** The same image and start as Cornerstone's scissors, with our cost. */
  static from(base: LivewireScissors, settings: LivewireSettings): AdvancedLivewireScissors {
    const b = base as unknown as { grayscalePixelData: Float32Array; width: number; height: number; startPoint: Point2 | null };
    const s = new AdvancedLivewireScissors(b.grayscalePixelData, b.width, b.height, settings);
    if (b.startPoint) s.startSearch(b.startPoint);
    return s;
  }
}

interface EditData {
  closed: boolean;
  currentPath?: { getControlPoints(): Point2[] };
  sliceToWorld?: (p: Point2) => number[];
}

type Viewport = { worldToCanvas(p: number[]): [number, number] };

export class AppLivewireContourTool extends LivewireContourSegmentationTool {
  static toolName = LivewireContourSegmentationTool.toolName;

  constructor(toolProps = {}, defaultToolProps?: Record<string, unknown>) {
    super(toolProps, defaultToolProps as never);
    const self = this as unknown as {
      _mouseDownCallback: (evt: { type: string; detail: Record<string, unknown> } & Record<string, unknown>) => void;
      editData: EditData | null;
    };
    const cornerstoneMouseDown = self._mouseDownCallback;
    self._mouseDownCallback = (evt) => cornerstoneMouseDown(this.adjustCloseClick(evt, self.editData));
  }

  /** The click with its canvas position moved so closing follows the user's tolerance. */
  private adjustCloseClick<E extends { type: string; detail: Record<string, unknown> }>(evt: E, editData: EditData | null): E {
    const tolerance = getContourToolSettings().livewire.closeTolerancePx;
    const detail = evt.detail as { currentPoints?: { canvas: Point2 }; element?: HTMLElement };
    const controlPoints = editData?.currentPath?.getControlPoints() ?? [];
    if (!editData || editData.closed || controlPoints.length < 2 || !detail.currentPoints || !editData.sliceToWorld) return evt;
    const viewport = this.viewportOf(detail);
    if (!viewport) return evt;
    const first = viewport.worldToCanvas(editData.sliceToWorld(controlPoints[0]));
    const [cx, cy] = detail.currentPoints.canvas;
    const d = Math.hypot(cx - first[0], cy - first[1]);
    let canvas: Point2 | null = null;
    if (d <= tolerance) canvas = [first[0], first[1]];
    else if (d <= CORNERSTONE_CLOSE_PX) canvas = [cx + 1000, cy + 1000]; // outside Cornerstone's close test
    if (!canvas) return evt;
    // A plain copy carrying what Cornerstone's handler reads (type, detail, preventDefault).
    // Not an Event-prototyped clone: Event's accessors throw on a non-Event receiver, which
    // silently killed the click. The detail is copied because other listeners share it.
    const original = evt as unknown as Event;
    return {
      type: evt.type,
      detail: { ...evt.detail, currentPoints: { ...detail.currentPoints, canvas } },
      preventDefault: () => original.preventDefault?.(),
      stopPropagation: () => original.stopPropagation?.(),
      stopImmediatePropagation: () => original.stopImmediatePropagation?.(),
    } as unknown as E;
  }

  private viewportOf(detail: { element?: HTMLElement }): Viewport | null {
    if (!detail.element) return null;
    return (getEnabledElement(detail.element as HTMLDivElement)?.viewport as unknown as Viewport) ?? null;
  }

  protected setupBaseEditData(worldPos: unknown, element: unknown, annotation: unknown, nextPos?: unknown, contourHoleProcessingEnabled?: unknown): void {
    super.setupBaseEditData(worldPos, element, annotation, nextPos, contourHoleProcessingEnabled);
    const live = getContourToolSettings().livewire;
    if (live.mode !== 'advanced') return;
    if (this.scissors) this.scissors = AdvancedLivewireScissors.from(this.scissors, live);
    if (this.scissorsNext) this.scissorsNext = AdvancedLivewireScissors.from(this.scissorsNext, live);
  }

  protected updateAnnotation(livewirePath: Parameters<LivewireContourSegmentationTool['updateAnnotation']>[0]): void {
    const passes = getContourToolSettings().livewire.commitSmoothing;
    const closed = (this.editData as unknown as { closed?: boolean } | null)?.closed;
    if (closed && passes > 0 && livewirePath && livewirePath.pointArray.length >= 3) {
      const smoothed = chaikin(livewirePath.pointArray.map((p) => [p[0], p[1]] as [number, number]), Math.min(3, passes));
      super.updateAnnotation({ pointArray: smoothed } as unknown as typeof livewirePath);
      return;
    }
    super.updateAnnotation(livewirePath);
  }
}
