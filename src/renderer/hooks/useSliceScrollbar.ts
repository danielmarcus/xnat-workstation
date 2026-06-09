/**
 * useSliceScrollbar — the UI↔service seam for the per-viewport slice scrollbar
 * (architecture §2: components reach Cornerstone only through a hook). Reads the
 * live slice index / total from viewerStore (kept current by useViewport's
 * event-sync, for BOTH stack and volume), and exposes a type-aware setIndex that
 * scrolls the viewport to an absolute slice.
 */
import { useCallback } from 'react';
import { viewportService } from '../lib/cornerstone/viewportService';
import { useViewerStore } from '../stores/viewerStore';

export function useSliceScrollbar(panelId: string): {
  index: number;
  total: number;
  setIndex: (index: number) => void;
} {
  const index = useViewerStore((s) => s.viewports[panelId]?.imageIndex ?? 0);
  const total = useViewerStore((s) => s.viewports[panelId]?.totalImages ?? 0);
  const setIndex = useCallback((i: number) => viewportService.scrollToSlice(panelId, i), [panelId]);
  return { index, total, setIndex };
}
