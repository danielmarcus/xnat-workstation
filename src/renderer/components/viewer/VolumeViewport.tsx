/**
 * VolumeViewport — minimum-viable volume-mode rendering surface.
 *
 * Used by `Viewport.tsx` when the multi-viewport flag is on AND the
 * stack-eligibility predicate returns 'volume'. Renders an ORTHOGRAPHIC
 * volume viewport backed by the shared-volume cache (per design §1.5).
 *
 * Phase 1.4b — the basic mount / load / unmount cycle. Slice navigation,
 * cine, click-to-select, full event wiring, and crosshair sync land in
 * subsequent commits as the volume path matures. For now this is enough
 * to render volumetric data on a panel and attach segmentation overlays.
 *
 * Crucially: on unmount we release the shared volume, so refcounted
 * cleanup works correctly when panels are closed or layouts change.
 */
import { useEffect, useRef, useState } from 'react';
import { metaData } from '@cornerstonejs/core';
import { viewportService } from '../../lib/cornerstone/viewportService';
import { volumeService } from '../../lib/cornerstone/volumeService';
import { toolService } from '../../lib/cornerstone/toolService';
import { segmentationManager } from '../../lib/segmentation/segmentationManagerSingleton';
import { useViewerStore } from '../../stores/viewerStore';

interface VolumeViewportProps {
  panelId: string;
  imageIds: string[];
}

export default function VolumeViewport({ panelId, imageIds }: VolumeViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const scanId = useViewerStore((s) => s.panelScanMap[panelId] ?? '');

  useEffect(() => {
    if (!containerRef.current || imageIds.length === 0 || !scanId) return;

    let cancelled = false;
    const element = containerRef.current;
    let releasedFoR: string | null = null;

    async function setup(): Promise<void> {
      try {
        setError(null);

        // Wait for layout — element may not have dimensions yet.
        for (let i = 0; i < 20; i++) {
          if (element.clientWidth > 0 && element.clientHeight > 0) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (cancelled) return;

        // Resolve FrameOfReferenceUID from the first image's plane metadata.
        const planeMeta = metaData.get('imagePlaneModule', imageIds[0]) as
          | { frameOfReferenceUID?: string }
          | undefined;
        const frameOfReferenceUID = planeMeta?.frameOfReferenceUID ?? '';
        if (!frameOfReferenceUID) {
          setError('No FrameOfReferenceUID on source image — cannot create volume viewport.');
          return;
        }
        releasedFoR = frameOfReferenceUID;

        // Initialize panel state in stores
        useViewerStore.getState()._initPanel(panelId);

        // Create the volume viewport + bind shared volume.
        // Falls through to stack mode internally if the eligibility
        // predicate disagrees with our outer routing — that's a defensive
        // fallback, not a conflict.
        await viewportService.createViewportForImages(
          panelId,
          element,
          imageIds,
          { scanId, frameOfReferenceUID },
          'AXIAL',
        );

        if (cancelled) return;

        // Add to the shared primary tool group.
        toolService.addViewport(panelId);

        // Resize to settle the camera now that the element has dimensions.
        viewportService.resize();

        // Attach any visible segmentations for this scan.
        if (!cancelled) {
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

    return () => {
      cancelled = true;
      toolService.removeViewport(panelId);
      viewportService.destroyViewport(panelId);
      if (releasedFoR && scanId) {
        volumeService.releaseSharedVolume(scanId, releasedFoR);
      }
      useViewerStore.getState()._destroyPanel(panelId);
    };
  }, [panelId, imageIds, scanId]);

  return (
    <div
      data-testid={`volume-viewport:${panelId}`}
      className="relative w-full h-full bg-black"
    >
      <div
        ref={containerRef}
        data-testid={`volume-viewport-canvas:${panelId}`}
        className="w-full h-full"
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
    </div>
  );
}
