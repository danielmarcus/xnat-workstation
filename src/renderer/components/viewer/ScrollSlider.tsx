/**
 * ScrollSlider — vertical slice navigation bar on the right edge of a viewport.
 *
 * Shows a thin track with a thumb indicating the current slice position.
 * Supports:
 * - Click on track to jump to a slice
 * - Drag thumb to scrub through slices smoothly
 *
 * Only renders when there are 2+ images in the stack.
 * Uses pointer-events-auto on the slider itself so it captures mouse events
 * on top of the viewport overlay which has pointer-events-none.
 */
import { useCallback, useRef, useState } from 'react';
import { useViewerStore } from '../../stores/viewerStore';
import { viewportService } from '../../lib/cornerstone/viewportService';
import { mprService } from '../../lib/cornerstone/mprService';

interface ScrollSliderProps {
  panelId: string;
}

export default function ScrollSlider({ panelId }: ScrollSliderProps) {
  const orientation = useViewerStore((s) => s.panelOrientationMap[panelId] ?? 'STACK');
  // Use separate primitive selectors to avoid creating new objects (infinite re-render pitfall)
  const imageIndex = useViewerStore((s) => s.viewports[panelId]?.imageIndex ?? 0);
  const requestedImageIndex = useViewerStore((s) => s.viewports[panelId]?.requestedImageIndex ?? null);
  const totalImages = useViewerStore((s) => s.viewports[panelId]?.totalImages ?? 0);
  const mprSliceIndex = useViewerStore((s) => s.mprViewports[panelId]?.sliceIndex ?? 0);
  const mprTotalSlices = useViewerStore((s) => s.mprViewports[panelId]?.totalSlices ?? 0);
  const requestImageIndex = useViewerStore((s) => s._requestImageIndex);
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false); // Non-reactive ref for pointer events

  const isOriented = orientation !== 'STACK';
  const total = isOriented ? mprTotalSlices : totalImages;
  const currentIndex = isOriented ? mprSliceIndex : imageIndex;
  const displayIndex = isOriented ? currentIndex : (requestedImageIndex ?? currentIndex);
  const thumbPercent = total > 1 ? (displayIndex / (total - 1)) * 100 : 0;

  // All hooks must be declared before any early return (Rules of Hooks)
  const scrollToY = useCallback(
    (clientY: number) => {
      const track = trackRef.current;
      if (!track || total <= 1) return;
      const rect = track.getBoundingClientRect();
      const percent = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      const index = Math.round(percent * (total - 1));
      if (index === displayIndex) return;
      if (isOriented) {
        mprService.scrollToIndex(panelId, index);
      } else {
        requestImageIndex(panelId, index, total);
        viewportService.scrollToIndex(panelId, index);
      }
    },
    [displayIndex, isOriented, panelId, requestImageIndex, total],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // Always capture on the track element, not the child thumb
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

  // Don't show slider for single-slice or empty stacks
  if (total <= 1) return null;

  const isVisible = isDragging || isHovered;

  return (
    <div
      data-testid={`scroll-slider:${panelId}`}
      className="absolute right-0 top-0 bottom-0 w-6 z-10 flex items-stretch justify-end pointer-events-auto"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Track — all pointer events go here */}
      <div
        ref={trackRef}
        data-testid={`scroll-slider-track:${panelId}`}
        className={`relative w-2.5 my-3 mr-1 rounded-full transition-opacity duration-150 cursor-pointer ${
          isVisible ? 'opacity-100' : 'opacity-30'
        }`}
        style={{ background: 'rgba(255,255,255,0.15)' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* Thumb — pointer-events-none so clicks fall through to track */}
        <div
          data-testid={`scroll-slider-thumb:${panelId}`}
          className={`absolute left-0 right-0 rounded-full pointer-events-none ${
            isDragging ? 'bg-blue-400' : 'bg-white'
          }`}
          style={{
            height: `${Math.max(8, 100 / total)}%`,
            minHeight: '8px',
            maxHeight: '24px',
            top: `${thumbPercent}%`,
            transform: 'translateY(-50%)',
          }}
        />
      </div>

      {/* Slice indicator — shows current/total when visible */}
      {isVisible && (
        <div
          data-testid={`scroll-slider-indicator:${panelId}`}
          className="absolute right-8 bg-black/80 text-white text-[10px] font-mono px-1.5 py-0.5 rounded whitespace-nowrap pointer-events-none"
          style={{ top: `${Math.max(5, Math.min(95, thumbPercent))}%`, transform: 'translateY(-50%)' }}
        >
          {displayIndex + 1}/{total}
        </div>
      )}
    </div>
  );
}
