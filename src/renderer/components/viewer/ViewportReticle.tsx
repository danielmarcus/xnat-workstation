/**
 * ViewportReticle — the world-point crosshair guide lines for ONE panel.
 *
 * The crosshair is a shared 3D world point (viewerStore.crosshairWorldPoint, set
 * by clicking with the Crosshairs tool). Every panel that contains the point draws
 * a reticle at the point's projected display location — so it works in a single
 * viewport AND in same-plane / cross-plane multi-viewport layouts (off-panel ⇒ the
 * projection returns null ⇒ no reticle).
 *
 * The lines stop GAP px short of the intersection (4 segments, not 2 full lines)
 * so the pixel under the crosshair stays visible — matching the deleted overlay.
 *
 * Presentational (§2): the world→display projection lives in useCrosshairReticle.
 * pixel-accuracy is confirmed on real data (canvasToWorld is DPR-sensitive and
 * unreliable headless).
 */
import { useCrosshairReticle } from '../../hooks/useCrosshairReticle';

interface ViewportReticleProps {
  panelId: string;
}

const GAP = 12; // px of clear space on each side of the intersection
const LINE = 'absolute bg-emerald-400/90';

export default function ViewportReticle({ panelId }: ViewportReticleProps): React.ReactElement | null {
  const pos = useCrosshairReticle(panelId);
  if (!pos) return null;
  const { x, y, width, height } = pos;

  const leftW = Math.max(0, x - GAP);
  const rightX = Math.min(width, x + GAP);
  const rightW = Math.max(0, width - rightX);
  const topH = Math.max(0, y - GAP);
  const botY = Math.min(height, y + GAP);
  const botH = Math.max(0, height - botY);

  return (
    <div data-testid={`viewport-reticle:${panelId}`} className="pointer-events-none absolute inset-0">
      {/* horizontal: two segments with a gap around x */}
      <div data-testid={`reticle-h-left:${panelId}`} className={LINE} style={{ left: 0, top: `${y}px`, width: `${leftW}px`, height: '1px' }} />
      <div data-testid={`reticle-h-right:${panelId}`} className={LINE} style={{ left: `${rightX}px`, top: `${y}px`, width: `${rightW}px`, height: '1px' }} />
      {/* vertical: two segments with a gap around y */}
      <div data-testid={`reticle-v-top:${panelId}`} className={LINE} style={{ left: `${x}px`, top: 0, width: '1px', height: `${topH}px` }} />
      <div data-testid={`reticle-v-bottom:${panelId}`} className={LINE} style={{ left: `${x}px`, top: `${botY}px`, width: '1px', height: `${botH}px` }} />
    </div>
  );
}
