import { useEffect } from 'react';
/**
 * Viewport — the unified, presentational viewport (Phase 1). Collapses the old
 * CornerstoneViewport (stack) + OrientedViewport (volume) into one shell: it
 * holds a ref + JSX only; all Cornerstone lifecycle lives in useViewport.
 * Whether it renders a stack or a volume is decided from the data by the
 * service, not by this component. No service / Cornerstone imports (§2).
 */
import { useViewport } from '../../hooks/useViewport';
import { useViewerStore } from '../../stores/viewerStore';
import ViewportOverlay from './ViewportOverlay';
import ViewportReticle from './ViewportReticle';
import ViewportRuler from './ViewportRuler';
import ViewportScrollbar from './ViewportScrollbar';
import { useViewportGestureStore } from '../../stores/viewportGestureStore';
import ViewportStatusOverlay from './ViewportStatusOverlay';
import ViewportTimeScrubber from './ViewportTimeScrubber';
import type { MPRPlane, DisplayPlane } from '@shared/types/viewer';

interface ViewportProps {
  panelId: string;
  imageIds: string[];
  /** Volume-sharing key (same scanId+FoR ⇒ shared volume across panels). */
  scanId: string;
  frameOfReferenceUID?: string;
  /** The layout's designated plane (MPR preset / fallback). */
  orientation?: MPRPlane;
  /** Open in the scan's native plane (single / generic grid); false for MPR. */
  preferNative?: boolean;
  /** Render a 3D volume rendering instead of a slice (C5c — MPR's 4th slot). */
  render3d?: boolean;
}

export default function Viewport({
  panelId,
  imageIds,
  scanId,
  frameOfReferenceUID,
  orientation,
  preferNative = false,
  render3d = false,
}: ViewportProps) {
  const layoutPlane: MPRPlane = orientation ?? 'AXIAL';
  const stored = useViewerStore((s) => s.panelOrientationMap[panelId]);
  // MPR panels are pinned to their designated ortho plane. Non-MPR panels follow
  // the stored plane (a user dropdown choice or the resolved native plane); when
  // nothing is stored yet, `undefined` lets the service resolve the native plane.
  const requestedOrientation: DisplayPlane | undefined = preferNative
    ? (stored && stored !== 'STACK' ? stored : undefined)
    : layoutPlane;
  const { containerRef, loadState } = useViewport({
    panelId,
    imageIds,
    scanId,
    frameOfReferenceUID,
    orientation: requestedOrientation,
    layoutOrientation: layoutPlane,
    preferNative,
    render3d,
  });
  const isActive = useViewerStore((s) => s.activeViewportId === panelId);
  const setActiveViewport = useViewerStore((s) => s.setActiveViewport);
  const beginDrag = useViewportGestureStore((st) => st.beginDrag);
  const endDrag = useViewportGestureStore((st) => st.endDrag);
  // Release on the WINDOW, not the element: the button often comes up outside the
  // viewport, which is the very case this exists for.
  useEffect(() => {
    const end = () => endDrag();
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [endDrag]);

  return (
    <div
      data-testid={`unified-viewport:${panelId}`}
      data-panel-id={panelId}
      data-active={isActive ? 'true' : 'false'}
      // Focusable programmatically (not in the tab order) so controls like the
      // orientation dropdown can hand focus back to the viewport after a change.
      tabIndex={-1}
      // Select this panel as active on interaction-start. Doesn't preventDefault,
      // so the Cornerstone tool on the canvas still receives the same pointerdown.
      // Restores the click-to-select wiring the deleted CornerstoneViewport had.
      onPointerDown={(e) => {
        setActiveViewport(panelId);
        // A drag that starts on the IMAGE keeps the pointer until release: the slice
        // scrollbar and the time scrubber sit inside this viewport, so a stroke drifting
        // a few pixels toward the right edge would otherwise be taken over by them
        // mid-draw. A drag that starts ON that chrome is left alone.
        if (!(e.target as HTMLElement)?.closest?.('[data-viewport-chrome="true"]')) {
          beginDrag(panelId);
        }
      }}
      className="relative w-full h-full bg-black overflow-hidden"
    >
      <div
        ref={containerRef}
        data-testid={`unified-viewport-element:${panelId}`}
        className="w-full h-full"
      />
      <ViewportOverlay panelId={panelId} render3d={render3d} />
      {/* Slice-plane chrome: a 3D volume rendering has no in-plane reticle, no mm
          scale bar for a projected view, no slice track to scrub and no time axis. */}
      {!render3d && (
        <>
          <ViewportReticle panelId={panelId} />
          <ViewportRuler panelId={panelId} />
          <ViewportScrollbar panelId={panelId} />
          <ViewportTimeScrubber panelId={panelId} />
        </>
      )}
      {imageIds.length > 0 && <ViewportStatusOverlay panelId={panelId} state={loadState} />}
      {/* The ONLY outline a viewport carries: a light gray (zinc-400) on the active
          viewport — the one
          that tool actions, the annotations panel and a scan load all target. Inactive
          viewports are unmarked on purpose; absence is the signal.

          It has to be a SIBLING RENDERED AFTER the canvas, not a ring on the container.
          `ring-inset` is an inset box-shadow, which paints beneath the element's content,
          so the Cornerstone canvas filling the container covered it completely — the ring
          was visible only while a viewport was EMPTY, which is precisely backwards. An
          element later in DOM order paints on top. pointer-events-none so it never
          intercepts a tool gesture.

          Anything ELSE outlining a viewport is a bug, and was one: the browser's own
          :focus-visible ring, in the macOS accent colour, used to land here too. See
          globals.css, "Viewport outlines". */}
      {isActive && (
        <div
          aria-hidden
          data-testid={`viewport-active-ring:${panelId}`}
          className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-zinc-400"
        />
      )}
    </div>
  );
}
