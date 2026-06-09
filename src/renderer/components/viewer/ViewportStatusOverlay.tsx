/**
 * ViewportStatusOverlay — the load-state surface for a viewport: a centered spinner
 * while the volume/stack loads, or a failure message if creation rejected. Renders
 * nothing once ready. Presentational: the state is owned by useViewport and passed
 * in. Sits above the canvas (pointer-events-none) so it never blocks interaction.
 */
interface ViewportStatusOverlayProps {
  panelId: string;
  state: 'loading' | 'ready' | 'error';
}

export default function ViewportStatusOverlay({
  panelId,
  state,
}: ViewportStatusOverlayProps): React.ReactElement | null {
  if (state === 'ready') return null;

  return (
    <div
      data-testid={`viewport-status:${panelId}`}
      className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40"
    >
      {state === 'loading' ? (
        <div data-testid={`viewport-loading:${panelId}`} className="flex flex-col items-center gap-2 text-zinc-300">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-600 border-t-sky-400" />
          <span className="text-xs">Loading…</span>
        </div>
      ) : (
        <div
          data-testid={`viewport-error:${panelId}`}
          className="max-w-[80%] rounded bg-red-950/80 px-3 py-2 text-center text-sm text-red-200"
        >
          Failed to load images
        </div>
      )}
    </div>
  );
}
