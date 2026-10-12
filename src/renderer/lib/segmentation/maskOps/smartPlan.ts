/**
 * Smart Cleanup planning (SegWorks #211–212): when one cleanup operation is applied to
 * every segment, segments it would damage get a safer action instead.
 *
 *  - SMALL segments (few voxels in the scope) can vanish under smoothing or opening.
 *  - THIN segments (vessels, ducts, rims — mostly boundary, little interior) are erased by
 *    Gaussian smoothing and morphology even when large.
 *
 * Thinness is SegWorks' boundary/area ratio on a few sampled slices: a pixel is boundary
 * when any 4-neighbour is outside the segment (or it touches the plane edge). The plan is
 * a proposal; the user reviews and edits it before anything runs.
 */
import type { MaskPlane } from './plane';

/** Operations that can erase small or thin structures — the ones protection overrides. */
export const ERODING_OPS = new Set(['gaussian', 'median', 'smoothEdges', 'open', 'close', 'removeSpeckles', 'anisotropic']);

/** Boundary pixels / set pixels over the given planes (0 when empty). */
export function thinScore(planes: MaskPlane[]): number {
  let area = 0;
  let boundary = 0;
  for (const p of planes) {
    const { width: w, height: h, data } = p;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = x + y * w;
        if (!data[i]) continue;
        area++;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !data[i - 1] || !data[i + 1] || !data[i - w] || !data[i + w]) boundary++;
      }
    }
  }
  return area > 0 ? boundary / area : 0;
}

/** Up to three representative slices of a range: first, middle, last. */
export function sampleSlices(slices: number[]): number[] {
  if (slices.length <= 3) return [...slices];
  return [slices[0], slices[Math.floor(slices.length / 2)], slices[slices.length - 1]];
}

export interface SegmentStats {
  segmentIndex: number;
  name: string;
  voxels: number;
  thin: number;
}

export interface PlanOptions {
  /** Below this many voxels (in the scope) a segment counts as small. */
  smallVoxels: number;
  /** At or above this boundary/area ratio a segment counts as thin. */
  thinThreshold: number;
  /** Action given to small or thin segments when the chosen op could erode them. */
  safeAction: string;
}

export interface PlanEntry {
  segmentIndex: number;
  name: string;
  voxels: number;
  small: boolean;
  thin: boolean;
  /** Op id to run on this segment, or 'skip'. */
  action: string;
}

export const DEFAULT_PLAN_OPTIONS: PlanOptions = { smallVoxels: 1500, thinThreshold: 0.62, safeAction: 'skip' };

/** Small-segment threshold for a scope: SegWorks uses a tenth of the volume threshold for one slice (min 150). */
export function smallThresholdFor(sliceCount: number, base = DEFAULT_PLAN_OPTIONS.smallVoxels): number {
  return sliceCount <= 1 ? Math.max(150, Math.round(base / 10)) : base;
}

/** Propose an action per segment, largest first. Empty segments are skipped. */
export function planSmartCleanup(stats: SegmentStats[], opId: string, opts: PlanOptions): PlanEntry[] {
  return [...stats]
    .sort((a, b) => b.voxels - a.voxels)
    .map((s) => {
      const small = s.voxels > 0 && s.voxels < opts.smallVoxels;
      const thin = s.voxels > 0 && s.thin >= opts.thinThreshold;
      let action = opId;
      if (s.voxels === 0) action = 'skip';
      else if ((small || thin) && ERODING_OPS.has(opId)) action = opts.safeAction;
      return { segmentIndex: s.segmentIndex, name: s.name, voxels: s.voxels, small, thin, action };
    });
}
