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

function normalizeSubjectKey(value: string | undefined | null): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function getPanelSubjectKey(
  store: ReturnType<typeof useViewerStore.getState>,
  panelId: string,
): string | null {
  const panelCtx = store.panelXnatContextMap?.[panelId] as { subjectId?: string } | undefined;
  return normalizeSubjectKey(panelCtx?.subjectId)
    ?? normalizeSubjectKey(store.panelSubjectLabelMap?.[panelId]);
}

function panelsShareKnownSubject(
  store: ReturnType<typeof useViewerStore.getState>,
  sourcePanelId: string,
  targetPanelId: string,
): boolean {
  const sourceSubject = getPanelSubjectKey(store, sourcePanelId);
  const targetSubject = getPanelSubjectKey(store, targetPanelId);
  return sourceSubject != null && targetSubject != null && sourceSubject === targetSubject;
}

function panelsHaveDifferentKnownSubjects(
  store: ReturnType<typeof useViewerStore.getState>,
  sourcePanelId: string,
  targetPanelId: string,
): boolean {
  const sourceSubject = getPanelSubjectKey(store, sourcePanelId);
  const targetSubject = getPanelSubjectKey(store, targetPanelId);
  return sourceSubject != null && targetSubject != null && sourceSubject !== targetSubject;
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
 * Ensure imagePlaneModule metadata is available for all images in a stack.
 *
 * When imagePreloadService has pre-loaded the images, metadata is already
 * available and this function returns quickly. Otherwise falls back to
 * downloading DICOM headers via the wadouri dataset cache.
 */
async function ensureStackMetadata(panelId: string, imageIds: string[]): Promise<void> {
  if (metadataLoadedPanels.has(panelId)) return;

  const existing = metadataLoadInFlight.get(panelId);
  if (existing) {
    await existing;
    return;
  }

  // Quick check: if most images already have metadata (from image preload),
  // we can mark as loaded immediately without any downloads.
  const missingMetadata = imageIds.filter((id) => !getImagePlane(id));
  if (missingMetadata.length === 0) {
    metadataLoadedPanels.add(panelId);
    return;
  }

  // Fallback: download headers for images still missing metadata.
  // This handles the case where the preload hasn't completed yet.
  const promise = (async () => {
    const limit = pLimit(12);
    await Promise.all(
      missingMetadata.map((imageId) =>
        limit(async () => {
          try {
            const uri = toWadouriUri(imageId);
            if (!wadouri.dataSetCacheManager.isLoaded(uri)) {
              await wadouri.dataSetCacheManager.load(uri, undefined as any, imageId);
            }
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
function syncPanelByGeometry(
  panelId: string,
  imageIds: string[],
  worldPoint: Point3,
  store: ReturnType<typeof useViewerStore.getState>,
  options?: { panToWorld?: boolean },
): boolean {
  const targetIndex = findNearestStackIndex(imageIds, worldPoint);
  if (targetIndex == null) return false;

  store._requestImageIndex(panelId, targetIndex, imageIds.length);
  const viewport = getViewportForPanel(panelId) as AnyViewport | null;
  const vpType = (viewport as { type?: string } | null)?.type;
  const isVolumeViewport = vpType != null && vpType !== 'stack';

  if (isVolumeViewport) {
    mprService.scrollToIndex(panelId, targetIndex);
  } else {
    viewportService.scrollToIndex(panelId, targetIndex);
  }

  // Only pan in world space when the source/target coordinate systems are compatible.
  if (viewport) {
    if (options?.panToWorld !== false) {
      keepPointVisibleByPanning(panelId, viewport, worldPoint);
    }
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

  /** Mark a panel's metadata as already loaded (for testing). */
  _markMetadataLoaded(panelId: string): void {
    metadataLoadedPanels.add(panelId);
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

    for (const [panelId, imageIds] of Object.entries(store.panelImageIdsMap)) {
      if (panelId === sourcePanelId || imageIds.length === 0) continue;
      const targetViewport = getViewportForPanel(panelId) as AnyViewport | null;
      if (!targetViewport) continue;

      if (panelsHaveDifferentKnownSubjects(store, sourcePanelId, panelId)) {
        console.warn(`[crosshairSync] Skipping ${panelId}: subject mismatch`);
        continue;
      }

      // Only skip if both FORs are known and genuinely differ (different anatomy).
      // When either FOR is unavailable (metadata not yet decoded), proceed with
      // sync rather than silently skipping — avoids race conditions with wadouri.
      const targetForUid = imageIds[0] ? getFrameOfReferenceUid(imageIds[0]) : null;
      const allowCrossSessionGeometryFallback =
        sourceForUid != null &&
        targetForUid != null &&
        sourceForUid !== targetForUid &&
        panelsShareKnownSubject(store, sourcePanelId, panelId);

      if (sourceForUid && targetForUid && sourceForUid !== targetForUid && !allowCrossSessionGeometryFallback) {
        console.warn(`[crosshairSync] Skipping ${panelId}: FOR mismatch (${sourceForUid} vs ${targetForUid})`);
        continue;
      }

      // Determine whether the target is a volume (MPR/oriented) or stack viewport.
      const vpType = (targetViewport as any)?.type as string | undefined;
      const isVolumeViewport = vpType != null && vpType !== 'stack';

      if (isVolumeViewport && !allowCrossSessionGeometryFallback) {
        // Volume viewports have full metadata in the volume — jumpToWorld works reliably.
        if (typeof targetViewport.jumpToWorld === 'function') {
          try {
            const jumped = targetViewport.jumpToWorld(worldPoint);
            if (jumped) {
              keepPointVisibleByPanning(panelId, targetViewport, worldPoint);
              targetViewport.render?.();
              // Use the volume viewport's own slice geometry for index tracking.
              // imageIds.length reflects acquisition slices, but oriented viewports
              // have a different slice count along the reoriented axis.
              const vp = targetViewport as any;
              if (typeof vp.getSliceIndex === 'function' && typeof vp.getNumberOfSlices === 'function') {
                const idx = vp.getSliceIndex() as number;
                const total = vp.getNumberOfSlices() as number;
                if (Number.isFinite(idx) && total > 0) {
                  store._requestImageIndex(panelId, Math.max(0, idx), total);
                }
              } else if (typeof targetViewport.getCurrentImageIdIndex === 'function') {
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
          }
        }
        // Do not fall through to geometric slice matching for volume viewports.
        // The acquisition-plane geometry is in a different coordinate frame than
        // the reoriented view, so stack-index fallback would scroll to the wrong
        // position (often resulting in a black viewport).
        continue;
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
          const latestSourcePanelId = latestStore.crosshairSourcePanelId;
          const latestSourceIds = latestSourcePanelId
            ? (latestStore.panelImageIdsMap[latestSourcePanelId] ?? [])
            : [];
          const latestSourceForUid = latestSourceIds[0] ? getFrameOfReferenceUid(latestSourceIds[0]) : null;
          const latestTargetForUid = latestImageIds[0] ? getFrameOfReferenceUid(latestImageIds[0]) : null;
          const panToWorld = !(
            latestSourcePanelId
            && latestSourceForUid
            && latestTargetForUid
            && latestSourceForUid !== latestTargetForUid
            && panelsShareKnownSubject(latestStore, latestSourcePanelId, panelId)
          );
          syncPanelByGeometry(panelId, latestImageIds, latestPoint, latestStore, { panToWorld });
        });
      } else {
        syncPanelByGeometry(panelId, imageIds, worldPoint, store, {
          panToWorld: !allowCrossSessionGeometryFallback,
        });
      }
    }
    } catch (err) {
      console.error('[crosshairSync] syncFromViewport ERROR', err);
    }
  },
};
