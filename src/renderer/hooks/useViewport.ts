/**
 * useViewport — the UI↔service seam for the unified viewport (Phase 1,
 * architecture §4.3/§5). Owns the Cornerstone wiring so the Viewport component
 * stays presentational: it creates the unified viewport (stack vs volume chosen
 * by data) on mount / series change and destroys it (releasing any shared
 * volume) on unmount. Components call this hook; they never touch the service or
 * Cornerstone directly.
 */
import { useEffect, useRef } from 'react';
import { viewportService } from '../lib/cornerstone/viewportService';
import { unifiedToolService } from '../lib/cornerstone/unifiedToolService';
import { unifiedSegService } from '../lib/cornerstone/unifiedSegService';
import { viewportReadyService } from '../lib/cornerstone/viewportReadyService';
import { metadataService } from '../lib/cornerstone/metadataService';
import { useViewerStore } from '../stores/viewerStore';
import { useMetadataStore } from '../stores/metadataStore';
import type { MPRPlane } from '@shared/types/viewer';

export interface UseViewportArgs {
  panelId: string;
  imageIds: string[];
  /** Volume-sharing key — same scanId+FoR ⇒ shared ImageVolume across panels. */
  scanId: string;
  frameOfReferenceUID?: string;
  /** For the volume path: which reformatted plane this panel shows. */
  orientation?: MPRPlane;
}

export function useViewport({
  panelId,
  imageIds,
  scanId,
  frameOfReferenceUID = '',
  orientation = 'AXIAL',
}: UseViewportArgs): { containerRef: React.RefObject<HTMLDivElement | null> } {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const seriesKey = imageIds.join('|');

  useEffect(() => {
    const el = containerRef.current;
    if (!el || imageIds.length === 0) return;

    let cancelled = false;
    let disposeSync: (() => void) | null = null;
    let lastImageId: string | null = null;

    // Initialize per-panel store state (cleared on unmount via _destroyPanel).
    useViewerStore.getState()._initPanel(panelId);

    // Pull viewport display state → stores so the overlay + toolbar stay live.
    // `kind` mirrors the old CornerstoneViewport event mapping: zoom on camera,
    // index + metadata only on a new image, W/L on VOI change. 'init' does all.
    const syncState = (kind: 'init' | 'voi' | 'image' | 'camera'): void => {
      const s = viewportService.readViewportState(panelId);
      if (!s) return;
      const store = useViewerStore.getState();
      store._updateZoom(panelId, s.zoom);
      if (kind === 'init' || kind === 'voi') {
        if (s.ww != null && s.wc != null) store._updateVOI(panelId, s.ww, s.wc);
      }
      if (kind === 'init' || kind === 'image' || kind === 'camera') {
        store._updateImageIndex(panelId, s.imageIndex, s.total);
        if (s.currentImageId && s.currentImageId !== lastImageId) {
          lastImageId = s.currentImageId;
          useMetadataStore.getState()._updateOverlay(panelId, metadataService.getOverlayData(s.currentImageId));
          const orient = metadataService.getNativeOrientation(s.currentImageId);
          if (orient) store.setPanelNativeOrientation(panelId, orient);
        }
      }
      if (kind === 'init' && s.width != null && s.height != null) {
        store._updateImageDimensions(panelId, s.width, s.height);
      }
    };

    viewportService
      .createUnifiedViewport(panelId, el, {
        scanId,
        frameOfReferenceUID,
        imageIds,
        meta: { imageCount: imageIds.length },
        orientation,
      })
      .then(() => {
        // Join the unified tool group once the viewport exists. Guard the async
        // gap against a fast unmount.
        if (cancelled) return;
        unifiedToolService.addViewport(panelId);
        // Re-attach any existing segmentations so structures survive layout swaps.
        unifiedSegService.attachExistingToViewport(panelId);
        // Wire display-state sync (events → stores) + read the initial state, so
        // slice index / W/L / zoom / metadata are live. Handles stack AND volume.
        disposeSync = viewportService.subscribeViewportEvents(panelId, el, syncState);
        syncState('init');
        // Signal viewport readiness for the CURRENT epoch (App bumps the epoch
        // when imageIds change, before this effect re-runs). SegmentationManager
        // .whenReady blocks on this for SEG/RTSTRUCT overlay attach.
        viewportReadyService.markReady(panelId, viewportReadyService.getEpoch(panelId));
      })
      .catch((err) => console.warn('[useViewport] create failed:', panelId, err));

    // Keep the viewport sized to its (possibly resizing) container.
    const resizeObserver = new ResizeObserver(() => viewportService.resize());
    resizeObserver.observe(el);

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      disposeSync?.();
      unifiedToolService.removeViewport(panelId);
      viewportService.destroyUnifiedViewport(panelId);
      // Clean up per-panel state so the stores don't leak orphaned panels.
      useViewerStore.getState().stopCine(panelId);
      useViewerStore.getState()._destroyPanel(panelId);
      useMetadataStore.getState()._clearOverlay(panelId);
    };
    // Recreate on panel, series, sharing-key, or plane change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelId, scanId, frameOfReferenceUID, orientation, seriesKey]);

  return { containerRef };
}
