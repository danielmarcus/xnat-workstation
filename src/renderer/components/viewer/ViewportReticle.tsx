/**
 * ViewportReticle — the world-point crosshair guide lines for ONE panel.
 *
 * The crosshair is a shared 3D world point (viewerStore.crosshairWorldPoint, set
 * by clicking with the Crosshairs tool). Every panel that contains the point draws
 * a reticle at the point's projected display location — so it works in a single
 * viewport AND in same-plane / cross-plane multi-viewport layouts (off-panel ⇒ the
 * projection returns null ⇒ no reticle).
 *
 * Presentational (§2): the world→display projection lives in useCrosshairReticle;
 * this component only draws the lines at the returned point. pixel-accuracy is
 * confirmed on real data (canvasToWorld is DPR-sensitive and unreliable headless).
 */
import { useCrosshairReticle } from '../../hooks/useCrosshairReticle';

interface ViewportReticleProps {
  panelId: string;
}

export default function ViewportReticle({ panelId }: ViewportReticleProps): React.ReactElement | null {
  const pos = useCrosshairReticle(panelId);
  if (!pos) return null;

  return (
    <div data-testid={`viewport-reticle:${panelId}`} className="pointer-events-none absolute inset-0">
      <div
        data-testid={`reticle-h:${panelId}`}
        className="absolute left-0 right-0 border-t border-emerald-400/70"
        style={{ top: `${pos.y}px` }}
      />
      <div
        data-testid={`reticle-v:${panelId}`}
        className="absolute top-0 bottom-0 border-l border-emerald-400/70"
        style={{ left: `${pos.x}px` }}
      />
    </div>
  );
}
