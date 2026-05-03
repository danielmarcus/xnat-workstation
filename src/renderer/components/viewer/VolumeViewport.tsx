/**
 * VolumeViewport — volume-mode rendering surface for the multi-viewport rewrite.
 *
 * Used by `Viewport.tsx` when the multi-viewport flag is on AND the
 * stack-eligibility predicate returns 'volume'. Renders an ORTHOGRAPHIC
 * volume viewport backed by the shared-volume cache (per design §1.5).
 *
 * Mirrors the event/state surface of `StackViewport.tsx` but with
 * volume-specific event names and APIs:
 *   - VOLUME_NEW_IMAGE (instead of STACK_NEW_IMAGE) for slice changes.
 *   - viewport.scroll(delta) for wheel handling — same API on both types.
 *   - getCurrentImageId() returns the source imageId for the visible slice
 *     (per design §1.1: per-frame metadata in volume mode).
 *
 * On unmount: removes from tool group, destroys the viewport, releases
 * the shared volume (refcount-aware), tears down panel state.
 */
import { useEffect, useRef, useState } from 'react';
import { Enums, cache, imageLoader } from '@cornerstonejs/core';
import { annotation as csAnnotation } from '@cornerstonejs/tools';
import { metaData } from '@cornerstonejs/core';
import { viewportService } from '../../lib/cornerstone/viewportService';
import { volumeService } from '../../lib/cornerstone/volumeService';
import { toolService } from '../../lib/cornerstone/toolService';
import { metadataService } from '../../lib/cornerstone/metadataService';
import { viewportReadyService } from '../../lib/cornerstone/viewportReadyService';
import { crosshairSyncService } from '../../lib/cornerstone/crosshairSyncService';
import { imagePreloadService } from '../../lib/cornerstone/imagePreloadService';
import { wireCrosshairPointerHandlers } from '../../lib/cornerstone/crosshairGeometry';
import { findContourAtCanvasPoint } from '../../lib/cornerstone/contourHitTest';
import { wireContourHoverDetection } from '../../lib/cornerstone/contourHoverSync';
import { segmentationManager } from '../../lib/segmentation/segmentationManagerSingleton';
import { useViewerStore } from '../../stores/viewerStore';
import { useMetadataStore } from '../../stores/metadataStore';
import { ToolName } from '@shared/types/viewer';
import { ViewportHint } from './ViewportHint';

interface VolumeViewportProps {
  panelId: string;
  imageIds: string[];
  /**
   * Volume orientation. Default 'AXIAL'. When the panel is part of an MPR
   * preset slot, ViewportGrid passes 'SAGITTAL' or 'CORONAL' here.
   */
  orientation?: 'AXIAL' | 'SAGITTAL' | 'CORONAL';
}

function readFrameOfReferenceUID(imageId: string): string | null {
  const planeMeta = metaData.get('imagePlaneModule', imageId) as
    | { frameOfReferenceUID?: string }
    | undefined;
  const value = planeMeta?.frameOfReferenceUID;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export default function VolumeViewport({ panelId, imageIds, orientation = 'AXIAL' }: VolumeViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const scanId = useViewerStore((s) => s.panelScanMap[panelId] ?? '');
  const activeTool = useViewerStore((s) => s.activeTool);
  const renderedImageIndex = useViewerStore((s) => s.viewports[panelId]?.imageIndex ?? 0);
  const requestedImageIndex = useViewerStore((s) => s.viewports[panelId]?.requestedImageIndex ?? null);
  const cursorClass = activeTool === ToolName.Crosshairs ? 'cursor-crosshair' : '';

  useEffect(() => {
    if (!containerRef.current || imageIds.length === 0 || !scanId) return;

    let cancelled = false;
    let disposeEvents: (() => void) | null = null;
    const element = containerRef.current;
    let releasedFoR: string | null = null;

    async function setup(): Promise<void> {
      try {
        setError(null);

        const epochAtSetup = viewportReadyService.getEpoch(panelId);

        // Wait for layout
        for (let i = 0; i < 20; i++) {
          if (element.clientWidth > 0 && element.clientHeight > 0) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (cancelled) return;

        // Resolve FrameOfReferenceUID from first image plane metadata.
        // Cornerstone's metadata cache may be empty until the image is
        // actually loaded — pre-load the first image so plane metadata
        // (including FoR) becomes available.
        let frameOfReferenceUID = readFrameOfReferenceUID(imageIds[0]);
        if (!frameOfReferenceUID) {
          try {
            await imageLoader.loadAndCacheImage(imageIds[0]);
          } catch (loadErr) {
            console.warn(`[VolumeViewport:${panelId}] Failed to pre-load first image for FoR:`, loadErr);
          }
          if (cancelled) return;
          frameOfReferenceUID = readFrameOfReferenceUID(imageIds[0]);
        }
        if (!frameOfReferenceUID) {
          setError('No FrameOfReferenceUID on source image — cannot create volume viewport.');
          return;
        }
        releasedFoR = frameOfReferenceUID;

        useViewerStore.getState()._initPanel(panelId);

        await viewportService.createViewportForImages(
          panelId,
          element,
          imageIds,
          { scanId, frameOfReferenceUID },
          orientation,
        );

        if (cancelled) return;

        toolService.addViewport(panelId);

        // Wire events before any volume-driven reads so the first
        // slice/zoom callback updates the store correctly.
        disposeEvents = wireVolumeEvents(element, panelId);

        // Background pre-load remaining images for smooth scroll/sync.
        imagePreloadService.startPreload(panelId, imageIds);

        viewportService.resize();
        const viewport = viewportService.getVolumeViewport(panelId);
        if (viewport) {
          viewport.resetCamera();
          viewport.render();

          // Initial slice info
          const sliceIndex = viewport.getSliceIndex();
          const total = viewport.getNumberOfSlices();
          useViewerStore.getState()._updateImageIndex(panelId, sliceIndex, total);

          // Initial zoom (round to percent for display)
          useViewerStore.getState()._updateZoom(panelId, Math.round(viewport.getZoom() * 100));

          // Initial VOI
          const props = viewport.getProperties();
          if (props.voiRange) {
            const ww = props.voiRange.upper - props.voiRange.lower;
            const wc = props.voiRange.lower + ww / 2;
            useViewerStore.getState()._updateVOI(panelId, ww, wc);
          }

          // Initial metadata for the visible slice
          const currentImageId = viewport.getCurrentImageId();
          if (currentImageId) {
            const overlay = metadataService.getOverlayData(currentImageId);
            useMetadataStore.getState()._updateOverlay(panelId, overlay);
            const nativeOrientation = metadataService.getNativeOrientation(currentImageId);
            if (nativeOrientation) {
              useViewerStore.getState().setPanelNativeOrientation(panelId, nativeOrientation);
            }
            const imageData = viewport.getImageData();
            if (imageData) {
              useViewerStore.getState()._updateImageDimensions(
                panelId,
                imageData.dimensions[0],
                imageData.dimensions[1],
              );
            }
          }
        }

        // Signal readiness so segmentationManager can attach overlays.
        if (!cancelled) {
          viewportReadyService.markReady(panelId, epochAtSetup);
        }

        if (!cancelled) {
          segmentationManager.removeSegmentationsFromViewport(panelId);
          await segmentationManager.attachVisibleSegmentationsToViewport(panelId);
        }
      } catch (err) {
        console.error(`[VolumeViewport:${panelId}] Setup error:`, err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }

    void setup();

    const resizeObserver = new ResizeObserver(() => {
      viewportService.resize();
    });
    resizeObserver.observe(element);

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      disposeEvents?.();
      imagePreloadService.cancelPreload(panelId);
      useViewerStore.getState().stopCine(panelId);

      toolService.removeViewport(panelId);
      viewportService.destroyViewport(panelId);
      if (releasedFoR && scanId) {
        volumeService.releaseSharedVolume(scanId, releasedFoR);
      }
      useViewerStore.getState()._destroyPanel(panelId);
      useMetadataStore.getState()._clearOverlay(panelId);
    };
  }, [panelId, imageIds, scanId, orientation]);

  return (
    <div
      data-testid={`volume-viewport:${panelId}`}
      className={`relative w-full h-full bg-black ${cursorClass}`}
    >
      <div
        ref={containerRef}
        data-testid={`volume-viewport-canvas:${panelId}`}
        className={`w-full h-full ${cursorClass}`}
        onContextMenu={(e) => e.preventDefault()}
      />
      {error && (
        <div
          data-testid={`volume-viewport-error:${panelId}`}
          className="absolute inset-0 flex items-center justify-center bg-black/80"
        >
          <div className="bg-red-950 border border-red-800 text-red-200 px-4 py-3 rounded max-w-md">
            <p className="font-semibold">Viewer Error</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        </div>
      )}
      {(() => {
        const hasPendingSlice =
          requestedImageIndex !== null
          && requestedImageIndex !== renderedImageIndex
          && requestedImageIndex >= 0
          && requestedImageIndex < imageIds.length;
        if (!hasPendingSlice) return null;
        const pendingImageId = imageIds[requestedImageIndex];
        const isPendingLoaded = pendingImageId ? cache.isLoaded(pendingImageId) : true;
        if (isPendingLoaded) return null;
        return (
          <div
            data-testid={`volume-viewport-pending:${panelId}`}
            className="absolute left-1/2 -translate-x-1/2 bottom-2 px-2 py-1 rounded bg-black/50 text-zinc-200 text-[11px] pointer-events-none"
          >
            Slice loading...
          </div>
        );
      })()}
      <ViewportHint viewportId={panelId} />
    </div>
  );
}

// ─── Event wiring (volume-mode flavor) ──────────────────────────

function wireVolumeEvents(element: HTMLDivElement, panelId: string): () => void {
  const Events = Enums.Events;
  let pendingShiftScrollSync: { clientX: number; clientY: number } | null = null;

  // VOI changed
  element.addEventListener(Events.VOI_MODIFIED, ((e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail?.range) {
      const { lower, upper } = detail.range;
      const ww = upper - lower;
      const wc = lower + ww / 2;
      useViewerStore.getState()._updateVOI(panelId, ww, wc);
    }
  }) as EventListener);

  // New volume slice (volume-mode equivalent of STACK_NEW_IMAGE)
  element.addEventListener(Events.VOLUME_NEW_IMAGE, ((e: Event) => {
    const viewport = viewportService.getVolumeViewport(panelId);
    if (!viewport) return;

    const sliceIndex = viewport.getSliceIndex();
    const total = viewport.getNumberOfSlices();
    useViewerStore.getState()._updateImageIndex(panelId, sliceIndex, total);

    const detail = (e as CustomEvent).detail;
    const imageId = detail?.imageId ?? viewport.getCurrentImageId();
    if (imageId) {
      const overlay = metadataService.getOverlayData(imageId);
      useMetadataStore.getState()._updateOverlay(panelId, overlay);
      const nativeOrientation = metadataService.getNativeOrientation(imageId);
      if (nativeOrientation) {
        useViewerStore.getState().setPanelNativeOrientation(panelId, nativeOrientation);
      }
    }

    if (pendingShiftScrollSync) {
      const { clientX, clientY } = pendingShiftScrollSync;
      pendingShiftScrollSync = null;
      crosshairSyncService.syncFromClientPoint(panelId, clientX, clientY);
    }
  }) as EventListener);

  // Camera modified (zoom, pan, rotation)
  element.addEventListener(Events.CAMERA_MODIFIED, (() => {
    const viewport = viewportService.getVolumeViewport(panelId);
    if (!viewport) return;
    useViewerStore.getState()._updateZoom(panelId, Math.round(viewport.getZoom() * 100));
  }) as EventListener);

  // Wheel scroll — accumulated to avoid trackpad over-firing.
  let wheelAccum = 0;
  const WHEEL_THRESHOLD = 50;

  element.addEventListener('wheel', (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) return;
    e.preventDefault();

    const scrollDelta =
      Math.abs(e.deltaY) >= Math.abs(e.deltaX)
        ? e.deltaY
        : (e.shiftKey ? e.deltaX : 0);
    wheelAccum += scrollDelta;

    if (Math.abs(wheelAccum) >= WHEEL_THRESHOLD) {
      const steps = Math.trunc(wheelAccum / WHEEL_THRESHOLD);
      wheelAccum -= steps * WHEEL_THRESHOLD;

      const viewport = viewportService.getVolumeViewport(panelId);
      if (!viewport) return;

      const total = viewport.getNumberOfSlices();
      if (total <= 1) return;

      const baseIndex = viewport.getSliceIndex();
      const targetIndex = Math.max(0, Math.min(total - 1, baseIndex + steps));
      if (targetIndex !== baseIndex) {
        pendingShiftScrollSync = e.shiftKey ? { clientX: e.clientX, clientY: e.clientY } : null;
        useViewerStore.getState()._requestImageIndex(panelId, targetIndex, total);
        viewport.scroll(targetIndex - baseIndex);
      }
    }
  }, { passive: false });

  const disposeCrosshair = wireCrosshairPointerHandlers({
    element,
    panelId,
    isCrosshairActive: () => useViewerStore.getState().activeTool === ToolName.Crosshairs,
    onWorldPoint: (point) => crosshairSyncService.syncFromViewport(panelId, point),
  }) ?? (() => {});

  const onClick = (event: MouseEvent) => {
    if (event.button !== 0 || event.defaultPrevented) return;
    selectContourAnnotationAtCanvasPoint(panelId, element, event.clientX, event.clientY);
  };
  element.addEventListener('click', onClick);

  // Phase 3.5c-canvas: cursor over a contour highlights its row in the
  // list panel via useContainerSelectionStore.hoverMemberId.
  const disposeHover = wireContourHoverDetection(element, () =>
    viewportService.getVolumeViewport(panelId) as never,
  );

  return () => {
    element.removeEventListener('click', onClick);
    disposeCrosshair();
    disposeHover();
  };
}

function selectContourAnnotationAtCanvasPoint(
  panelId: string,
  element: HTMLDivElement,
  clientX: number,
  clientY: number,
): void {
  const viewport = viewportService.getVolumeViewport(panelId) as
    | {
        getCurrentImageId?: () => string | undefined;
        worldToCanvas?: (point: [number, number, number]) => [number, number];
      }
    | null;
  const rect = element.getBoundingClientRect();
  const canvasPoint: [number, number] = [clientX - rect.left, clientY - rect.top];
  const hit = findContourAtCanvasPoint(viewport ?? null, canvasPoint);
  if (hit?.annotationUID) {
    csAnnotation.selection.setAnnotationSelected?.(hit.annotationUID, true, false);
  }
}
