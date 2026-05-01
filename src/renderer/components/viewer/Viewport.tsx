/**
 * Viewport — the unified viewport component for the multi-viewport rewrite.
 *
 * Phase 1.4: introduces this component as the future single rendering surface
 * for both volume and stack viewports. Grid components import `Viewport` and
 * stop importing `CornerstoneViewport` / `OrientedViewport` directly.
 *
 * Until the volume-mode rendering wireup lands (segmentation attachment,
 * event subscriptions, crosshair sync — all the responsibilities currently
 * in CornerstoneViewport at 430 lines), this component delegates to the
 * legacy `CornerstoneViewport` regardless of the viewport-type decision.
 * The flag check + eligibility resolution still happens here so the
 * decision is observable in logs and ready for the next commit to switch
 * the volume branch to the new path.
 *
 * When `preferences.multiViewport.enabled` is false, the legacy path always
 * runs unchanged.
 */
import { useMemo } from 'react';
import { usePreferencesStore } from '../../stores/preferencesStore';
import { viewportService } from '../../lib/cornerstone/viewportService';
import CornerstoneViewport from './CornerstoneViewport';

interface ViewportProps {
  panelId: string;
  imageIds: string[];
}

export default function Viewport({ panelId, imageIds }: ViewportProps) {
  const multiViewportEnabled = usePreferencesStore(
    (s) => s.preferences.multiViewport.enabled,
  );

  // Resolve viewport type for logging / future routing. The result is not
  // yet acted on differently — both branches render the legacy path until
  // the volume-mode rendering wireup lands.
  const resolvedType = useMemo(() => {
    if (!multiViewportEnabled || imageIds.length === 0) return null;
    return viewportService.resolveViewportType(imageIds);
  }, [multiViewportEnabled, imageIds]);

  if (multiViewportEnabled && resolvedType) {
    // Phase 1.4 shim: log the decision but render the legacy component so
    // existing behavior is preserved end-to-end. The volume branch becomes
    // a real volume viewport in a subsequent commit.
    if (resolvedType === 'volume') {
      console.debug(
        `[Viewport] panel=${panelId} resolved=volume — rendering legacy stack path until volume-mode wireup lands`,
      );
    }
  }

  return <CornerstoneViewport panelId={panelId} imageIds={imageIds} />;
}
