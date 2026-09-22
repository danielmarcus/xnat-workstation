/**
 * useCrosshairIntensity — the UI↔geometry seam for the crosshair intensity readout
 * (architecture §2: components reach Cornerstone geometry only through a hook, never
 * by importing lib/cornerstone directly).
 *
 * Returns the voxel intensity sampled under the crosshair world point for this panel,
 * or null when there's nothing to show (no point set, the point belongs to another
 * panel, or it projects off the displayed image). Mirrors the gating of the overlay's
 * `crosshair` coordinate field so the intensity sits with the coordinates it describes
 * — it does NOT require the Crosshairs tool to still be active, only that a point exists.
 */
import { useViewerStore } from '../stores/viewerStore';
import { getIntensityAtWorld, type IntensitySample, type Point3 } from '../lib/cornerstone/unifiedCrosshair';

export function useCrosshairIntensity(panelId: string): IntensitySample | null {
  const point = useViewerStore((s) => s.crosshairWorldPoint);
  const sourcePanelId = useViewerStore((s) => s.crosshairSourcePanelId);
  // Re-sample when the displayed slice/image changes — a stack viewport samples its
  // CURRENT slice, so scrolling must re-read (pure re-render trigger).
  useViewerStore((s) => s.viewports[panelId]?.imageIndex);

  if (!point) return null;
  if (sourcePanelId && sourcePanelId !== panelId) return null;
  return getIntensityAtWorld(panelId, point as Point3);
}
