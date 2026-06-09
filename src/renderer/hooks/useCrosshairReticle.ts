/**
 * useCrosshairReticle — the UI↔geometry seam for the world-point crosshair reticle
 * (architecture §2: components are presentational and reach Cornerstone geometry
 * only through a hook, never by importing lib/cornerstone directly).
 *
 * Returns the in-panel display point at which to draw the reticle, or null when
 * there's nothing to draw (crosshair tool inactive, no point set, or the point
 * projects off this panel). Re-projects whenever the panel's live camera state
 * (zoom / slice / rotation — pushed to the store by useViewport's event-sync)
 * changes.
 */
import { useViewerStore } from '../stores/viewerStore';
import { getPanelDisplayPointForWorld, type Point3 } from '../lib/cornerstone/unifiedCrosshair';
import { ToolName } from '@shared/types/viewer';

export function useCrosshairReticle(
  panelId: string,
): { x: number; y: number; width: number; height: number } | null {
  const point = useViewerStore((s) => s.crosshairWorldPoint);
  const active = useViewerStore((s) => s.activeTool === ToolName.Crosshairs);
  // Read the live camera state purely as re-render triggers — a zoom / slice /
  // rotation must re-project the reticle. The projection reads the viewport fresh.
  useViewerStore((s) => s.viewports[panelId]?.zoomPercent);
  useViewerStore((s) => s.viewports[panelId]?.imageIndex);
  useViewerStore((s) => s.viewports[panelId]?.rotation);

  if (!active || !point) return null;
  return getPanelDisplayPointForWorld(panelId, point as Point3);
}
