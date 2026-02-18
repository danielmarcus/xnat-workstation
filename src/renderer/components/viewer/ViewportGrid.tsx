/**
 * ViewportGrid — CSS grid layout that renders N panels based on the current
 * layout selection (1×1, 1×2, 2×1, 2×2).
 *
 * Each panel contains a CornerstoneViewport + ViewportOverlay + ScrollSlider.
 * Clicking a panel sets it as active (blue border highlight).
 *
 * Keyboard shortcuts (including slice navigation) are handled globally
 * by hotkeyService — see src/renderer/lib/hotkeys/hotkeyService.ts.
 */
import { useViewerStore } from '../../stores/viewerStore';
import { panelId } from '@shared/types/viewer';
import CornerstoneViewport from './CornerstoneViewport';
import ViewportOverlay from './ViewportOverlay';
import ScrollSlider from './ScrollSlider';

interface ViewportGridProps {
  panelImageIds: Record<string, string[]>;
}

export default function ViewportGrid({ panelImageIds }: ViewportGridProps) {
  const layoutConfig = useViewerStore((s) => s.layoutConfig);
  const activeViewportId = useViewerStore((s) => s.activeViewportId);
  const setActiveViewport = useViewerStore((s) => s.setActiveViewport);

  return (
    <div
      className="w-full h-full"
      style={{
        display: 'grid',
        gridTemplateRows: `repeat(${layoutConfig.rows}, 1fr)`,
        gridTemplateColumns: `repeat(${layoutConfig.cols}, 1fr)`,
        gap: '2px',
        background: '#18181b', // zinc-900 gap color
      }}
    >
      {Array.from({ length: layoutConfig.panelCount }, (_, i) => {
        const pid = panelId(i);
        const imageIds = panelImageIds[pid] ?? [];
        const isActive = pid === activeViewportId;

        return (
          <div
            key={pid}
            data-panel-id={pid}
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
