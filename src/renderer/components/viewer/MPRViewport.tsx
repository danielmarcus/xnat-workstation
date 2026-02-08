/**
 * MPRViewport — React wrapper for a single ORTHOGRAPHIC volume viewport.
 *
 * Follows the same pattern as CornerstoneViewport but delegates to mprService
 * (volume viewports) and mprToolService (MPR tool group) instead of the stack
 * equivalents.
 *
 * Each MPRViewport renders one plane (Axial, Sagittal, or Coronal) with
 * orientation labels at the viewport edges.
 */
import { useEffect, useRef, useState } from 'react';
import { Enums } from '@cornerstonejs/core';
import { mprService } from '../../lib/cornerstone/mprService';
import { mprToolService } from '../../lib/cornerstone/mprToolService';
import { viewportService } from '../../lib/cornerstone/viewportService';
import { useViewerStore } from '../../stores/viewerStore';
import type { MPRPlane } from '@shared/types/viewer';

interface MPRViewportProps {
  panelId: string;
  volumeId: string;
  plane: MPRPlane;
}

// ─── Orientation Label Mapping ────────────────────────────────────

const ORIENTATION_LABELS: Record<MPRPlane, { top: string; bottom: string; left: string; right: string }> = {
  AXIAL:    { top: 'A', bottom: 'P', left: 'R', right: 'L' },
  SAGITTAL: { top: 'S', bottom: 'I', left: 'A', right: 'P' },
  CORONAL:  { top: 'S', bottom: 'I', left: 'R', right: 'L' },
};

const PLANE_LABELS: Record<MPRPlane, string> = {
  AXIAL: 'Axial',
  SAGITTAL: 'Sagittal',
  CORONAL: 'Coronal',
};

export default function MPRViewport({ panelId, volumeId, plane }: MPRViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  // Read MPR slice state from store
  const mprState = useViewerStore((s) => s.mprViewports[panelId]);
  const voiState = useViewerStore((s) => s.viewports[panelId]);

  // ─── Setup / Teardown ──────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;
    const element = containerRef.current;

    async function setup() {
      try {
        setError(null);

        // Wait for element to have non-zero dimensions
        for (let i = 0; i < 20; i++) {
          if (element.clientWidth > 0 && element.clientHeight > 0) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (cancelled) return;

        // Initialize panel state in stores (reuse existing store method)
        useViewerStore.getState()._initPanel(panelId);

        // Create the ORTHOGRAPHIC viewport
        mprService.createViewport(panelId, element, plane);

        // Add to MPR tool group
        mprToolService.addViewport(panelId);

        if (cancelled) return;

        // Wire events
        wireEvents(element, panelId);

        // Set the volume on this viewport
        await mprService.setVolume(panelId, volumeId);

        if (cancelled) return;

        // Resize and reset camera to fit
        viewportService.resize();
        mprService.resetCamera(panelId);

        // Initialize slice info in store
        const sliceInfo = mprService.getSliceInfo(panelId);
        useViewerStore.getState()._updateMPRSlice(panelId, sliceInfo.sliceIndex, sliceInfo.totalSlices);

        // Initialize zoom
        useViewerStore.getState()._updateZoom(panelId, mprService.getZoom(panelId));

        // Initialize VOI
        const viewport = mprService.getViewport(panelId);
        if (viewport) {
          const props = viewport.getProperties();
          if (props.voiRange) {
            const ww = props.voiRange.upper - props.voiRange.lower;
            const wc = props.voiRange.lower + ww / 2;
            useViewerStore.getState()._updateVOI(panelId, ww, wc);
          }
        }
      } catch (err) {
        console.error(`[MPRViewport:${panelId}] Setup error:`, err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
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

      // Remove from tool group before destroying viewport
      mprToolService.removeViewport(panelId);
      mprService.destroyViewport(panelId);

      // Clean up per-panel store state
      useViewerStore.getState()._destroyPanel(panelId);
    };
  }, [panelId, volumeId, plane]);

  const labels = ORIENTATION_LABELS[plane];
  const sliceIndex = mprState?.sliceIndex ?? 0;
  const totalSlices = mprState?.totalSlices ?? 0;
  const ww = voiState?.windowWidth ?? 0;
  const wc = voiState?.windowCenter ?? 0;

  return (
    <div className="relative w-full h-full bg-black">
      <div
        ref={containerRef}
        className="w-full h-full"
        onContextMenu={(e) => e.preventDefault()}
      />

      {/* Orientation labels overlay */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Plane label + slice info — top-left */}
        <div className="absolute top-1.5 left-2 text-[11px] text-yellow-400 font-semibold drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
          {PLANE_LABELS[plane]}
          {totalSlices > 0 && (
            <span className="text-zinc-400 font-normal ml-2 tabular-nums">
              {sliceIndex + 1} / {totalSlices}
            </span>
          )}
        </div>

        {/* W/L — top-right */}
        {ww > 0 && (
          <div className="absolute top-1.5 right-2 text-[10px] text-zinc-400 tabular-nums drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
            W: {ww} L: {wc}
          </div>
        )}

        {/* Orientation edge labels */}
        <span className="absolute top-1.5 left-1/2 -translate-x-1/2 text-[11px] font-bold text-zinc-300 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
          {labels.top}
        </span>
        <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 text-[11px] font-bold text-zinc-300 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
          {labels.bottom}
        </span>
        <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[11px] font-bold text-zinc-300 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
          {labels.left}
        </span>
        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[11px] font-bold text-zinc-300 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
          {labels.right}
        </span>
      </div>

      {/* Error overlay */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <div className="bg-red-950 border border-red-800 text-red-200 px-4 py-3 rounded max-w-md">
            <p className="font-semibold text-sm">MPR Error</p>
            <p className="text-xs mt-1">{error}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Event Wiring ──────────────────────────────────────────────

function wireEvents(element: HTMLDivElement, panelId: string): void {
  const Events = Enums.Events;

  // VOI changed (user dragged W/L)
  element.addEventListener(Events.VOI_MODIFIED, ((e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail?.range) {
      const { lower, upper } = detail.range;
      const ww = upper - lower;
      const wc = lower + ww / 2;
      useViewerStore.getState()._updateVOI(panelId, ww, wc);
    }
  }) as EventListener);

  // Camera modified (slice position, zoom, pan changed)
  element.addEventListener(Events.CAMERA_MODIFIED, (() => {
    // Update slice info
    const sliceInfo = mprService.getSliceInfo(panelId);
    useViewerStore.getState()._updateMPRSlice(panelId, sliceInfo.sliceIndex, sliceInfo.totalSlices);

    // Update zoom
    useViewerStore.getState()._updateZoom(panelId, mprService.getZoom(panelId));
  }) as EventListener);

  // ─── Trackpad / smooth scroll support ───────────────────────
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
}
