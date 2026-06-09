/**
 * ViewportTimeScrubber — the time-point navigator for a 4D / multi-volume
 * (functional) series. A horizontal slider at the bottom of the viewport with a
 * "Time N / T" label and prev/next steppers; switching time points is instant and
 * preserves the camera (the volume holds all time points — see
 * viewportService.setTimepoint). Hidden for 3D series (total <= 1).
 *
 * Presentational (§2): all Cornerstone access is via useTimeScrubber.
 */
import { useTimeScrubber } from '../../hooks/useTimeScrubber';

interface ViewportTimeScrubberProps {
  panelId: string;
}

export default function ViewportTimeScrubber({ panelId }: ViewportTimeScrubberProps): React.ReactElement | null {
  const { current, total, setTimepoint } = useTimeScrubber(panelId);
  if (total <= 1) return null;

  const step = (delta: number): void => setTimepoint(current + delta);

  return (
    <div
      data-testid={`time-scrubber:${panelId}`}
      onPointerDown={(e) => e.stopPropagation()}
      className="pointer-events-auto absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded bg-zinc-900/80 px-2 py-1 text-[10px] text-zinc-200"
    >
      <button
        data-testid={`time-prev:${panelId}`}
        onClick={() => step(-1)}
        disabled={current <= 1}
        title="Previous time point"
        className="px-1 leading-none disabled:opacity-30 hover:text-white"
      >
        ‹
      </button>
      <input
        data-testid={`time-slider:${panelId}`}
        type="range"
        min={1}
        max={total}
        value={current}
        onChange={(e) => setTimepoint(Number(e.target.value))}
        className="w-28 accent-sky-500"
        aria-label="Time point"
      />
      <button
        data-testid={`time-next:${panelId}`}
        onClick={() => step(1)}
        disabled={current >= total}
        title="Next time point"
        className="px-1 leading-none disabled:opacity-30 hover:text-white"
      >
        ›
      </button>
      <span data-testid={`time-label:${panelId}`} className="tabular-nums">
        {current} / {total}
      </span>
    </div>
  );
}
