/**
 * useViewport — the UI↔service seam for the unified viewport (Phase 1,
 * architecture §4.3/§5). Owns the Cornerstone wiring so the Viewport component
 * stays presentational: it creates the unified viewport (stack vs volume chosen
 * by data) on mount / series change and destroys it (releasing any shared
 * volume) on unmount. Components call this hook; they never touch the service or
 * Cornerstone directly.
 */
import { useEffect, useRef, useState } from 'react';
import { viewportService } from '../lib/cornerstone/viewportService';
import { unifiedToolService } from '../lib/cornerstone/unifiedToolService';
import { unifiedSegService } from '../lib/cornerstone/unifiedSegService';
import { viewportReadyService } from '../lib/cornerstone/viewportReadyService';
import { metadataService } from '../lib/cornerstone/metadataService';
import { wireCrosshairPointerHandlers, syncCrosshairToPanels } from '../lib/cornerstone/unifiedCrosshair';
import { useViewerStore } from '../stores/viewerStore';
import { useMetadataStore } from '../stores/metadataStore';
import { ToolName, type MPRPlane } from '@shared/types/viewer';

export interface UseViewportArgs {
  panelId: string;
  imageIds: string[];
  /** Volume-sharing key — same scanId+FoR ⇒ shared ImageVolume across panels. */
  scanId: string;
  frameOfReferenceUID?: string;
  /** Explicit plane to display (a user/stored choice). Undefined ⇒ resolve native. */
  orientation?: MPRPlane;
  /** Layout's designated plane (MPR preset / fallback). */
  layoutOrientation?: MPRPlane;
  /** Open in the scan's native plane when no explicit orientation is given. */
  preferNative?: boolean;
}

export function useViewport({
  panelId,
  imageIds,
  scanId,
  frameOfReferenceUID = '',
  orientation,
  layoutOrientation = 'AXIAL',
  preferNative = false,
}: UseViewportArgs): {
  containerRef: React.RefObject<HTMLDivElement | null>;
  loadState: 'loading' | 'ready' | 'error';
} {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const seriesKey = imageIds.join('|');

  useEffect(() => {
    const el = containerRef.current;
    if (!el || imageIds.length === 0) return;

    let cancelled = false;
    let disposeSync: (() => void) | null = null;
    let disposeCrosshair: (() => void) | null = null;
    let lastImageId: string | null = null;

    // Initialize per-panel store state (cleared on unmount via _destroyPanel).
    useViewerStore.getState()._initPanel(panelId);
    setLoadState('loading');

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
        layoutOrientation,
        preferNativeOrientation: preferNative,
      })
      .then((result) => {
        // Join the unified tool group once the viewport exists. Guard the async
        // gap against a fast unmount.
        if (cancelled) return;
        unifiedToolService.addViewport(panelId);
        // Re-attach any existing segmentations so structures survive layout swaps.
        unifiedSegService.attachExistingToViewport(panelId);
        // Wire display-state sync (events → stores) + read the initial state, so
        // slice index / W/L / zoom / metadata are live. Handles stack AND volume.
        disposeSync = viewportService.subscribeViewportEvents(panelId, el, syncState);
        // World-point crosshair: when the Crosshairs tool is active, a left CLICK
        // sets the shared world point (a left DRAG still does W/L). The point is
        // synced to every other panel (volume → jumpToWorld, stack → nearest slice)
        // and drawn as a reticle by ViewportReticle.
        disposeCrosshair = wireCrosshairPointerHandlers({
          element: el,
          panelId,
          isCrosshairActive: () => useViewerStore.getState().activeTool === ToolName.Crosshairs,
          onWorldPoint: (point) => {
            const store = useViewerStore.getState();
            store.setCrosshairWorldPoint(point, panelId);
            syncCrosshairToPanels(panelId, point, unifiedToolService.getViewportIds(), store.panelImageIdsMap);
          },
        });
        syncState('init');
        // Record the plane the viewport actually opened in (the service resolved it:
        // explicit > native for non-MPR > layout preset). The orientation dropdown +
        // the Viewport's effective orientation read this, so the label matches what's
        // on screen — a sagittal scan opens (and reads) Sagittal, not a forced axial.
        useViewerStore.getState().setPanelOrientation(panelId, result.orientation);
        // Signal viewport readiness for the CURRENT epoch (App bumps the epoch
        // when imageIds change, before this effect re-runs). SegmentationManager
        // .whenReady blocks on this for SEG/RTSTRUCT overlay attach.
        viewportReadyService.markReady(panelId, viewportReadyService.getEpoch(panelId));
        setLoadState('ready');
      })
      .catch((err) => {
        console.warn('[useViewport] create failed:', panelId, err);
        if (!cancelled) setLoadState('error');
      });

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
    // Recreate on panel, series, or sharing-key change. NOT on orientation — that
    // is applied in place below (setOrientation) so changing plane doesn't tear
    // down + reload the shared volume.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelId, scanId, frameOfReferenceUID, seriesKey]);

  // Apply orientation changes (axial ⇄ sagittal ⇄ coronal) to the EXISTING volume
  // viewport without recreating it: a user's dropdown choice (non-MPR) or the
  // enforced preset when a panel becomes part of an MPR layout. The initial plane is
  // set at create; `orientation` is undefined for a fresh non-MPR panel (skip — the
  // create resolved native). Keep panelOrientationMap in sync so the dropdown label
  // tracks the displayed plane even when the layout enforces it.
  useEffect(() => {
    if (!orientation) return;
    viewportService.setOrientation(panelId, orientation);
    if (useViewerStore.getState().panelOrientationMap[panelId] !== orientation) {
      useViewerStore.getState().setPanelOrientation(panelId, orientation);
    }
  }, [panelId, orientation]);

  return { containerRef, loadState };
}
