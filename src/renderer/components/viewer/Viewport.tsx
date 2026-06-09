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
import ViewportStatusOverlay from './ViewportStatusOverlay';
import ViewportTimeScrubber from './ViewportTimeScrubber';
import type { MPRPlane } from '@shared/types/viewer';

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
}

export default function Viewport({
  panelId,
  imageIds,
  scanId,
  frameOfReferenceUID,
  orientation,
  preferNative = false,
}: ViewportProps) {
  const layoutPlane: MPRPlane = orientation ?? 'AXIAL';
  const stored = useViewerStore((s) => s.panelOrientationMap[panelId]);
  // MPR panels are pinned to their designated ortho plane. Non-MPR panels follow
  // the stored plane (a user dropdown choice or the resolved native plane); when
  // nothing is stored yet, `undefined` lets the service resolve the native plane.
  const requestedOrientation: MPRPlane | undefined = preferNative
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
  });
  const isActive = useViewerStore((s) => s.activeViewportId === panelId);
  const setActiveViewport = useViewerStore((s) => s.setActiveViewport);

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
      onPointerDown={() => setActiveViewport(panelId)}
      className={`relative w-full h-full bg-black overflow-hidden ${
        isActive ? 'ring-2 ring-inset ring-sky-500' : ''
      }`}
    >
      <div
        ref={containerRef}
        data-testid={`unified-viewport-element:${panelId}`}
        className="w-full h-full"
      />
      <ViewportOverlay panelId={panelId} />
      <ViewportReticle panelId={panelId} />
      <ViewportRuler panelId={panelId} />
      <ViewportScrollbar panelId={panelId} />
      <ViewportTimeScrubber panelId={panelId} />
      {imageIds.length > 0 && <ViewportStatusOverlay panelId={panelId} state={loadState} />}
    </div>
  );
}
