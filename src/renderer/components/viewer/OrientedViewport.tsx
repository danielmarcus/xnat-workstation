/**
 * OrientedViewport — per-panel orthographic volume viewport used by the
 * regular ViewportGrid when a panel orientation is set to Axial/Sagittal/Coronal.
 *
 * Unlike global MPR mode, this component uses the primary tool group so users
 * can draw/edit annotations directly in any selected viewing plane.
 */
import { useEffect, useRef, useState } from 'react';
import { Enums } from '@cornerstonejs/core';
import { mprService } from '../../lib/cornerstone/mprService';
import { volumeService } from '../../lib/cornerstone/volumeService';
import { viewportService } from '../../lib/cornerstone/viewportService';
import { toolService } from '../../lib/cornerstone/toolService';
import { crosshairSyncService } from '../../lib/cornerstone/crosshairSyncService';
import { wireCrosshairPointerHandlers } from '../../lib/cornerstone/crosshairGeometry';
import { segmentationManager } from '../../lib/segmentation/segmentationManagerSingleton';
import { viewportReadyService } from '../../lib/cornerstone/viewportReadyService';
import { useViewerStore } from '../../stores/viewerStore';
import { ToolName, type MPRPlane } from '@shared/types/viewer';

interface OrientedViewportProps {
  panelId: string;
  imageIds: string[];
  plane: MPRPlane;
}

export default function OrientedViewport({ panelId, imageIds, plane }: OrientedViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const volumeIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState('Initializing...');
  const [error, setError] = useState<string | null>(null);
  const activeTool = useViewerStore((s) => s.activeTool);
  const cursorClass = activeTool === ToolName.Crosshairs ? 'cursor-crosshair' : '';

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const cursor = activeTool === ToolName.Crosshairs ? 'crosshair' : '';
    element.style.cursor = cursor;
    const canvas = element.querySelector('canvas') as HTMLCanvasElement | null;
    if (canvas) {
      canvas.style.cursor = cursor;
    }
  }, [activeTool]);

  useEffect(() => {
    if (!containerRef.current || imageIds.length === 0) return;

    let cancelled = false;
    const element = containerRef.current;

    async function setup() {
      try {
        setStatus('Creating oriented viewport...');
        setError(null);
        const epochAtSetup = viewportReadyService.getEpoch(panelId);

        for (let i = 0; i < 20; i++) {
          if (element.clientWidth > 0 && element.clientHeight > 0) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (cancelled) return;

        useViewerStore.getState()._initPanel(panelId);

        const volumeId = volumeService.generateId();
        volumeIdRef.current = volumeId;
        await volumeService.create(volumeId, imageIds);
        if (cancelled) return;

        mprService.createViewport(panelId, element, plane);
        toolService.addViewport(panelId);
        wireEvents(element, panelId);

        setStatus(`Loading ${imageIds.length} images...`);
        await mprService.setVolume(panelId, volumeId);
        if (cancelled) return;

        // Load volume progressively in the background.
        void volumeService.load(volumeId).catch((err) => {
          console.warn(`[OrientedViewport:${panelId}] Volume streaming load warning:`, err);
        });

        viewportService.resize();
        mprService.resetCamera(panelId);
        syncSliceState(panelId);
        setStatus(`Loaded ${imageIds.length} images`);

        // Signal readiness as soon as viewport + stack are usable.
        // Re-attaching overlays happens after this and should not block
        // other async flows waiting on panel readiness.
        if (!cancelled) {
          viewportReadyService.markReady(panelId, epochAtSetup);
        }

        // Switching STACK <-> ORTHOGRAPHIC can leave stale representation state
        // on the reused viewportId. Detach first, then re-attach deterministically.
        segmentationManager.removeSegmentationsFromViewport(panelId);

        // Re-attach overlays that belong on this panel/source scan.
        await segmentationManager.attachVisibleSegmentationsToViewport(panelId);
      } catch (err) {
        console.error(`[OrientedViewport:${panelId}] Setup error:`, err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setStatus('Error');
        }
      }
    }

    setup();

    const resizeObserver = new ResizeObserver(() => {
      viewportService.resize();
    });
    resizeObserver.observe(element);

    return () => {
      cancelled = true;
      resizeObserver.disconnect();

      useViewerStore.getState().stopCine(panelId);
      toolService.removeViewport(panelId);
      mprService.destroyViewport(panelId);

      if (volumeIdRef.current) {
        volumeService.destroy(volumeIdRef.current);
        volumeIdRef.current = null;
      }

      useViewerStore.getState()._destroyPanel(panelId);
    };
  }, [imageIds, panelId, plane]);

  return (
    <div className={`relative w-full h-full bg-black ${cursorClass}`}>
      <div
        ref={containerRef}
        className={`w-full h-full ${cursorClass}`}
        onContextMenu={(e) => e.preventDefault()}
      />
      {(imageIds.length === 0 || status === 'Error') && (
        <div className="absolute bottom-2 left-2 text-xs text-zinc-400">
          {status}
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <div className="bg-red-950 border border-red-800 text-red-200 px-4 py-3 rounded max-w-md">
            <p className="font-semibold text-sm">Viewport Error</p>
            <p className="text-xs mt-1">{error}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function syncSliceState(panelId: string): void {
  const sliceInfo = mprService.getSliceInfo(panelId);
  useViewerStore.getState()._updateMPRSlice(panelId, sliceInfo.sliceIndex, sliceInfo.totalSlices);
  useViewerStore.getState()._updateImageIndex(panelId, sliceInfo.sliceIndex, sliceInfo.totalSlices);
  useViewerStore.getState()._updateZoom(panelId, mprService.getZoom(panelId));

  const viewport = mprService.getViewport(panelId) as any;
  const imageData = viewport?.getImageData?.();
  const dims = imageData?.dimensions;
  if (Array.isArray(dims) && dims.length >= 2) {
    useViewerStore.getState()._updateImageDimensions(panelId, Number(dims[0]) || 0, Number(dims[1]) || 0);
  }
}

function wireEvents(element: HTMLDivElement, panelId: string): void {
  const Events = Enums.Events;

  element.addEventListener(Events.VOI_MODIFIED, ((e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail?.range) {
      const { lower, upper } = detail.range;
      const ww = upper - lower;
      const wc = lower + ww / 2;
      useViewerStore.getState()._updateVOI(panelId, ww, wc);
    }
  }) as EventListener);

  element.addEventListener(Events.CAMERA_MODIFIED, (() => {
    syncSliceState(panelId);
  }) as EventListener);

  let wheelAccum = 0;
  const WHEEL_THRESHOLD = 50;

  element.addEventListener('wheel', (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    wheelAccum += e.deltaY;

    if (Math.abs(wheelAccum) >= WHEEL_THRESHOLD) {
      const steps = Math.trunc(wheelAccum / WHEEL_THRESHOLD);
      wheelAccum -= steps * WHEEL_THRESHOLD;
      mprService.scroll(panelId, steps);
    }
  }, { passive: false });

  wireCrosshairPointerHandlers({
    element,
    panelId,
    isCrosshairActive: () => useViewerStore.getState().activeTool === ToolName.Crosshairs,
    onWorldPoint: (point) => crosshairSyncService.syncFromViewport(panelId, point),
  });
}
