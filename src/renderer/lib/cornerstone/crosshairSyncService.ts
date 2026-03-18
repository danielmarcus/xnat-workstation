import { metaData } from '@cornerstonejs/core';
import { wadouri } from '@cornerstonejs/dicom-image-loader';
import { useViewerStore } from '../../stores/viewerStore';
import { viewportService } from './viewportService';
import { mprService } from './mprService';
import { pLimit } from '../util/pLimit';
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

/**
 * Parse a DICOM multi-valued numeric string (e.g. "1.0\\2.0\\3.0") into an
 * array of numbers. Returns null if parsing fails.
 */
function parseDicomNumericString(value: string | undefined | null, expectedLength: number): number[] | null {
  if (!value) return null;
  const parts = value.split('\\').map(Number);
  if (parts.length < expectedLength || !parts.every(Number.isFinite)) return null;
  return parts;
}

function getImagePlane(imageId: string): { ipp: Point3; normal: Point3 } | null {
  // Primary path: Cornerstone metadata provider (available after image decode).
  const imagePlane = metaData.get('imagePlaneModule', imageId) as
    | { imagePositionPatient?: number[]; imageOrientationPatient?: number[] }
    | undefined;
  let ipp = imagePlane?.imagePositionPatient;
  let iop = imagePlane?.imageOrientationPatient;

  // Fallback: read directly from the wadouri dataset cache.
  // After dataSetCacheManager.load(), the raw DICOM dataset is cached but the
  // Cornerstone metadata provider may not yet expose imagePlaneModule.
  if (!Array.isArray(ipp) || ipp.length < 3 || !Array.isArray(iop) || iop.length < 6) {
    try {
      const uri = toWadouriUri(imageId);
      if (wadouri.dataSetCacheManager.isLoaded(uri)) {
        const dataSet = wadouri.dataSetCacheManager.get(uri);
        const rawIpp = parseDicomNumericString(dataSet?.string?.('x00200032'), 3);
        const rawIop = parseDicomNumericString(dataSet?.string?.('x00200037'), 6);
        if (rawIpp) ipp = rawIpp;
        if (rawIop) iop = rawIop;
      }
    } catch {
      // Ignore dataset cache errors.
    }
  }

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

// ---------------------------------------------------------------------------
// Metadata pre-loading for stack viewports
// ---------------------------------------------------------------------------

/** Tracks which panels have had their image metadata pre-loaded. */
const metadataLoadedPanels = new Set<string>();

/** In-flight metadata pre-load promises (avoids duplicate concurrent loads). */
const metadataLoadInFlight = new Map<string, Promise<void>>();

function toWadouriUri(imageId: string): string {
  return imageId.startsWith('wadouri:') ? imageId.slice(8) : imageId;
}

/**
 * Pre-load DICOM headers for all images in a stack so that imagePlaneModule
 * metadata (imagePositionPatient, imageOrientationPatient) is available for
 * geometric operations like crosshair sync.
 *
 * Uses the wadouri dataSetCacheManager — the same mechanism used by
 * sortImageIdsByDicomMetadata in dicomwebLoader.
 */
async function ensureStackMetadata(panelId: string, imageIds: string[]): Promise<void> {
  if (metadataLoadedPanels.has(panelId)) return;

  const existing = metadataLoadInFlight.get(panelId);
  if (existing) {
    await existing;
    return;
  }

  const promise = (async () => {
    const limit = pLimit(12);
    let loaded = 0;
    await Promise.all(
      imageIds.map((imageId) =>
        limit(async () => {
          try {
            const uri = toWadouriUri(imageId);
            if (!wadouri.dataSetCacheManager.isLoaded(uri)) {
              await wadouri.dataSetCacheManager.load(uri, undefined as any, imageId);
            }
            loaded++;
          } catch {
            // Partial failures are tolerable; we'll still get most slices.
          }
        }),
      ),
    );
    metadataLoadedPanels.add(panelId);
  })();

  metadataLoadInFlight.set(panelId, promise);
  try {
    await promise;
  } finally {
    metadataLoadInFlight.delete(panelId);
  }
}

// ---------------------------------------------------------------------------
// Sync service
// ---------------------------------------------------------------------------

/**
 * Synchronously sync a single target panel using geometric slice matching.
 * Returns true if the sync succeeded, false if metadata was insufficient.
 */
function syncStackPanel(
  panelId: string,
  imageIds: string[],
  worldPoint: Point3,
  store: ReturnType<typeof useViewerStore.getState>,
): boolean {
  const targetIndex = findNearestStackIndex(imageIds, worldPoint);
  if (targetIndex == null) return false;

  store._requestImageIndex(panelId, targetIndex, imageIds.length);
  viewportService.scrollToIndex(panelId, targetIndex);

  // Pan the viewport to keep the crosshair point visible in-plane.
  const viewport = getViewportForPanel(panelId) as AnyViewport | null;
  if (viewport) {
    keepPointVisibleByPanning(panelId, viewport, worldPoint);
    viewport.render?.();
  }
  return true;
}

export const crosshairSyncService = {
  /**
   * Call when a panel's images change (e.g. scan unloaded) so that stale
   * metadata-loaded state is cleared.
   */
  invalidatePanel(panelId: string): void {
    metadataLoadedPanels.delete(panelId);
  },

  /**
   * Publish crosshair coordinate globally and sync compatible viewports.
   *
   * For MPR/volume viewports: uses viewport-native `jumpToWorld`.
   * For stack viewports: uses geometric slice matching via imagePlaneModule
   * metadata. If metadata hasn't been pre-loaded yet, triggers an async
   * pre-load and retries.
   */
  syncFromViewport(sourcePanelId: string, worldPoint: Point3): void {
    try {
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

      // Determine whether the target is a volume (MPR/oriented) or stack viewport.
      const vpType = (targetViewport as any)?.type as string | undefined;
      const isVolumeViewport = vpType != null && vpType !== 'stack';

      if (isVolumeViewport) {
        // Volume viewports have full metadata in the volume — jumpToWorld works reliably.
        if (typeof targetViewport.jumpToWorld === 'function') {
          try {
            const jumped = targetViewport.jumpToWorld(worldPoint);
            if (jumped) {
              keepPointVisibleByPanning(panelId, targetViewport, worldPoint);
              targetViewport.render?.();
              if (typeof targetViewport.getCurrentImageIdIndex === 'function') {
                const idx = targetViewport.getCurrentImageIdIndex();
                if (Number.isFinite(idx) && imageIds.length > 0) {
                  const clamped = Math.max(0, Math.min(imageIds.length - 1, Number(idx)));
                  store._requestImageIndex(panelId, clamped, imageIds.length);
                }
              }
              continue;
            }
          } catch (err) {
            console.warn('[crosshairSync] volume jumpToWorld error', panelId, err);
            // Fall through to stack-index fallback.
          }
        }
      }

      // Stack viewport path: use geometric slice matching.
      // This requires imagePlaneModule metadata for all images.
      // If metadata hasn't been pre-loaded yet, trigger async pre-load
      // and retry — the initial sync with partial metadata is unreliable.
      if (!metadataLoadedPanels.has(panelId)) {
        ensureStackMetadata(panelId, imageIds).then(() => {
          const latestStore = useViewerStore.getState();
          const latestPoint = latestStore.crosshairWorldPoint;
          if (!latestPoint) return;
          const latestImageIds = latestStore.panelImageIdsMap[panelId];
          if (!latestImageIds || latestImageIds.length === 0) return;
          syncStackPanel(panelId, latestImageIds, latestPoint, latestStore);
        });
      } else {
        syncStackPanel(panelId, imageIds, worldPoint, store);
      }
    }
    } catch (err) {
      console.error('[crosshairSync] syncFromViewport ERROR', err);
    }
  },
};
