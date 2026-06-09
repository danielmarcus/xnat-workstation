/**
 * useViewportRuler — the UI↔service seam for the viewport scale-bars (§2). Returns
 * the true on-screen scale (mm per CSS pixel, from the camera) plus the two ruler
 * toggles. Re-reads the scale on each render; the component drives re-renders on
 * zoom (via the live zoomPercent) and on resize (via a ResizeObserver).
 */
import { useViewerStore } from '../stores/viewerStore';
import { usePreferencesStore } from '../stores/preferencesStore';
import { viewportService } from '../lib/cornerstone/viewportService';

export function useViewportRuler(panelId: string): {
  mmPerPx: number | null;
  showHorizontal: boolean;
  showVertical: boolean;
} {
  const showHorizontal = usePreferencesStore((s) => s.preferences.overlay.showHorizontalRuler);
  const showVertical = usePreferencesStore((s) => s.preferences.overlay.showVerticalRuler);
  // Re-render (⇒ re-read the scale) when the zoom changes.
  useViewerStore((s) => s.viewports[panelId]?.zoomPercent);

  const mmPerPx = showHorizontal || showVertical ? viewportService.getMmPerDisplayPixel(panelId) : null;
  return { mmPerPx, showHorizontal, showVertical };
}
