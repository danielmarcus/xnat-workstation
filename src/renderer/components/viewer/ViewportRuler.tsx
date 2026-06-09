/**
 * ViewportRuler — scale bars (horizontal bottom-centre, vertical left-centre) drawn
 * over a viewport. Lengths come from the TRUE camera scale (useViewportRuler →
 * mm/px) fed through the pure ruler-spec math, so the bar reads a real round length
 * (e.g. "5 cm"). Recomputes on zoom (live zoomPercent) and on panel resize
 * (ResizeObserver). Hidden when its toggle is off or the scale is unknown.
 * Presentational beyond the §2 hook; pointer-events-none.
 */
import { useEffect, useRef, useState } from 'react';
import { useViewportRuler } from '../../hooks/useViewportRuler';
import { buildRulerSpec } from '../../lib/rulerSpec';

interface ViewportRulerProps {
  panelId: string;
}

export default function ViewportRuler({ panelId }: ViewportRulerProps): React.ReactElement | null {
  const { mmPerPx, showHorizontal, showVertical } = useViewportRuler(panelId);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = (): void => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Always render the (empty) root so the ResizeObserver can measure; the bars
  // appear once the scale + size are known.
  const active = (showHorizontal || showVertical) && mmPerPx != null && mmPerPx > 0;
  const horizontal = active && showHorizontal ? buildRulerSpec(mmPerPx, Math.min(size.w * 0.38, 280), 160) : null;
  const vertical = active && showVertical ? buildRulerSpec(mmPerPx, Math.min(size.h * 0.38, 220), 130) : null;

  if (!showHorizontal && !showVertical) return null;

  return (
    <div ref={rootRef} data-testid={`viewport-ruler:${panelId}`} className="pointer-events-none absolute inset-0">
      {horizontal && (
        <div
          data-testid={`ruler-h:${panelId}`}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1 text-[11px] text-zinc-200 [text-shadow:_0_1px_2px_rgb(0_0_0_/_85%)]"
        >
          <div className="relative h-3" style={{ width: `${horizontal.lengthPx}px` }}>
            <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-px bg-zinc-200/90" />
            {Array.from({ length: horizontal.tickCount + 1 }, (_, i) => {
              const ratio = horizontal.tickCount > 0 ? i / horizontal.tickCount : 0;
              const major = i === 0 || i === horizontal.tickCount || i % 2 === 0;
              return (
                <div
                  key={`h-${i}`}
                  className="absolute top-1/2 -translate-y-1/2 w-px bg-zinc-200/90"
                  style={{ left: `${ratio * 100}%`, height: `${major ? 9 : 6}px` }}
                />
              );
            })}
          </div>
          <span data-testid={`ruler-h-label:${panelId}`} className="font-mono">{horizontal.label}</span>
        </div>
      )}

      {vertical && (
        <div
          data-testid={`ruler-v:${panelId}`}
          className="absolute left-6 top-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-1 text-[11px] text-zinc-200 [text-shadow:_0_1px_2px_rgb(0_0_0_/_85%)]"
        >
          <span data-testid={`ruler-v-label:${panelId}`} className="font-mono">{vertical.label}</span>
          <div className="relative w-3" style={{ height: `${vertical.lengthPx}px` }}>
            <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-px bg-zinc-200/90" />
            {Array.from({ length: vertical.tickCount + 1 }, (_, i) => {
              const ratio = vertical.tickCount > 0 ? i / vertical.tickCount : 0;
              const major = i === 0 || i === vertical.tickCount || i % 2 === 0;
              return (
                <div
                  key={`v-${i}`}
                  className="absolute left-1/2 -translate-x-1/2 h-px bg-zinc-200/90"
                  style={{ top: `${ratio * 100}%`, width: `${major ? 9 : 6}px` }}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
