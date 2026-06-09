/**
 * ViewportScrollbar — the vertical slice-navigation scrollbar on a viewport's
 * right edge. Drag or click the track to scrub through slices; the thumb tracks
 * the current slice. Works for stack AND volume viewports (the index/total and the
 * scroll are type-aware — see useSliceScrollbar / viewportService.scrollToSlice).
 * Hidden for single-slice series (total <= 1).
 *
 * Presentational (§2): all Cornerstone access is via useSliceScrollbar.
 */
import { useRef } from 'react';
import { useSliceScrollbar } from '../../hooks/useSliceScrollbar';

interface ViewportScrollbarProps {
  panelId: string;
}

export default function ViewportScrollbar({ panelId }: ViewportScrollbarProps): React.ReactElement | null {
  const { index, total, setIndex } = useSliceScrollbar(panelId);
  const trackRef = useRef<HTMLDivElement>(null);

  if (total <= 1) return null;

  const frac = index / (total - 1); // 0 (first slice) .. 1 (last slice)
  const thumbPct = Math.max(6, (1 / total) * 100); // thumb height as % of track
  const topPct = frac * (100 - thumbPct);

  const indexFromClientY = (clientY: number): number => {
    const el = trackRef.current;
    if (!el) return index;
    const rect = el.getBoundingClientRect();
    if (rect.height <= 0) return index;
    const f = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    return Math.round(f * (total - 1));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* pointer capture is best-effort (e.g. no active pointerId) */
    }
    setIndex(indexFromClientY(e.clientY));
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.buttons !== 1) return; // only while the primary button is held (dragging)
    e.preventDefault();
    setIndex(indexFromClientY(e.clientY));
  };

  return (
    <div
      ref={trackRef}
      data-testid={`viewport-scrollbar:${panelId}`}
      role="scrollbar"
      aria-orientation="vertical"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={index + 1}
      aria-label="Slice"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      className="absolute right-0 top-0 bottom-0 z-10 w-2.5 cursor-pointer bg-white/5 hover:bg-white/10"
    >
      <div
        data-testid={`scrollbar-thumb:${panelId}`}
        className="absolute right-0 w-full rounded-full bg-sky-400/70"
        style={{ top: `${topPct}%`, height: `${thumbPct}%` }}
      />
    </div>
  );
}
