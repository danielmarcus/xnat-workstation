/**
 * CornerstoneViewport — thin React wrapper that delegates all Cornerstone3D
 * operations to the service layer and wires viewport events to Zustand stores.
 *
 * Each instance manages one panel (identified by panelId). Multiple instances
 * can coexist in a ViewportGrid, sharing a single RenderingEngine and ToolGroup.
 *
 * This component:
 * 1. Mounts a DOM element for the viewport
 * 2. Creates/destroys the viewport via viewportService
 * 3. Adds/removes itself from the shared tool group via toolService
 * 4. Listens to Cornerstone events and pushes per-panel state to stores
 * 5. Loads images when imageIds prop changes
 */
import { useEffect, useRef, useState } from 'react';
import { Enums } from '@cornerstonejs/core';
import { viewportService } from '../../lib/cornerstone/viewportService';
import { toolService } from '../../lib/cornerstone/toolService';
import { metadataService } from '../../lib/cornerstone/metadataService';
import { useViewerStore } from '../../stores/viewerStore';
import { useMetadataStore } from '../../stores/metadataStore';

interface CornerstoneViewportProps {
  panelId: string;
  imageIds: string[];
}

export default function CornerstoneViewport({ panelId, imageIds }: CornerstoneViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<string>('Initializing...');
  const [error, setError] = useState<string | null>(null);

  // ─── Setup / Teardown ──────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || imageIds.length === 0) return;

    let cancelled = false;
    const element = containerRef.current;

    async function setup() {
      try {
        setStatus('Creating viewport...');
        setError(null);

        // Wait for element to have non-zero dimensions before creating the
        // viewport. On first mount the element may not be laid out yet.
        for (let i = 0; i < 20; i++) {
          if (element.clientWidth > 0 && element.clientHeight > 0) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (cancelled) return;

        // Initialize panel state in stores
        useViewerStore.getState()._initPanel(panelId);

        // Create viewport via service (uses panelId as the Cornerstone viewport ID)
        viewportService.createViewport(panelId, element);

        // Add this viewport to the shared tool group
        toolService.addViewport(panelId);

        if (cancelled) return;

        // Wire Cornerstone events to stores (scoped by panelId)
        wireEvents(element, panelId);

        // Load images
        setStatus(`Loading ${imageIds.length} images...`);
        await viewportService.loadStack(panelId, imageIds);

        if (cancelled) return;

        // Ensure the rendering engine knows the current element size,
        // then reset camera to fit-to-canvas. This fixes zoom issues when
        // the viewport was created while the layout was still settling.
        viewportService.resize();
        const viewport = viewportService.getViewport(panelId);
        if (viewport) {
          viewport.resetCamera();
          viewport.render();
        }

        // Read initial state after first image loads
        if (viewport) {
          // Initial image index
          const currentIdx = viewport.getCurrentImageIdIndex();
          const total = viewport.getImageIds().length;
          useViewerStore.getState()._updateImageIndex(panelId, currentIdx, total);

          // Initial zoom
          useViewerStore.getState()._updateZoom(panelId, viewportService.getZoom(panelId));

          // Initial VOI
          const props = viewport.getProperties();
          if (props.voiRange) {
            const ww = props.voiRange.upper - props.voiRange.lower;
            const wc = props.voiRange.lower + ww / 2;
            useViewerStore.getState()._updateVOI(panelId, ww, wc);
          }

          // Initial metadata
          const currentImageId = viewport.getCurrentImageId();
          if (currentImageId) {
            const overlay = metadataService.getOverlayData(currentImageId);
            useMetadataStore.getState()._updateOverlay(panelId, overlay);

            // Image dimensions
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

        setStatus(`Loaded ${imageIds.length} images`);
      } catch (err) {
        console.error(`[CornerstoneViewport:${panelId}] Setup error:`, err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setStatus('Error');
        }
      }
    }

    setup();

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      viewportService.resize();
    });
    resizeObserver.observe(element);

    return () => {
      cancelled = true;
      resizeObserver.disconnect();

      // Stop cine if playing for this panel
      useViewerStore.getState().stopCine(panelId);

      // Remove from tool group before destroying viewport
      toolService.removeViewport(panelId);
      viewportService.destroyViewport(panelId);

      // Clean up per-panel store state
      useViewerStore.getState()._destroyPanel(panelId);
      useMetadataStore.getState()._clearOverlay(panelId);
    };
  }, [panelId, imageIds]);

  return (
    <div className="relative w-full h-full bg-black">
      <div
        ref={containerRef}
        className="w-full h-full"
        onContextMenu={(e) => e.preventDefault()}
      />
      {/* Status overlay — only shown when no images or loading */}
      {(imageIds.length === 0 || status === 'Error') && (
        <div className="absolute bottom-2 left-2 text-xs text-zinc-400">
          {status}
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <div className="bg-red-950 border border-red-800 text-red-200 px-4 py-3 rounded max-w-md">
            <p className="font-semibold">Viewer Error</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Event Wiring ──────────────────────────────────────────────

function wireEvents(element: HTMLDivElement, panelId: string): void {
  const Events = Enums.Events;

  // VOI changed (user dragged W/L or preset applied)
  element.addEventListener(Events.VOI_MODIFIED, ((e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail?.range) {
      const { lower, upper } = detail.range;
      const ww = upper - lower;
      const wc = lower + ww / 2;
      useViewerStore.getState()._updateVOI(panelId, ww, wc);
    }
  }) as EventListener);

  // New image displayed (scroll)
  element.addEventListener(Events.STACK_NEW_IMAGE, ((e: Event) => {
    const detail = (e as CustomEvent).detail;
    const imageIdIndex = detail?.imageIdIndex ?? 0;
    const viewport = viewportService.getViewport(panelId);
    const total = viewport?.getImageIds().length ?? 0;

    useViewerStore.getState()._updateImageIndex(panelId, imageIdIndex, total);

    // Update metadata for the new slice
    const imageId = detail?.imageId ?? viewport?.getCurrentImageId();
    if (imageId) {
      const overlay = metadataService.getOverlayData(imageId);
      useMetadataStore.getState()._updateOverlay(panelId, overlay);
    }
  }) as EventListener);

  // Camera modified (zoom, pan, rotation changed)
  element.addEventListener(Events.CAMERA_MODIFIED, (() => {
    useViewerStore.getState()._updateZoom(panelId, viewportService.getZoom(panelId));
  }) as EventListener);

  // ─── Wheel / trackpad scroll handler ────────────────────────
  // We handle all scroll input ourselves (StackScrollTool is Disabled).
  // Trackpads fire many small deltaY values with momentum, so we
  // accumulate them and trigger a scroll when the threshold is crossed.
  let wheelAccum = 0;
  const WHEEL_THRESHOLD = 50; // pixels of accumulated deltaY per slice step

  element.addEventListener('wheel', (e: WheelEvent) => {
    // Don't handle if Ctrl/Meta is held (pinch-zoom on trackpad)
    if (e.ctrlKey || e.metaKey) return;

    e.preventDefault();

    wheelAccum += e.deltaY;

    if (Math.abs(wheelAccum) >= WHEEL_THRESHOLD) {
      const steps = Math.trunc(wheelAccum / WHEEL_THRESHOLD);
      wheelAccum -= steps * WHEEL_THRESHOLD;
      viewportService.scroll(panelId, steps);
    }
  }, { passive: false });
}
