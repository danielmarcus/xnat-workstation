/**
 * Seeding and Smart-tool marks on the image (SegWorks parity branches 4–5): the ROI limit as
 * a dashed rectangle on the viewport it was drawn on, and seed strokes (seedStore — Random
 * Walker's and the solvers') on the slice they were drawn on, in their class's colour
 * (Background grey), as wide as their brush. An SVG layer per viewport, redrawn on every
 * render and whenever the marks change.
 */
import { Enums as CoreEnums, getEnabledElementByViewportId, utilities as csUtils } from '@cornerstonejs/core';
import { useSemiAutoStore } from '../../stores/semiAutoStore';
import { BACKGROUND, useSeedStore } from '../../stores/seedStore';
import { useSegmentationStore } from '../../stores/segmentationStore';

const OVERLAY_TESTID = 'semi-auto-overlay';
const NS = 'http://www.w3.org/2000/svg';

type Viewport = {
  element: HTMLDivElement;
  getCamera: () => { viewPlaneNormal?: number[]; focalPoint?: number[]; viewUp?: number[] };
  getImageData?: () => { spacing?: number[]; direction?: number[] } | undefined;
  worldToCanvas: (p: number[]) => [number, number];
};

const listening = new WeakSet<HTMLElement>();
const drawn = new Set<string>();

function viewportOf(id: string): Viewport | null {
  try {
    return (getEnabledElementByViewportId(id)?.viewport as unknown as Viewport) ?? null;
  } catch {
    return null;
  }
}

function overlayFor(id: string, vp: Viewport): SVGSVGElement {
  const host = (vp.element.querySelector('.svg-layer')?.parentElement ?? vp.element) as HTMLElement;
  let svg = host.querySelector(`svg[data-testid="${OVERLAY_TESTID}"]`) as SVGSVGElement | null;
  if (!svg) {
    svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('data-testid', OVERLAY_TESTID);
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:6;overflow:visible';
    host.appendChild(svg);
  }
  if (!listening.has(vp.element)) {
    listening.add(vp.element);
    vp.element.addEventListener(CoreEnums.Events.IMAGE_RENDERED, () => drawOn(id));
  }
  return svg;
}

/** Canvas units per mm along the view's horizontal axis (the view is square in mm). */
function canvasPerMm(vp: Viewport): number {
  const cam = vp.getCamera();
  const f = cam.focalPoint, n = cam.viewPlaneNormal, up = cam.viewUp;
  if (!f || !n || !up) return 1;
  const right = [up[1] * n[2] - up[2] * n[1], up[2] * n[0] - up[0] * n[2], up[0] * n[1] - up[1] * n[0]];
  const a = vp.worldToCanvas(f), b = vp.worldToCanvas([f[0] + right[0], f[1] + right[1], f[2] + right[2]]);
  return Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
}

/** Is a world point on the slice the viewport shows? (within half a slice) */
function onSlice(vp: Viewport, p: number[]): boolean {
  const cam = vp.getCamera();
  const n = cam.viewPlaneNormal, f = cam.focalPoint;
  if (!n || !f) return false;
  const img = vp.getImageData?.();
  let spacing = 1;
  if (img?.spacing && img.direction) {
    try {
      spacing = csUtils.getSpacingInNormalDirection({ direction: img.direction, spacing: img.spacing } as never, n as never);
    } catch { /* keep 1 mm */ }
  }
  const d = (p[0] - f[0]) * n[0] + (p[1] - f[1]) * n[1] + (p[2] - f[2]) * n[2];
  return Math.abs(d) <= Math.max(0.5, spacing / 2);
}

function drawOn(viewportId: string): void {
  const vp = viewportOf(viewportId);
  if (!vp) return;
  const svg = overlayFor(viewportId, vp);
  svg.replaceChildren();
  const roi = useSemiAutoStore.getState().roi;
  const strokes = useSeedStore.getState().strokes.filter((st) => st.viewportId === viewportId);
  let marks = 0;
  if (roi?.viewportId === viewportId && roi.corners.length === 4) {
    const pts = roi.corners.map((c) => vp.worldToCanvas(c));
    const poly = document.createElementNS(NS, 'polygon');
    poly.setAttribute('points', pts.map((p) => p.join(',')).join(' '));
    poly.setAttribute('fill', 'none');
    poly.setAttribute('stroke', 'rgb(250, 204, 21)');
    poly.setAttribute('stroke-width', '1.5');
    poly.setAttribute('stroke-dasharray', '6 4');
    poly.setAttribute('data-mark', 'roi');
    svg.appendChild(poly);
    marks++;
  }
  if (strokes.length) {
    const seg = useSegmentationStore.getState();
    const perMm = canvasPerMm(vp);
    // The stamp covers the pixel under the pointer too: half a pixel either side of the radius.
    const pixelMm = Math.min(...(vp.getImageData?.()?.spacing ?? [1, 1]).slice(0, 2));
    for (const st of strokes) {
      const pts = st.points.filter((p) => onSlice(vp, p)).map((p) => vp.worldToCanvas(p));
      if (!pts.length) continue;
      const member = seg.segmentations.find((c) => c.segmentationId === st.containerId)?.segments.find((m) => m.segmentIndex === st.cls);
      const line = document.createElementNS(NS, 'polyline');
      line.setAttribute('points', (pts.length === 1 ? [pts[0], pts[0]] : pts).map((p) => p.join(',')).join(' '));
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke', st.cls === BACKGROUND || !member ? 'rgb(161, 161, 170)' : `rgb(${member.color[0]}, ${member.color[1]}, ${member.color[2]})`);
      line.setAttribute('stroke-width', String(Math.max(3, (2 * st.radiusMm + pixelMm) * perMm)));
      line.setAttribute('stroke-linecap', 'round');
      line.setAttribute('stroke-linejoin', 'round');
      line.setAttribute('stroke-opacity', '0.8');
      line.setAttribute('data-mark', st.cls === BACKGROUND ? 'seed-bg' : 'seed-fg');
      line.setAttribute('data-class', String(st.cls));
      svg.appendChild(line);
      marks++;
    }
  }
  svg.setAttribute('data-marks', String(marks));
  if (marks) drawn.add(viewportId);
  else drawn.delete(viewportId);
}

/** Redraw every viewport that has, or had, a mark. */
function drawAll(): void {
  const s = useSemiAutoStore.getState();
  const ids = new Set<string>(drawn);
  if (s.roi) ids.add(s.roi.viewportId);
  for (const st of useSeedStore.getState().strokes) ids.add(st.viewportId);
  for (const id of ids) drawOn(id);
}

let started = false;
/** Keep the marks in step with the store (idempotent). */
export function startSemiAutoOverlay(): void {
  if (started) return;
  started = true;
  useSemiAutoStore.subscribe((s, prev) => {
    if (s.roi !== prev.roi) drawAll();
  });
  useSeedStore.subscribe((s, prev) => { if (s.strokes !== prev.strokes) drawAll(); });
}
