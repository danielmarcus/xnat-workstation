/**
 * UnifiedViewportGrid — the new-path viewport grid (Phase 1). Renders one unified
 * Viewport per panel of the active layout. Two families:
 *  - single / MPR-2×2: every panel sources 'panel_0' ⇒ one shared, ref-counted
 *    ImageVolume (P1.1), reformatted per panel.
 *  - generic grid (1×2 / 2×1 / 2×2 / custom): each panel sources its OWN imageIds
 *    (independent scan ⇒ its own volume key) for multi-scan comparison.
 * Presentational: lays out Viewport children + feeds data; no service/Cornerstone
 * imports (§2).
 */
import Viewport from './Viewport';
import { useViewportLayout } from '../../hooks/useViewportLayout';

interface UnifiedViewportGridProps {
  panelImageIds: Record<string, string[]>;
}

export default function UnifiedViewportGrid({ panelImageIds }: UnifiedViewportGridProps) {
  const { panels, grid } = useViewportLayout();

  return (
    <div
      data-testid="unified-viewport-grid"
      className="absolute inset-0 grid gap-px bg-zinc-800"
      style={{
        gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
      }}
    >
      {panels.map((p) => {
        const imageIds = panelImageIds[p.sourcePanelId] ?? [];
        const scanId = p.sourcePanelId === 'panel_0' ? 'local:scan' : `local:${p.sourcePanelId}`;
        return (
          // An expanded panel covers the grid; the others stay mounted (and sized) beneath it.
          <div key={p.panelId} className={p.expanded ? 'absolute inset-0 z-20' : 'relative min-w-0 min-h-0'} data-expanded={p.expanded ? 'true' : undefined}>
            <Viewport
              panelId={p.panelId}
              imageIds={imageIds}
              scanId={scanId}
              orientation={p.orientation}
              preferNative={p.preferNative}
              render3d={p.render3d}
            />
          </div>
        );
      })}
    </div>
  );
}
