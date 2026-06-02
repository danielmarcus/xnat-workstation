/**
 * ViewportGrid — CSS grid layout that renders N panels based on the current
 * layout selection (1×1, 1×2, 2×1, 2×2, mpr-2x2).
 *
 * Each panel renders a `Viewport`, which routes between stack-mode
 * (StackViewport) and volume-mode (VolumeViewport) by source-image
 * eligibility plus the panel's orientation (STACK vs. AXIAL/SAGITTAL/CORONAL).
 *
 * Keyboard shortcuts (including slice navigation) are handled globally
 * by hotkeyService — see src/renderer/lib/hotkeys/hotkeyService.ts.
 */
import { useViewerStore } from '../../stores/viewerStore';
import { panelId } from '@shared/types/viewer';
import ErrorBoundary from '../ErrorBoundary';
import Viewport from './Viewport';
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
        const loadingScanId = panelXnatContextMap[pid]?.scanId || panelScanMap[pid] || '';
        const loadingScanLabel = sessionScans?.find((scan) => scan.id === loadingScanId)?.seriesDescription?.trim() ?? '';
        const loadingMessage = loadingScanId
          ? `Loading #${loadingScanId}${loadingScanLabel ? ` ${loadingScanLabel}` : ''}`
          : 'Select a scan to load';

        return (
          <div
            key={pid}
            data-panel-id={pid}
            // Spec §7.6 — every viewport cell is a drop target for
            // sidebar scan drags (MIME `application/x-xnat-scan`).
            data-droptarget="panel"
            tabIndex={-1}
            className="relative min-w-0 min-h-0 outline-none"
            onClick={() => setActiveViewport(pid)}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes('application/x-xnat-scan')) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
              (e.currentTarget as HTMLElement).dataset.dragOver = 'true';
              // The drop-zone inner frame uses Tailwind `data-[drag-over=true]`
              // so a sibling DOM update suffices — no React re-render.
              const inner = (e.currentTarget as HTMLElement)
                .querySelector('[data-testid^="viewport-drop-zone"] > div') as HTMLElement | null;
              if (inner) inner.dataset.dragOver = 'true';
            }}
            onDragLeave={(e) => {
              delete (e.currentTarget as HTMLElement).dataset.dragOver;
              const inner = (e.currentTarget as HTMLElement)
                .querySelector('[data-testid^="viewport-drop-zone"] > div') as HTMLElement | null;
              if (inner) delete inner.dataset.dragOver;
            }}
            onDrop={(e) => {
              const data = e.dataTransfer.getData('application/x-xnat-scan');
              if (!data) return;
              e.preventDefault();
              delete (e.currentTarget as HTMLElement).dataset.dragOver;
              const inner = (e.currentTarget as HTMLElement)
                .querySelector('[data-testid^="viewport-drop-zone"] > div') as HTMLElement | null;
              if (inner) delete inner.dataset.dragOver;
              // Dispatch a custom event so the sidebar's drop coordinator
              // (App.tsx) can route the load without ViewportGrid having
              // to import App-level handlers.
              window.dispatchEvent(new CustomEvent('xnat-scan-drop', {
                detail: { panelId: pid, payload: data },
              }));
            }}
          >
            {isActive && (
              <div className="absolute inset-0 border border-zinc-500/80 pointer-events-none z-40" />
            )}
            {imageIds.length > 0 ? (
              // Per-viewport ErrorBoundary (spec §13.1): a render crash in one
              // viewport shows an in-cell recovery without taking down the app.
              <ErrorBoundary variant="viewport" label={pid}>
                <Viewport
                  panelId={pid}
                  imageIds={imageIds}
                  orientation={orientation === 'STACK' ? undefined : orientation}
                />
                <ViewportOverlay panelId={pid} />
                <ScrollSlider panelId={pid} />
              </ErrorBoundary>
            ) : (
              <ViewportDropZone
                panelIndex={i}
                loading={loadingScanId.length > 0}
                loadingMessage={loadingMessage}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Empty-viewport drop zone — spec §5.9.
 * Dashed border + centered download-arrow icon + caption. The drag-
 * over color flip (border-blue-500 / bg-blue-500/8%) is exposed via
 * a `data-drag-over` attribute hook so #88's drag listeners can
 * toggle it without re-rendering through React.
 */
function ViewportDropZone({
  panelIndex,
  loading,
  loadingMessage,
}: {
  panelIndex: number;
  loading: boolean;
  loadingMessage: string;
}) {
  return (
    <div
      data-testid={`viewport-drop-zone:panel_${panelIndex}`}
      className="w-full h-full bg-black flex items-center justify-center"
    >
      <div className="w-[80%] h-[80%] border-2 border-dashed border-zinc-700 rounded-lg flex flex-col items-center justify-center gap-2 text-zinc-500 transition-colors data-[drag-over=true]:border-blue-500 data-[drag-over=true]:bg-blue-500/10">
        <svg viewBox="0 0 24 24" className="w-8 h-8" aria-hidden>
          <path
            d="M12 4v12m0 0l-5-5m5 5l5-5M5 20h14"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div className="text-center text-[11px] leading-snug">
          <p className="text-zinc-400">Panel {panelIndex + 1}</p>
          <p className="mt-0.5">
            {loading ? loadingMessage : 'Drop a scan here or click in the browser'}
          </p>
        </div>
      </div>
    </div>
  );
}
