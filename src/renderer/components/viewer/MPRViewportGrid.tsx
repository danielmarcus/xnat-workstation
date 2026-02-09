/**
 * MPRViewportGrid — 2×2 CSS grid for MPR mode.
 *
 * Layout:
 * ┌──────────┬──────────┐
 * │  Axial   │ Sagittal │
 * │ (MPR)    │ (MPR)    │
 * ├──────────┼──────────┤
 * │ Coronal  │ Stack    │
 * │ (MPR)    │ (ref)    │
 * └──────────┴──────────┘
 *
 * Panels 0-2: MPRViewport (volume, one per plane)
 * Panel 3: CornerstoneViewport (original stack for reference)
 *
 * Includes a volume loading overlay with progress bar.
 *
 * Keyboard shortcuts (including MPR slice navigation) are handled globally
 * by hotkeyService — see src/renderer/lib/hotkeys/hotkeyService.ts.
 */
import { useCallback, useRef, useState } from 'react';
import { useViewerStore } from '../../stores/viewerStore';
import { mprPanelId, MPR_PANELS } from '@shared/types/viewer';
import { mprService } from '../../lib/cornerstone/mprService';
import MPRViewport from './MPRViewport';
import CornerstoneViewport from './CornerstoneViewport';
import ViewportOverlay from './ViewportOverlay';
import ScrollSlider from './ScrollSlider';

interface MPRViewportGridProps {
  volumeId: string;
  sourceImageIds: string[];
}

const MPR_STACK_PANEL_ID = 'mpr_stack';

export default function MPRViewportGrid({ volumeId, sourceImageIds }: MPRViewportGridProps) {
  const activeViewportId = useViewerStore((s) => s.activeViewportId);
  const setActiveViewport = useViewerStore((s) => s.setActiveViewport);
  const mprVolumeProgress = useViewerStore((s) => s.mprVolumeProgress);

  // Is volume still loading?
  const isLoading = mprVolumeProgress !== null && mprVolumeProgress.percent < 100;

  return (
    <div className="relative w-full h-full">
      {/* 2×2 grid */}
      <div
        className="w-full h-full"
        style={{
          display: 'grid',
          gridTemplateRows: 'repeat(2, 1fr)',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: '2px',
          background: '#18181b',
        }}
      >
        {/* Panels 0-2: MPR viewports (Axial, Sagittal, Coronal) */}
        {MPR_PANELS.map(({ panelIndex, plane, label }) => {
          const pid = mprPanelId(panelIndex);
          const isActive = pid === activeViewportId;

          return (
            <div
              key={pid}
              className={`relative min-w-0 min-h-0 cursor-pointer ${
                isActive ? 'ring-2 ring-blue-500 ring-inset' : ''
              }`}
              onClick={() => setActiveViewport(pid)}
            >
              <MPRViewport panelId={pid} volumeId={volumeId} plane={plane} />
              <MPRScrollSlider panelId={pid} />
            </div>
          );
        })}

        {/* Panel 3: Original stack viewport for reference */}
        <div
          className={`relative min-w-0 min-h-0 cursor-pointer ${
            MPR_STACK_PANEL_ID === activeViewportId ? 'ring-2 ring-blue-500 ring-inset' : ''
          }`}
          onClick={() => setActiveViewport(MPR_STACK_PANEL_ID)}
        >
          {sourceImageIds.length > 0 ? (
            <>
              <CornerstoneViewport panelId={MPR_STACK_PANEL_ID} imageIds={sourceImageIds} />
              <ViewportOverlay panelId={MPR_STACK_PANEL_ID} />
              <ScrollSlider panelId={MPR_STACK_PANEL_ID} />
            </>
          ) : (
            <div className="w-full h-full bg-black flex items-center justify-center">
              <div className="text-center text-zinc-600 text-sm">
                <p>Stack View</p>
                <p className="text-xs mt-1">No images loaded</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Volume loading overlay */}
      {isLoading && mprVolumeProgress && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-6 py-4 text-center min-w-[240px]">
            <svg className="animate-spin h-6 w-6 text-blue-400 mx-auto mb-3" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
              <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
            </svg>
            <p className="text-sm text-zinc-300 font-medium mb-2">Creating Volume</p>
            <div className="w-full bg-zinc-800 rounded-full h-1.5 mb-1.5">
              <div
                className="bg-blue-500 h-1.5 rounded-full transition-all duration-200"
                style={{ width: `${mprVolumeProgress.percent}%` }}
              />
            </div>
            <p className="text-[11px] text-zinc-500 tabular-nums">
              {mprVolumeProgress.loaded} / {mprVolumeProgress.total} slices ({mprVolumeProgress.percent}%)
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MPR Scroll Slider ─────────────────────────────────────────

/**
 * Scroll slider that reads from mprViewports state instead of viewports state.
 * Uses mprService.scrollToIndex for navigation.
 */
function MPRScrollSlider({ panelId }: { panelId: string }) {
  const sliceIndex = useViewerStore((s) => s.mprViewports[panelId]?.sliceIndex ?? 0);
  const totalSlices = useViewerStore((s) => s.mprViewports[panelId]?.totalSlices ?? 0);
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const thumbPercent = totalSlices > 1 ? (sliceIndex / (totalSlices - 1)) * 100 : 0;

  const scrollToY = useCallback(
    (clientY: number) => {
      const track = trackRef.current;
      if (!track || totalSlices <= 1) return;
      const rect = track.getBoundingClientRect();
      const percent = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      const index = Math.round(percent * (totalSlices - 1));
      mprService.scrollToIndex(panelId, index);
    },
    [panelId, totalSlices],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const track = trackRef.current;
      if (!track) return;
      track.setPointerCapture(e.pointerId);
      draggingRef.current = true;
      setIsDragging(true);
      scrollToY(e.clientY);
    },
    [scrollToY],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      e.preventDefault();
      scrollToY(e.clientY);
    },
    [scrollToY],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setIsDragging(false);
      const track = trackRef.current;
      if (track) {
        try { track.releasePointerCapture(e.pointerId); } catch { /* ok */ }
      }
    },
    [],
  );

  if (totalSlices <= 1) return null;

  const isVisible = isDragging || isHovered;

  return (
    <div
      className="absolute right-0 top-0 bottom-0 w-6 z-10 flex items-stretch justify-end pointer-events-auto"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        ref={trackRef}
        className={`relative w-2.5 my-3 mr-1 rounded-full transition-opacity duration-150 cursor-pointer ${
          isVisible ? 'opacity-100' : 'opacity-30'
        }`}
        style={{ background: 'rgba(255,255,255,0.15)' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div
          className={`absolute left-0 right-0 rounded-full pointer-events-none ${
            isDragging ? 'bg-blue-400' : 'bg-white'
          }`}
          style={{
            height: `${Math.max(8, 100 / totalSlices)}%`,
            minHeight: '8px',
            maxHeight: '24px',
            top: `${thumbPercent}%`,
            transform: 'translateY(-50%)',
          }}
        />
      </div>

      {isVisible && (
        <div
          className="absolute right-8 bg-black/80 text-white text-[10px] font-mono px-1.5 py-0.5 rounded whitespace-nowrap pointer-events-none"
          style={{ top: `${Math.max(5, Math.min(95, thumbPercent))}%`, transform: 'translateY(-50%)' }}
        >
          {sliceIndex + 1}/{totalSlices}
        </div>
      )}
    </div>
  );
}
