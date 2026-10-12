/**
 * The preview bar (SegWorks parity D4): top-centre of the viewport an operation was run
 * from, while its result waits to be committed. It sits BELOW the two-line corner readouts
 * — at the very top it covered a long series description. ⏎ / ⎋ / hold `\` work from the keyboard
 * (maskPreview's key layer) — focus never has to leave the viewport; the buttons are the
 * pointer equivalent.
 */
import { useMaskPreview } from '../../hooks/useMaskPreview';

export default function MaskPreviewBar({ panelId }: { panelId: string }) {
  const { active, label, summary, viewportId, comparing, readOnly, commit, discard, job, cancelJob } = useMaskPreview();
  if (job && job.viewportId === panelId) {
    const pct = Math.round(job.fraction * 100);
    return (
      <div
        data-testid="compute-progress-bar"
        className="absolute top-12 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 whitespace-nowrap rounded-md border border-zinc-700 bg-zinc-900/95 px-2 py-1 text-[11px] text-zinc-200 shadow"
      >
        <span>Running · <span className="font-medium">{job.label}</span></span>
        <span className="relative h-1.5 w-24 overflow-hidden rounded bg-zinc-700" role="progressbar" aria-label={`${job.label} progress`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <span className="absolute inset-y-0 left-0 bg-blue-500" style={{ width: `${pct}%` }} />
        </span>
        <span className="text-zinc-400 w-8 text-right">{pct}%</span>
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={cancelJob}
          className="rounded bg-zinc-700 px-2 py-0.5 hover:bg-zinc-600"
        >
          Cancel <span className="opacity-70">⎋</span>
        </button>
      </div>
    );
  }
  if (!active || viewportId !== panelId) return null;
  return (
    <div
      data-testid="mask-preview-bar"
      className="absolute top-12 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 whitespace-nowrap rounded-md border border-zinc-700 bg-zinc-900/95 px-2 py-1 text-[11px] text-zinc-200 shadow"
    >
      <span>
        Preview · <span className="font-medium">{label}</span> · <span className="text-zinc-400">{summary}</span>
      </span>
      {readOnly ? (
        <span className="rounded border border-amber-600/60 px-1.5 py-0.5 text-amber-300">Locked · preview only</span>
      ) : (
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={commit}
          className="rounded bg-blue-600 px-2 py-0.5 text-white hover:bg-blue-500"
        >
          Commit <span className="opacity-70">⏎</span>
        </button>
      )}
      <button
        type="button"
        tabIndex={-1}
        onMouseDown={(e) => e.preventDefault()}
        onClick={discard}
        className="rounded bg-zinc-700 px-2 py-0.5 hover:bg-zinc-600"
      >
        {readOnly ? 'Close' : 'Discard'} <span className="opacity-70">⎋</span>
      </button>
      <span className="text-[10px] text-zinc-500">{comparing ? 'showing current mask' : 'hold \\ to compare'}</span>
    </div>
  );
}
