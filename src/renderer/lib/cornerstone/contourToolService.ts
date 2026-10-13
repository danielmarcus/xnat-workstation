/**
 * Actions of the contour drawing tools that reach beyond the tool classes (SegWorks parity
 * branch 6, F3): the Spline tool's point undo and clear (#83–84), and fitting the viewport
 * to the ROI limit for precise local work (#92).
 */
import { getEnabledElementByViewportId } from '@cornerstonejs/core';
import { getContourRoi, getContourToolSettings, getSplineActions } from './tools/contourToolSettings';

type Camera = { focalPoint: number[]; position: number[]; viewUp: number[]; parallelScale: number };
type FitViewport = {
  getCamera(): Camera;
  setCamera(c: Partial<Camera>): void;
  worldToCanvas(p: number[]): [number, number];
  canvas: HTMLCanvasElement;
  render(): void;
};

export const contourToolService = {
  undoLastSplinePoint(): boolean {
    return getSplineActions()?.undoLastPoint() ?? false;
  },

  clearSpline(): boolean {
    return getSplineActions()?.clear() ?? false;
  },

  /** Whether an ROI limit is drawn (Fit to ROI and local editing need one). */
  hasRoi(): boolean {
    return !!getContourRoi();
  },

  /**
   * Zoom the ROI's viewport so the ROI fills it: centred, ROI size × multiplier plus a
   * margin (a fraction of the ROI) on each side (#92). Returns false without an ROI.
   */
  fitToRoi(): boolean {
    const roi = getContourRoi();
    if (!roi) return false;
    const vp = getEnabledElementByViewportId(roi.viewportId)?.viewport as unknown as FitViewport | undefined;
    if (!vp) return false;
    const { fitMultiplier, fitMargin } = getContourToolSettings().spline;
    const cam = vp.getCamera();
    const centre = [0, 1, 2].map((k) => roi.corners.reduce((s, c) => s + c[k], 0) / roi.corners.length);
    // ROI extent along the view's up and right axes, in world mm.
    const up = cam.viewUp;
    const normal = [cam.position[0] - cam.focalPoint[0], cam.position[1] - cam.focalPoint[1], cam.position[2] - cam.focalPoint[2]];
    const right = [up[1] * normal[2] - up[2] * normal[1], up[2] * normal[0] - up[0] * normal[2], up[0] * normal[1] - up[1] * normal[0]];
    const rl = Math.hypot(right[0], right[1], right[2]) || 1;
    const along = (axis: number[], len = 1) => {
      const v = roi.corners.map((c) => ((c[0] - centre[0]) * axis[0] + (c[1] - centre[1]) * axis[1] + (c[2] - centre[2]) * axis[2]) / len);
      return Math.max(...v) - Math.min(...v);
    };
    const height = along(up), width = along(right, rl);
    const aspect = vp.canvas.clientWidth / Math.max(1, vp.canvas.clientHeight);
    const half = Math.max(height / 2, width / 2 / aspect) * fitMultiplier * (1 + 2 * fitMargin);
    const shift = [0, 1, 2].map((k) => centre[k] - cam.focalPoint[k]);
    vp.setCamera({
      focalPoint: centre,
      position: cam.position.map((p, k) => p + shift[k]),
      parallelScale: Math.max(half, 1),
    });
    vp.render();
    return true;
  },
};
