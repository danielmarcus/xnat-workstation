/**
 * Viewport — the unified, presentational viewport (Phase 1). Collapses the old
 * CornerstoneViewport (stack) + OrientedViewport (volume) into one shell: it
 * holds a ref + JSX only; all Cornerstone lifecycle lives in useViewport.
 * Whether it renders a stack or a volume is decided from the data by the
 * service, not by this component. No service / Cornerstone imports (§2).
 */
import { useViewport } from '../../hooks/useViewport';
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
  const { containerRef } = useViewport({ panelId, imageIds, scanId, frameOfReferenceUID, orientation });

  return (
    <div
      data-testid={`unified-viewport:${panelId}`}
      className="relative w-full h-full bg-black overflow-hidden"
    >
      <div
        ref={containerRef}
        data-testid={`unified-viewport-element:${panelId}`}
        className="w-full h-full"
      />
    </div>
  );
}
