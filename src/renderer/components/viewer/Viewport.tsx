/**
 * Viewport — the unified viewport component for the multi-viewport rewrite.
 *
 * Phase 1.4: introduces this component as the future single rendering surface
 * for both volume and stack viewports. Grid components import `Viewport` and
 * stop importing `StackViewport` / `OrientedViewport` directly.
 *
 * Until the volume-mode rendering wireup lands (segmentation attachment,
 * event subscriptions, crosshair sync — all the responsibilities currently
 * in StackViewport at 430 lines), this component delegates to the
 * legacy `StackViewport` regardless of the viewport-type decision.
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
import StackViewport from './StackViewport';
import VolumeViewport from './VolumeViewport';

interface ViewportProps {
  panelId: string;
  imageIds: string[];
  /**
   * Optional volume orientation. When set to a non-AXIAL value, the panel is
   * part of an MPR layout slot — Viewport routes through VolumeViewport
   * (when the flag is on) or OrientedViewport (legacy fallback). When
   * undefined or 'AXIAL', the panel renders in the default axial volume
   * orientation (or stack mode if eligibility says so).
   */
  orientation?: 'AXIAL' | 'SAGITTAL' | 'CORONAL';
}

export default function Viewport({ panelId, imageIds, orientation }: ViewportProps) {
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

  if (multiViewportEnabled && resolvedType === 'volume') {
    return <VolumeViewport panelId={panelId} imageIds={imageIds} orientation={orientation ?? 'AXIAL'} />;
  }

  return <StackViewport panelId={panelId} imageIds={imageIds} />;
}
