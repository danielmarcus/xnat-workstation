/**
 * Unified world-point crosshair geometry + cross-panel sync.
 *
 * Adapted from the deleted crosshairGeometry/crosshairSyncService (P1.8d),
 * de-coupled from the removed mprService — the unified path has ONE viewport per
 * panel via viewportService. This is the plane-agnostic crosshair the spec wants:
 * a shared 3D world point, drawn as a reticle in every viewport that contains it
 * (works in a single viewport AND same-plane multi-viewport), with click-to-set
 * and cross-panel sync (same-plane → nearest slice; volume → jumpToWorld).
 *
 * NOTE: the canvas↔world mapping (canvasToWorld/worldToCanvas + the device-pixel
 * detection) is DPR-sensitive and unreliable in headless Playwright, so its
 * pixel-accuracy is verified on real data, not offline E2E. The math + handlers
 * are unit-tested with mocked viewports.
 */
import { metaData } from '@cornerstonejs/core';
import { wadouri } from '@cornerstonejs/dicom-image-loader';
import { viewportService } from './viewportService';

export type Point3 = [number, number, number];
type Point2 = [number, number];

type AnyViewport = {
  type?: string;
  canvasToWorld?: (canvasPos: Point2) => number[] | Point3;
  worldToCanvas?: (worldPos: Point3) => number[] | Point2;
  jumpToWorld?: (world: Point3) => boolean;
  scroll?: (delta: number) => void;
  getSliceIndex?: () => number;
  render?: () => void;
};

type PanelCanvasContext = {
  panelRect: DOMRect;
  canvasRect: DOMRect;
  canvasEl: HTMLCanvasElement | null;
  panelWidth: number;
  panelHeight: number;
};

function dot(a: Point3, b: Point3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a: Point3, b: Point3): Point3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function isFinitePoint2(p: number[] | undefined | null): p is Point2 {
  return !!p && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}
function isFinitePoint3(p: number[] | undefined | null): p is Point3 {
  return !!p && p.length >= 3 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]);
}

/** The (engine) viewport for a panel — stack or volume; both expose canvas↔world. */
export function getViewportForPanel(panelId: string): AnyViewport | null {
  return (viewportService.getViewport(panelId) as AnyViewport | null) ?? null;
}

function getPanelCanvasContext(panelId: string): PanelCanvasContext | null {
  const panelEl = document.querySelector(`[data-panel-id="${panelId}"]`) as HTMLElement | null;
  if (!panelEl) return null;
  const panelRect = panelEl.getBoundingClientRect();
  if (panelRect.width <= 0 || panelRect.height <= 0) return null;
  const canvasEl = panelEl.querySelector('canvas') as HTMLCanvasElement | null;
  const canvasRect = (canvasEl ?? panelEl).getBoundingClientRect();
  return { panelRect, canvasRect, canvasEl, panelWidth: panelEl.clientWidth, panelHeight: panelEl.clientHeight };
}

function roundTripError(vp: AnyViewport, candidate: Point2): number {
  try {
    const world = vp.canvasToWorld?.(candidate);
    if (!isFinitePoint3(world as number[])) return Number.POSITIVE_INFINITY;
    const back = vp.worldToCanvas?.([Number(world![0]), Number(world![1]), Number(world![2])]);
    if (!isFinitePoint2(back as number[])) return Number.POSITIVE_INFINITY;
    return Math.hypot(Number(back![0]) - candidate[0], Number(back![1]) - candidate[1]);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** Whether canvasToWorld expects DEVICE pixels (Retina) rather than CSS pixels. */
function usesDeviceCanvasSpace(vp: AnyViewport, ctx: PanelCanvasContext): boolean {
  const { canvasEl, canvasRect } = ctx;
  if (!canvasEl || canvasEl.width <= 0 || canvasEl.height <= 0 || canvasRect.width <= 0 || canvasRect.height <= 0) return false;
  const sx = canvasEl.width / canvasRect.width;
  const sy = canvasEl.height / canvasRect.height;
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || Math.abs(sx - 1) < 0.01 || Math.abs(sy - 1) < 0.01) return false;
  const testCss: Point2 = [canvasRect.width * 0.37, canvasRect.height * 0.61];
  const testDevice: Point2 = [testCss[0] * sx, testCss[1] * sy];
  return roundTripError(vp, testDevice) + 0.01 < roundTripError(vp, testCss);
}

function clientToCanvasPoint(vp: AnyViewport, ctx: PanelCanvasContext, clientX: number, clientY: number): Point2 | null {
  const { canvasEl, canvasRect } = ctx;
  if (canvasRect.width <= 0 || canvasRect.height <= 0) return null;
  let x = clientX - canvasRect.left;
  let y = clientY - canvasRect.top;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (canvasEl && usesDeviceCanvasSpace(vp, ctx)) {
    x *= canvasEl.width / canvasRect.width;
    y *= canvasEl.height / canvasRect.height;
  }
  return [x, y];
}

function worldToPanelPoint(vp: AnyViewport, ctx: PanelCanvasContext, worldPoint: Point3): Point2 | null {
  const { canvasEl, canvasRect, panelRect } = ctx;
  const raw = vp.worldToCanvas?.(worldPoint);
  if (!isFinitePoint2(raw as number[])) return null;
  let x = Number(raw![0]);
  let y = Number(raw![1]);
  if (canvasEl && usesDeviceCanvasSpace(vp, ctx) && canvasRect.width > 0 && canvasRect.height > 0) {
    x *= canvasRect.width / canvasEl.width;
    y *= canvasRect.height / canvasEl.height;
  }
  return [(canvasRect.left - panelRect.left) + x, (canvasRect.top - panelRect.top) + y];
}

/** Client (mouse) point → world coordinate for a panel, or null. */
export function getWorldPointFromClientPoint(panelId: string, clientX: number, clientY: number): Point3 | null {
  const vp = getViewportForPanel(panelId);
  if (!vp || typeof vp.canvasToWorld !== 'function') return null;
  const ctx = getPanelCanvasContext(panelId);
  if (!ctx) return null;
  const canvasPoint = clientToCanvasPoint(vp, ctx, clientX, clientY);
  if (!canvasPoint) return null;
  try {
    const world = vp.canvasToWorld(canvasPoint);
    if (!isFinitePoint3(world as number[])) return null;
    return [Number(world[0]), Number(world[1]), Number(world[2])];
  } catch {
    return null;
  }
}

/** World point → in-panel display point (for drawing the reticle), or null if off-panel. */
export function getPanelDisplayPointForWorld(
  panelId: string,
  worldPoint: Point3,
): { x: number; y: number; width: number; height: number } | null {
  const vp = getViewportForPanel(panelId);
  if (!vp || typeof vp.worldToCanvas !== 'function') return null;
  const ctx = getPanelCanvasContext(panelId);
  if (!ctx) return null;
  const point = worldToPanelPoint(vp, ctx, worldPoint);
  if (!point) return null;
  const [x, y] = point;
  const { panelWidth: width, panelHeight: height } = ctx;
  if (x < -1 || x > width + 1 || y < -1 || y > height + 1) return null;
  return { x: Math.max(0, Math.min(width, x)), y: Math.max(0, Math.min(height, y)), width, height };
}

function getImagePlane(imageId: string): { ipp: Point3; normal: Point3 } | null {
  const imagePlane = metaData.get('imagePlaneModule', imageId) as
    | { imagePositionPatient?: number[]; imageOrientationPatient?: number[] }
    | undefined;
  let ipp = imagePlane?.imagePositionPatient;
  let iop = imagePlane?.imageOrientationPatient;
  if (!Array.isArray(ipp) || ipp.length < 3 || !Array.isArray(iop) || iop.length < 6) {
    try {
      const uri = imageId.startsWith('wadouri:') ? imageId.slice(8) : imageId;
      if (wadouri.dataSetCacheManager.isLoaded(uri)) {
        const ds = wadouri.dataSetCacheManager.get(uri);
        const parse = (v: string | undefined, n: number) => {
          const parts = v?.split('\\').map(Number);
          return parts && parts.length >= n && parts.every(Number.isFinite) ? parts : null;
        };
        ipp = parse(ds?.string?.('x00200032'), 3) ?? ipp;
        iop = parse(ds?.string?.('x00200037'), 6) ?? iop;
      }
    } catch {
      /* ignore */
    }
  }
  if (!Array.isArray(ipp) || ipp.length < 3 || !Array.isArray(iop) || iop.length < 6) return null;
  const position: Point3 = [Number(ipp[0]), Number(ipp[1]), Number(ipp[2])];
  const row: Point3 = [Number(iop[0]), Number(iop[1]), Number(iop[2])];
  const col: Point3 = [Number(iop[3]), Number(iop[4]), Number(iop[5])];
  if (![...position, ...row, ...col].every((v) => Number.isFinite(v))) return null;
  return { ipp: position, normal: cross(row, col) };
}

/** Index of the stack slice whose plane is nearest the world point, or null. */
export function findNearestStackIndex(imageIds: string[], world: Point3): number | null {
  if (imageIds.length === 0) return null;
  const ref = getImagePlane(imageIds[0]);
  if (!ref) return null;
  const target = dot(ref.normal, world);
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < imageIds.length; i++) {
    const plane = getImagePlane(imageIds[i]);
    if (!plane) continue;
    const dist = Math.abs(dot(ref.normal, plane.ipp) - target);
    if (dist < bestDistance) {
      bestDistance = dist;
      bestIndex = i;
    }
  }
  return bestIndex >= 0 ? bestIndex : null;
}

interface CrosshairHandlerOptions {
  element: HTMLElement;
  panelId: string;
  isCrosshairActive: () => boolean;
  onWorldPoint: (point: Point3) => void;
}

/**
 * Wire click-to-set (+ shift-move live) crosshair pointer handlers on a viewport
 * element. A left CLICK (moved <= 4px) sets the world point; a drag is left to the
 * Cornerstone primary tool (W/L). Returns a dispose fn.
 */
export function wireCrosshairPointerHandlers({
  element,
  panelId,
  isCrosshairActive,
  onWorldPoint,
}: CrosshairHandlerOptions): () => void {
  let clickCandidate: { pointerId: number; x: number; y: number } | null = null;

  const syncFromPointer = (e: PointerEvent): void => {
    const point = getWorldPointFromClientPoint(panelId, e.clientX, e.clientY);
    if (point) onWorldPoint(point);
  };
  const onMove = (e: PointerEvent): void => {
    if (!isCrosshairActive() || !e.shiftKey) return;
    e.preventDefault();
    syncFromPointer(e);
  };
  const onDown = (e: PointerEvent): void => {
    if (!isCrosshairActive() || e.button !== 0) {
      clickCandidate = null;
      return;
    }
    clickCandidate = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
  };
  const onUp = (e: PointerEvent): void => {
    if (!isCrosshairActive() || e.button !== 0 || !clickCandidate || clickCandidate.pointerId !== e.pointerId) return;
    const moved = Math.hypot(e.clientX - clickCandidate.x, e.clientY - clickCandidate.y);
    clickCandidate = null;
    if (moved <= 4) syncFromPointer(e);
  };
  const onCancel = (): void => {
    clickCandidate = null;
  };

  element.addEventListener('pointermove', onMove as EventListener);
  element.addEventListener('pointerdown', onDown as EventListener);
  element.addEventListener('pointerup', onUp as EventListener);
  element.addEventListener('pointercancel', onCancel as EventListener);
  return () => {
    element.removeEventListener('pointermove', onMove as EventListener);
    element.removeEventListener('pointerdown', onDown as EventListener);
    element.removeEventListener('pointerup', onUp as EventListener);
    element.removeEventListener('pointercancel', onCancel as EventListener);
  };
}

/**
 * Sync the crosshair world point to all panels EXCEPT the source: volume viewports
 * jump to the point (jumpToWorld); stack viewports scroll to the nearest slice.
 * `panelImageIds` supplies the stack imageIds per panel (for nearest-slice).
 */
export function syncCrosshairToPanels(
  sourcePanelId: string,
  worldPoint: Point3,
  panelIds: string[],
  panelImageIds: Record<string, string[]>,
): void {
  for (const panelId of panelIds) {
    if (panelId === sourcePanelId) continue;
    const vp = getViewportForPanel(panelId);
    if (!vp) continue;
    try {
      if (vp.type && vp.type !== 'stack' && typeof vp.jumpToWorld === 'function') {
        vp.jumpToWorld(worldPoint);
        vp.render?.();
      } else {
        const ids = panelImageIds[panelId] ?? [];
        const idx = findNearestStackIndex(ids, worldPoint);
        if (idx != null) viewportService.scrollToIndex(panelId, idx);
      }
    } catch {
      /* best-effort per panel */
    }
  }
}
