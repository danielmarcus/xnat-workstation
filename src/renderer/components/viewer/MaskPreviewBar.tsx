/**
 * The preview bar (SegWorks parity D4): top-centre of the viewport an operation was run
 * from, while its result waits to be committed. It sits BELOW the two-line corner readouts
 * — at the very top it covered a long series description. ⏎ / ⎋ / hold `\` work from the keyboard
 * (maskPreview's key layer) — focus never has to leave the viewport; the buttons are the
 * pointer equivalent.
 */
import { useMaskPreview } from '../../hooks/useMaskPreview';

export default function MaskPreviewBar({ panelId }: { panelId: string }) {
  const { active, label, summary, viewportId, comparing, commit, discard } = useMaskPreview();
  if (!active || viewportId !== panelId) return null;
  return (
    <div
      data-testid="mask-preview-bar"
      className="absolute top-12 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 whitespace-nowrap rounded-md border border-zinc-700 bg-zinc-900/95 px-2 py-1 text-[11px] text-zinc-200 shadow"
    >
      <span>
        Preview · <span className="font-medium">{label}</span> · <span className="text-zinc-400">{summary}</span>
      </span>
      <button
        type="button"
        tabIndex={-1}
        onMouseDown={(e) => e.preventDefault()}
        onClick={commit}
        className="rounded bg-blue-600 px-2 py-0.5 text-white hover:bg-blue-500"
      >
        Commit <span className="opacity-70">⏎</span>
      </button>
      <button
        type="button"
        tabIndex={-1}
        onMouseDown={(e) => e.preventDefault()}
        onClick={discard}
        className="rounded bg-zinc-700 px-2 py-0.5 hover:bg-zinc-600"
      >
        Discard <span className="opacity-70">⎋</span>
      </button>
      <span className="text-[10px] text-zinc-500">{comparing ? 'showing current mask' : 'hold \\ to compare'}</span>
    </div>
  );
}
