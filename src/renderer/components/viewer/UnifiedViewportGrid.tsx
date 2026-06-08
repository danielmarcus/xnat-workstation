/**
 * UnifiedViewportGrid — the new-path viewport grid (Phase 1), gated behind
 * `multiviewport.enabled`. Renders one unified Viewport per panel of the active
 * layout preset (single / MPR-2×2). All panels of one scan share the SAME
 * (scanId, FoR) ⇒ a single ref-counted ImageVolume (P1.1), so an MPR-2×2 of one
 * CT loads the volume once. Presentational: lays out Viewport children + feeds
 * data; no service/Cornerstone imports (§2).
 */
import Viewport from './Viewport';
import { useViewportLayout } from '../../hooks/useViewportLayout';

interface UnifiedViewportGridProps {
  panelImageIds: Record<string, string[]>;
}

export default function UnifiedViewportGrid({ panelImageIds }: UnifiedViewportGridProps) {
  const { panels, grid } = useViewportLayout();
  // All preset panels reformat the same source scan → one shared volume.
  const imageIds = panelImageIds['panel_0'] ?? [];
  const scanId = 'local:scan';

  return (
    <div
      data-testid="unified-viewport-grid"
      className="absolute inset-0 grid gap-px bg-zinc-800"
      style={{
        gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
      }}
    >
      {panels.map((p) => (
        <div key={p.panelId} className="relative min-w-0 min-h-0">
          <Viewport panelId={p.panelId} imageIds={imageIds} scanId={scanId} orientation={p.orientation} />
        </div>
      ))}
    </div>
  );
}
