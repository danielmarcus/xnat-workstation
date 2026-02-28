import { metaData } from '@cornerstonejs/core';
import { useViewerStore } from '../../stores/viewerStore';
import { viewportService } from './viewportService';
import {
  getPanelDisplayPointForWorld,
  getViewportForPanel,
  getWorldPointFromClientPoint,
} from './crosshairGeometry';

type Point3 = [number, number, number];
type Point2 = [number, number];
type AnyViewport = {
  jumpToWorld?: (worldPos: Point3) => boolean;
  getCurrentImageIdIndex?: () => number;
  getCamera?: () => {
    position?: number[];
    focalPoint?: number[];
    viewPlaneNormal?: number[];
  };
  setCamera?: (camera: { position?: Point3; focalPoint?: Point3 }) => void;
  render?: () => void;
};

function dot(a: Point3, b: Point3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Point3, b: Point3): Point3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function sub(a: Point3, b: Point3): Point3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a: Point3, b: Point3): Point3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(a: Point3, s: number): Point3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function length(a: Point3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function toPoint3(value: number[] | Point3 | undefined | null): Point3 | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const x = Number(value[0]);
  const y = Number(value[1]);
  const z = Number(value[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return [x, y, z];
}

function keepPointVisibleByPanning(
  panelId: string,
  viewport: AnyViewport,
  worldPoint: Point3,
): void {
  if (typeof viewport.getCamera !== 'function' || typeof viewport.setCamera !== 'function') {
    return;
  }

  // Already visible in current view bounds: no pan needed.
  if (getPanelDisplayPointForWorld(panelId, worldPoint)) return;

  const panelEl = document.querySelector(`[data-panel-id="${panelId}"]`) as HTMLElement | null;
  if (!panelEl) return;
  const rect = panelEl.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const centerWorld = getWorldPointFromClientPoint(
    panelId,
    rect.left + rect.width / 2,
    rect.top + rect.height / 2,
  );
  if (!centerWorld) return;

  const camera = viewport.getCamera();
  const focal = toPoint3(camera?.focalPoint);
  const position = toPoint3(camera?.position);
  if (!focal || !position) return;

  let delta = sub(worldPoint, centerWorld);
  const normal = toPoint3(camera?.viewPlaneNormal);
  if (normal) {
    const nLen = length(normal);
    if (nLen > 0) {
      const n = scale(normal, 1 / nLen);
      // Pan only in-plane; avoid shifting along view normal.
      delta = sub(delta, scale(n, dot(delta, n)));
    }
  }

  if (length(delta) < 1e-6) return;
  viewport.setCamera({
    focalPoint: add(focal, delta),
    position: add(position, delta),
  });
}

function getSeriesUid(imageId: string): string | null {
  const series = metaData.get('generalSeriesModule', imageId) as { seriesInstanceUID?: string } | undefined;
  return series?.seriesInstanceUID ?? null;
}

function getFrameOfReferenceUid(imageId: string): string | null {
  const plane = metaData.get('imagePlaneModule', imageId) as { frameOfReferenceUID?: string } | undefined;
  return plane?.frameOfReferenceUID ?? null;
}

function getImagePlane(imageId: string): { ipp: Point3; normal: Point3 } | null {
  const imagePlane = metaData.get('imagePlaneModule', imageId) as
    | { imagePositionPatient?: number[]; imageOrientationPatient?: number[] }
    | undefined;
  const ipp = imagePlane?.imagePositionPatient;
  const iop = imagePlane?.imageOrientationPatient;
  if (!Array.isArray(ipp) || ipp.length < 3 || !Array.isArray(iop) || iop.length < 6) return null;
  const position: Point3 = [Number(ipp[0]), Number(ipp[1]), Number(ipp[2])];
  const row: Point3 = [Number(iop[0]), Number(iop[1]), Number(iop[2])];
  const col: Point3 = [Number(iop[3]), Number(iop[4]), Number(iop[5])];
  if (![...position, ...row, ...col].every((v) => Number.isFinite(v))) return null;
  return { ipp: position, normal: cross(row, col) };
}

function findNearestStackIndex(imageIds: string[], world: Point3): number | null {
  if (imageIds.length === 0) return null;
  const ref = getImagePlane(imageIds[0]);
  if (!ref) return null;
  const target = dot(ref.normal, world);
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < imageIds.length; i++) {
    const plane = getImagePlane(imageIds[i]);
    if (!plane) continue;
    const value = dot(ref.normal, plane.ipp);
    const dist = Math.abs(value - target);
    if (dist < bestDistance) {
      bestDistance = dist;
      bestIndex = i;
    }
  }
  return bestIndex >= 0 ? bestIndex : null;
}

export const crosshairSyncService = {
  /**
   * Publish crosshair coordinate globally and sync compatible viewports.
   * Primary path uses viewport-native world navigation (`jumpToWorld`) to avoid
   * orientation-specific math and preserve consistent geometric behavior.
   * Legacy stack-index fallback remains for non-jumpable targets.
   */
  syncFromViewport(sourcePanelId: string, worldPoint: Point3): void {
    const store = useViewerStore.getState();
    store.setCrosshairWorldPoint(worldPoint, sourcePanelId);

    const sourceIds = store.panelImageIdsMap[sourcePanelId] ?? [];
    const sourceForUid = sourceIds[0] ? getFrameOfReferenceUid(sourceIds[0]) : null;
    const sourceSeriesUid = sourceIds[0] ? getSeriesUid(sourceIds[0]) : null;

    for (const [panelId, imageIds] of Object.entries(store.panelImageIdsMap)) {
      if (panelId === sourcePanelId || imageIds.length === 0) continue;
      const targetViewport = getViewportForPanel(panelId) as AnyViewport | null;
      if (!targetViewport) continue;

      // Prefer FrameOfReference matching. Fall back to Series UID matching when needed.
      const targetForUid = imageIds[0] ? getFrameOfReferenceUid(imageIds[0]) : null;
      if (sourceForUid && targetForUid && sourceForUid !== targetForUid) continue;
      if (sourceForUid && !targetForUid) {
        const panelSeriesUid = imageIds[0] ? getSeriesUid(imageIds[0]) : null;
        if (!panelSeriesUid || (sourceSeriesUid && panelSeriesUid !== sourceSeriesUid)) continue;
      }

      // Best-practice path: use viewport-native world navigation.
      if (typeof targetViewport.jumpToWorld === 'function') {
        try {
          const jumped = targetViewport.jumpToWorld(worldPoint);
          if (jumped) {
            keepPointVisibleByPanning(panelId, targetViewport, worldPoint);
            targetViewport.render?.();
            // Keep stack requested-index state in sync so slider/status remain stable.
            if (typeof targetViewport.getCurrentImageIdIndex === 'function') {
              const idx = targetViewport.getCurrentImageIdIndex();
              if (Number.isFinite(idx) && imageIds.length > 0) {
                const clamped = Math.max(0, Math.min(imageIds.length - 1, Number(idx)));
                store._requestImageIndex(panelId, clamped, imageIds.length);
              }
            }
            continue;
          }
        } catch {
          // Fall through to stack-index fallback.
        }
      }

      // Fallback for legacy/non-jumpable targets.
      const targetIndex = findNearestStackIndex(imageIds, worldPoint);
      if (targetIndex == null) continue;
      store._requestImageIndex(panelId, targetIndex, imageIds.length);
      viewportService.scrollToIndex(panelId, targetIndex);
    }
  },
};
