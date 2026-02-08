/**
 * ViewportGrid — CSS grid layout that renders N panels based on the current
 * layout selection (1×1, 1×2, 2×1, 2×2).
 *
 * Each panel contains a CornerstoneViewport + ViewportOverlay + ScrollSlider.
 * Clicking a panel sets it as active (blue border highlight).
 * Empty panels (no images) show a placeholder.
 *
 * Keyboard navigation: Up/Down arrows scroll one slice, PageUp/PageDown scroll
 * 10 slices, Home/End jump to first/last slice — all targeting the active viewport.
 */
import { useEffect, useCallback } from 'react';
import { useViewerStore } from '../../stores/viewerStore';
import { LAYOUT_CONFIGS, panelId } from '@shared/types/viewer';
import { viewportService } from '../../lib/cornerstone/viewportService';
import CornerstoneViewport from './CornerstoneViewport';
import ViewportOverlay from './ViewportOverlay';
import ScrollSlider from './ScrollSlider';

interface ViewportGridProps {
  panelImageIds: Record<string, string[]>;
}

export default function ViewportGrid({ panelImageIds }: ViewportGridProps) {
  const layout = useViewerStore((s) => s.layout);
  const activeViewportId = useViewerStore((s) => s.activeViewportId);
  const setActiveViewport = useViewerStore((s) => s.setActiveViewport);

  const config = LAYOUT_CONFIGS[layout];

  // ─── Keyboard Navigation ──────────────────────────────────────
  const handleKeyboard = useCallback(
    (e: KeyboardEvent) => {
      // Don't intercept if focus is in an input, select, or textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      const state = useViewerStore.getState();
      const vp = state.viewports[state.activeViewportId];
      if (!vp || vp.totalImages <= 1) return;

      let delta = 0;
      let jumpTo: number | null = null;

      switch (e.key) {
        case 'ArrowUp':
        case 'ArrowLeft':
          delta = -1;
          break;
        case 'ArrowDown':
        case 'ArrowRight':
          delta = 1;
          break;
        case 'PageUp':
          delta = -10;
          break;
        case 'PageDown':
          delta = 10;
          break;
        case 'Home':
          jumpTo = 0;
          break;
        case 'End':
          jumpTo = vp.totalImages - 1;
          break;
        default:
          return; // Not a navigation key
      }

      e.preventDefault();

      if (jumpTo !== null) {
        viewportService.scrollToIndex(state.activeViewportId, jumpTo);
      } else if (delta !== 0) {
        viewportService.scroll(state.activeViewportId, delta);
      }
    },
    [], // No deps — reads from store directly
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyboard);
    return () => window.removeEventListener('keydown', handleKeyboard);
  }, [handleKeyboard]);

  return (
    <div
      className="w-full h-full"
      style={{
        display: 'grid',
        gridTemplateRows: `repeat(${config.rows}, 1fr)`,
        gridTemplateColumns: `repeat(${config.cols}, 1fr)`,
        gap: '2px',
        background: '#18181b', // zinc-900 gap color
      }}
    >
      {Array.from({ length: config.panelCount }, (_, i) => {
        const pid = panelId(i);
        const imageIds = panelImageIds[pid] ?? [];
        const isActive = pid === activeViewportId;

        return (
          <div
            key={pid}
            className={`relative min-w-0 min-h-0 cursor-pointer ${
              isActive ? 'ring-2 ring-blue-500 ring-inset' : ''
            }`}
            onClick={() => setActiveViewport(pid)}
          >
            {imageIds.length > 0 ? (
              <>
                <CornerstoneViewport panelId={pid} imageIds={imageIds} />
                <ViewportOverlay panelId={pid} />
                <ScrollSlider panelId={pid} />
              </>
            ) : (
              <div className="w-full h-full bg-black flex items-center justify-center">
                <div className="text-center text-zinc-600 text-sm">
                  <p>Panel {i + 1}</p>
                  <p className="text-xs mt-1">Select a scan to load</p>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
