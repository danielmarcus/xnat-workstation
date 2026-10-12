/**
 * The Smart tab's on-image marks (SegWorks parity branch 4): the ROI limit as a dashed
 * rectangle on the viewport it was drawn on, and Random Walker seed strokes (foreground
 * green, background red) on the slice they were drawn on. An SVG layer per viewport,
 * redrawn on every render and whenever the marks change.
 */
import { Enums as CoreEnums, getEnabledElementByViewportId, utilities as csUtils } from '@cornerstonejs/core';
import { useSemiAutoStore } from '../../stores/semiAutoStore';

const OVERLAY_TESTID = 'semi-auto-overlay';
const NS = 'http://www.w3.org/2000/svg';

type Viewport = {
  element: HTMLDivElement;
  getCamera: () => { viewPlaneNormal?: number[]; focalPoint?: number[] };
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
  const { roi, seeds, seedSize } = (() => {
    const s = useSemiAutoStore.getState();
    return { roi: s.roi, seeds: s.seeds, seedSize: s.randomWalker.seedRadiusPx };
  })();
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
  if (seeds?.viewportId === viewportId) {
    for (const st of seeds.strokes) {
      const pts = st.points.filter((p) => onSlice(vp, p)).map((p) => vp.worldToCanvas(p));
      if (!pts.length) continue;
      const line = document.createElementNS(NS, 'polyline');
      line.setAttribute('points', (pts.length === 1 ? [pts[0], pts[0]] : pts).map((p) => p.join(',')).join(' '));
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke', st.kind === 'fg' ? 'rgb(74, 222, 128)' : 'rgb(248, 113, 113)');
      line.setAttribute('stroke-width', String(Math.max(3, seedSize * 2)));
      line.setAttribute('stroke-linecap', 'round');
      line.setAttribute('stroke-linejoin', 'round');
      line.setAttribute('stroke-opacity', '0.8');
      line.setAttribute('data-mark', st.kind === 'fg' ? 'seed-fg' : 'seed-bg');
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
  if (s.seeds) ids.add(s.seeds.viewportId);
  for (const id of ids) drawOn(id);
}

let started = false;
/** Keep the marks in step with the store (idempotent). */
export function startSemiAutoOverlay(): void {
  if (started) return;
  started = true;
  useSemiAutoStore.subscribe((s, prev) => {
    if (s.roi !== prev.roi || s.seeds !== prev.seeds || s.randomWalker.seedRadiusPx !== prev.randomWalker.seedRadiusPx) drawAll();
  });
}
