import { mprService } from './mprService';
import { viewportService } from './viewportService';
import { useViewerStore } from '../../stores/viewerStore';

export type Point3 = [number, number, number];
type Point2 = [number, number];

type AnyViewport = {
  canvasToWorld: (canvasPos: Point2) => number[] | Point3;
  worldToCanvas: (worldPos: Point3) => number[] | Point2;
};

type PanelCanvasContext = {
  panelEl: HTMLElement;
  canvasEl: HTMLCanvasElement | null;
  panelRect: DOMRect;
  canvasRect: DOMRect;
  panelWidth: number;
  panelHeight: number;
};

function isFinitePoint2(point: number[] | undefined | null): point is Point2 {
  return !!point && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

function isFinitePoint3(point: number[] | undefined | null): point is Point3 {
  return !!point && point.length >= 3 && Number.isFinite(point[0]) && Number.isFinite(point[1]) && Number.isFinite(point[2]);
}

function getPanelCanvasContext(panelId: string): PanelCanvasContext | null {
  const panelEl = document.querySelector(`[data-panel-id="${panelId}"]`) as HTMLElement | null;
  if (!panelEl) return null;
  const panelRect = panelEl.getBoundingClientRect();
  if (panelRect.width <= 0 || panelRect.height <= 0) return null;
  const canvasEl = panelEl.querySelector('canvas') as HTMLCanvasElement | null;
  const canvasRect = (canvasEl ?? panelEl).getBoundingClientRect();
  return {
    panelEl,
    canvasEl,
    panelRect,
    canvasRect,
    panelWidth: panelEl.clientWidth,
    panelHeight: panelEl.clientHeight,
  };
}

function roundTripError(viewport: AnyViewport, candidate: Point2): number {
  try {
    const world = viewport.canvasToWorld(candidate);
    if (!isFinitePoint3(world as number[])) return Number.POSITIVE_INFINITY;
    const back = viewport.worldToCanvas([Number(world[0]), Number(world[1]), Number(world[2])]);
    if (!isFinitePoint2(back as number[])) return Number.POSITIVE_INFINITY;
    const dx = Number(back[0]) - candidate[0];
    const dy = Number(back[1]) - candidate[1];
    return Math.hypot(dx, dy);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function usesDeviceCanvasSpace(viewport: AnyViewport, ctx: PanelCanvasContext): boolean {
  const { canvasEl, canvasRect } = ctx;
  if (!canvasEl) return false;
  if (canvasEl.width <= 0 || canvasEl.height <= 0 || canvasRect.width <= 0 || canvasRect.height <= 0) {
    return false;
  }

  const sx = canvasEl.width / canvasRect.width;
  const sy = canvasEl.height / canvasRect.height;
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || Math.abs(sx - 1) < 0.01 || Math.abs(sy - 1) < 0.01) {
    return false;
  }

  const testCss: Point2 = [canvasRect.width * 0.37, canvasRect.height * 0.61];
  const testDevice: Point2 = [testCss[0] * sx, testCss[1] * sy];
  const cssErr = roundTripError(viewport, testCss);
  const devErr = roundTripError(viewport, testDevice);
  return devErr + 0.01 < cssErr;
}

function clientToCanvasPoint(
  viewport: AnyViewport,
  ctx: PanelCanvasContext,
  clientX: number,
  clientY: number,
): Point2 | null {
  const { canvasEl, canvasRect } = ctx;
  if (canvasRect.width <= 0 || canvasRect.height <= 0) return null;
  let x = clientX - canvasRect.left;
  let y = clientY - canvasRect.top;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  if (
    canvasEl &&
    usesDeviceCanvasSpace(viewport, ctx) &&
    canvasEl.width > 0 &&
    canvasEl.height > 0
  ) {
    x *= canvasEl.width / canvasRect.width;
    y *= canvasEl.height / canvasRect.height;
  }
  return [x, y];
}

function worldToPanelPoint(
  viewport: AnyViewport,
  ctx: PanelCanvasContext,
  worldPoint: Point3,
): Point2 | null {
  const { canvasEl, canvasRect, panelRect } = ctx;
  const raw = viewport.worldToCanvas(worldPoint);
  if (!isFinitePoint2(raw as number[])) return null;

  let x = Number(raw[0]);
  let y = Number(raw[1]);

  if (
    canvasEl &&
    usesDeviceCanvasSpace(viewport, ctx) &&
    canvasEl.width > 0 &&
    canvasEl.height > 0 &&
    canvasRect.width > 0 &&
    canvasRect.height > 0
  ) {
    x *= canvasRect.width / canvasEl.width;
    y *= canvasRect.height / canvasEl.height;
  }

  return [
    (canvasRect.left - panelRect.left) + x,
    (canvasRect.top - panelRect.top) + y,
  ];
}

export function getViewportForPanel(panelId: string): AnyViewport | null {
  const mprViewport = mprService.getViewport(panelId) as AnyViewport | null;
  const stackViewport = viewportService.getViewport(panelId) as AnyViewport | null;
  // Prefer MPR viewport whenever available. During orientation transitions,
  // panelOrientationMap can lag a frame and point to the wrong service.
  // MPR service is authoritative for oriented panels; stack service is fallback.
  return mprViewport ?? stackViewport ?? null;
}

export function getWorldPointFromClientPoint(
  panelId: string,
  clientX: number,
  clientY: number,
): Point3 | null {
  const viewport = getViewportForPanel(panelId);
  if (!viewport || typeof viewport.canvasToWorld !== 'function') return null;
  const ctx = getPanelCanvasContext(panelId);
  if (!ctx) return null;
  const canvasPoint = clientToCanvasPoint(viewport, ctx, clientX, clientY);
  if (!canvasPoint) return null;
  try {
    const world = viewport.canvasToWorld(canvasPoint);
    if (!isFinitePoint3(world as number[])) return null;
    return [Number(world[0]), Number(world[1]), Number(world[2])];
  } catch {
    return null;
  }
}

export function getPanelDisplayPointForWorld(
  panelId: string,
  worldPoint: Point3,
): { x: number; y: number; width: number; height: number } | null {
  const viewport = getViewportForPanel(panelId);
  if (!viewport || typeof viewport.worldToCanvas !== 'function') return null;
  const ctx = getPanelCanvasContext(panelId);
  if (!ctx) return null;
  const point = worldToPanelPoint(viewport, ctx, worldPoint);
  if (!point) return null;
  const [x, y] = point;
  const { panelWidth: width, panelHeight: height } = ctx;
  if (x < -1 || x > width + 1 || y < -1 || y > height + 1) return null;
  return {
    x: Math.max(0, Math.min(width, x)),
    y: Math.max(0, Math.min(height, y)),
    width,
    height,
  };
}

type CrosshairHandlerOptions = {
  element: HTMLElement;
  panelId: string;
  isCrosshairActive: () => boolean;
  onWorldPoint: (point: Point3) => void;
};

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
    e.stopImmediatePropagation();
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
    if (!isCrosshairActive() || e.button !== 0 || !clickCandidate) return;
    if (clickCandidate.pointerId !== e.pointerId) return;
    const moved = Math.hypot(e.clientX - clickCandidate.x, e.clientY - clickCandidate.y);
    clickCandidate = null;
    if (moved <= 4) {
      syncFromPointer(e);
    }
  };

  const onCancel = (e: PointerEvent): void => {
    if (clickCandidate?.pointerId === e.pointerId) {
      clickCandidate = null;
    }
  };

  element.addEventListener('pointermove', onMove, true);
  element.addEventListener('pointerdown', onDown, true);
  element.addEventListener('pointerup', onUp, true);
  element.addEventListener('pointercancel', onCancel, true);
  element.addEventListener('lostpointercapture', onCancel as EventListener, true);

  return () => {
    element.removeEventListener('pointermove', onMove, true);
    element.removeEventListener('pointerdown', onDown, true);
    element.removeEventListener('pointerup', onUp, true);
    element.removeEventListener('pointercancel', onCancel, true);
    element.removeEventListener('lostpointercapture', onCancel as EventListener, true);
  };
}
