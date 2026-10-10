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
import { useSliceTrack } from '../../hooks/useSliceTrack';
import { useIsViewportDragging } from '../../stores/viewportGestureStore';

interface ViewportScrollbarProps {
  panelId: string;
}

export default function ViewportScrollbar({ panelId }: ViewportScrollbarProps): React.ReactElement | null {
  const { index, total, setIndex } = useSliceScrollbar(panelId);
  // The slice track (SegWorks parity D5): where the active segment is, and the
  // operation range being set, drawn behind the thumb.
  const track = useSliceTrack(panelId);
  const rangeDrag = useRef<'from' | 'to' | null>(null);
  // Inert while a stroke is in progress: this strip is INSIDE the viewport, so drawing
  // near the right edge would otherwise hand the drag to the slice scrubber mid-stroke.
  const dragging = useIsViewportDragging();
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

  // Centre of slice i on the track, as a % of its height — where the thumb's centre sits
  // when that slice is shown, so a band lines up with the thumb.
  const centerPct = (i: number) => (i / (total - 1)) * (100 - thumbPct) + thumbPct / 2;
  const unitPct = Math.max(100 / total, 0.8);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault();
    const end = (e.target as HTMLElement).dataset?.rangeEnd as 'from' | 'to' | undefined;
    if (end && track.range) {
      rangeDrag.current = end;
      try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* best-effort */ }
      return;
    }
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
    if (rangeDrag.current && track.range) {
      const i = indexFromClientY(e.clientY);
      if (rangeDrag.current === 'from') track.setRange(i, track.range.to);
      else track.setRange(track.range.from, i);
      return;
    }
    setIndex(indexFromClientY(e.clientY));
  };
  const onPointerUp = (): void => {
    rangeDrag.current = null;
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
      onPointerUp={onPointerUp}
      data-viewport-chrome="true"
      className={`absolute right-0 top-0 bottom-0 z-10 w-2.5 cursor-pointer bg-white/5 ${
        dragging ? 'pointer-events-none' : 'hover:bg-white/10'
      }`}
    >
      {track.gaps.map(([a, b]) => (
        <div
          key={`gap-${a}`}
          data-testid="slice-track-gap"
          data-from={a + 1}
          data-to={b + 1}
          className="absolute left-0 right-0 border border-dashed border-amber-400/90 pointer-events-none"
          style={{ top: `${centerPct(a) - unitPct / 2}%`, height: `${centerPct(b) - centerPct(a) + unitPct}%` }}
        />
      ))}
      {track.anchors && (['a', 'b'] as const).map((k) => {
        const d = track.anchors![k];
        if (d === null) return null;
        return (
          <div
            key={k}
            data-testid={`slice-track-anchor-${k}`}
            data-slice={d + 1}
            className="absolute -left-3 text-[9px] font-bold text-amber-300 pointer-events-none leading-none"
            style={{ top: `calc(${centerPct(d)}% - 5px)` }}
          >
            {k.toUpperCase()}
          </div>
        );
      })}
      {track.range && (() => {
        const lo = Math.min(track.range.from, track.range.to);
        const hi = Math.max(track.range.from, track.range.to);
        const loEnd = track.range.from <= track.range.to ? 'from' : 'to';
        const hiEnd = loEnd === 'from' ? 'to' : 'from';
        return (
          <div
            data-testid="slice-track-range"
            data-from={lo + 1}
            data-to={hi + 1}
            className="absolute -left-[3px] -right-[3px] rounded-sm border-[1.5px] border-teal-400 pointer-events-none"
            style={{ top: `${centerPct(lo) - unitPct / 2}%`, height: `${centerPct(hi) - centerPct(lo) + unitPct}%` }}
          >
            <div data-range-end={loEnd} data-testid="slice-track-range-start" className="absolute -top-1.5 left-0 right-0 h-3 cursor-ns-resize pointer-events-auto" />
            <div data-range-end={hiEnd} data-testid="slice-track-range-end" className="absolute -bottom-1.5 left-0 right-0 h-3 cursor-ns-resize pointer-events-auto" />
          </div>
        );
      })()}
      <div
        data-testid={`scrollbar-thumb:${panelId}`}
        className="absolute right-0 w-full rounded-full bg-sky-400/70"
        style={{ top: `${topPct}%`, height: `${thumbPct}%` }}
      />
      {/* Drawn over the thumb, inset, so the current slice's band is never hidden by it. */}
      {track.color && track.runs.map(([a, b]) => (
        <div
          key={`${a}-${b}`}
          data-testid="slice-track-band"
          data-from={a + 1}
          data-to={b + 1}
          className="absolute left-[3px] right-[3px] rounded-[1px] pointer-events-none"
          style={{
            top: `${centerPct(a) - unitPct / 2}%`,
            height: `${centerPct(b) - centerPct(a) + unitPct}%`,
            background: track.color ?? undefined,
            opacity: 0.9,
          }}
        />
      ))}
    </div>
  );
}
