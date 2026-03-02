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
import OrientedViewport from './OrientedViewport';
import ViewportOverlay from './ViewportOverlay';
import ScrollSlider from './ScrollSlider';
import { ToolName } from '@shared/types/viewer';
import { useEffect } from 'react';

interface ViewportGridProps {
  panelImageIds: Record<string, string[]>;
}

export default function ViewportGrid({ panelImageIds }: ViewportGridProps) {
  const layoutConfig = useViewerStore((s) => s.layoutConfig);
  const activeViewportId = useViewerStore((s) => s.activeViewportId);
  const setActiveViewport = useViewerStore((s) => s.setActiveViewport);
  const panelOrientationMap = useViewerStore((s) => s.panelOrientationMap);
  const activeTool = useViewerStore((s) => s.activeTool);
  const sessionScans = useViewerStore((s) => s.sessionScans);
  const panelXnatContextMap = useViewerStore((s) => s.panelXnatContextMap);
  const panelScanMap = useViewerStore((s) => s.panelScanMap);

  useEffect(() => {
    const el = document.querySelector(`[data-panel-id="${activeViewportId}"]`) as HTMLElement | null;
    el?.focus?.();
  }, [activeViewportId]);

  return (
    <div
      className={`w-full h-full ${activeTool === ToolName.Crosshairs ? 'crosshair-mode' : ''}`}
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
        const orientation = panelOrientationMap[pid] ?? 'STACK';
        const canUseOrientedView = imageIds.length > 1;
        const shouldUseOrientedView = canUseOrientedView && orientation !== 'STACK';
        const loadingScanId = panelXnatContextMap[pid]?.scanId || panelScanMap[pid] || '';
        const loadingScanLabel = sessionScans?.find((scan) => scan.id === loadingScanId)?.seriesDescription?.trim() ?? '';
        const loadingMessage = loadingScanId
          ? `Loading #${loadingScanId}${loadingScanLabel ? ` ${loadingScanLabel}` : ''}`
          : 'Select a scan to load';

        return (
          <div
            key={pid}
            data-panel-id={pid}
            tabIndex={-1}
            className="relative min-w-0 min-h-0 cursor-pointer outline-none"
            onClick={() => setActiveViewport(pid)}
          >
            {isActive && (
              <div className="absolute inset-0 border border-zinc-500/80 pointer-events-none z-40" />
            )}
            {imageIds.length > 0 ? (
              <>
                {shouldUseOrientedView ? (
                  <OrientedViewport panelId={pid} imageIds={imageIds} plane={orientation} />
                ) : (
                  <CornerstoneViewport panelId={pid} imageIds={imageIds} />
                )}
                <ViewportOverlay panelId={pid} />
                <ScrollSlider panelId={pid} />
              </>
            ) : (
              <div className="w-full h-full bg-black flex items-center justify-center">
                <div className="text-center text-zinc-600 text-sm">
                  <p>Panel {i + 1}</p>
                  <p className="text-xs mt-1">{loadingMessage}</p>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
