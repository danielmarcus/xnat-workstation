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
import ViewportScrollbar from './ViewportScrollbar';
import type { MPRPlane } from '@shared/types/viewer';

interface ViewportProps {
  panelId: string;
  imageIds: string[];
  /** Volume-sharing key (same scanId+FoR ⇒ shared volume across panels). */
  scanId: string;
  frameOfReferenceUID?: string;
  /** Reformatted plane for the volume path (default axial). */
  orientation?: MPRPlane;
}

export default function Viewport({
  panelId,
  imageIds,
  scanId,
  frameOfReferenceUID,
  orientation,
}: ViewportProps) {
  // The user's per-panel orientation selection (from the overlay dropdown) overrides
  // the layout's default plane. 'STACK'/unset ⇒ fall back to the layout orientation.
  const userOrientation = useViewerStore((s) => s.panelOrientationMap[panelId]);
  const effectiveOrientation: MPRPlane =
    userOrientation && userOrientation !== 'STACK' ? userOrientation : (orientation ?? 'AXIAL');
  const { containerRef } = useViewport({
    panelId,
    imageIds,
    scanId,
    frameOfReferenceUID,
    orientation: effectiveOrientation,
  });
  const isActive = useViewerStore((s) => s.activeViewportId === panelId);
  const setActiveViewport = useViewerStore((s) => s.setActiveViewport);

  return (
    <div
      data-testid={`unified-viewport:${panelId}`}
      data-panel-id={panelId}
      data-active={isActive ? 'true' : 'false'}
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
      <ViewportScrollbar panelId={panelId} />
    </div>
  );
}
