/**
 * UnifiedViewportGrid — the new-path viewport grid (Phase 1), gated behind
 * `multiviewport.enabled`. P1.4 is a minimal single-panel grid that proves the
 * unified Viewport renders; P1.5 expands it to layout presets (1×1 / 2×2 /
 * MPR-2×2 / custom) driven by viewportLayoutService. Presentational: it lays
 * out `Viewport` children and feeds them data; no service/Cornerstone imports.
 */
import Viewport from './Viewport';

interface UnifiedViewportGridProps {
  panelImageIds: Record<string, string[]>;
}

export default function UnifiedViewportGrid({ panelImageIds }: UnifiedViewportGridProps) {
  const imageIds = panelImageIds['panel_0'] ?? [];
  // absolute inset-0 fills the (relative) viewport-area parent so the
  // Cornerstone element gets a non-zero height.
  return (
    <div className="absolute inset-0 grid grid-cols-1 grid-rows-1">
      <Viewport panelId="panel_0" imageIds={imageIds} scanId="local:panel_0" />
    </div>
  );
}
