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
    viewportService
      .createUnifiedViewport(panelId, el, {
        scanId,
        frameOfReferenceUID,
        imageIds,
        meta: { imageCount: imageIds.length },
        orientation,
      })
      .then(() => {
        // Join the unified tool group (real CrosshairsTool MPR sync) once the
        // viewport exists. Guard the async gap against a fast unmount.
        if (cancelled) return;
        unifiedToolService.addViewport(panelId);
      })
      .catch((err) => console.warn('[useViewport] create failed:', panelId, err));

    return () => {
      cancelled = true;
      unifiedToolService.removeViewport(panelId);
      viewportService.destroyUnifiedViewport(panelId);
    };
    // Recreate on panel, series, sharing-key, or plane change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelId, scanId, frameOfReferenceUID, orientation, seriesKey]);

  return { containerRef };
}
