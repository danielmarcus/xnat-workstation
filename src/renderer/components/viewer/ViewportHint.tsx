/**
 * Inline transient hint overlay for a single viewport.
 *
 * Phase 2.5b — surfaces the B3 drawing-routing block message that the
 * lock-guard records in `viewportHintStore`. Auto-clear is owned by the
 * store; the component just renders whatever's currently active for
 * its `viewportId`.
 *
 * Visual:
 *   - Top-center of the viewport, non-modal, pointer-events: none so it
 *     can't intercept the user's next gesture.
 *   - Amber tones (warning) on a semi-transparent dark backdrop —
 *     legible on the medical-imaging black canvas without competing
 *     with anatomy.
 *   - `key={revision}` on the wrapper restarts the CSS fade-in animation
 *     when a fresh hint replaces an active one (so repeated blocks feel
 *     like discrete events, not a sticky banner).
 */
import { useViewportHintStore } from '../../stores/viewportHintStore';

interface Props {
  viewportId: string;
}

export function ViewportHint({ viewportId }: Props) {
  const hint = useViewportHintStore((s) => s.hints.get(viewportId)) ?? null;
  if (!hint) return null;
  return (
    <div
      key={hint.revision}
      data-testid={`viewport-hint:${viewportId}`}
      role="status"
      aria-live="polite"
      className="absolute top-2 left-1/2 -translate-x-1/2 px-3 py-2 rounded bg-amber-950/90 border border-amber-700 text-amber-100 text-xs max-w-[80%] text-center pointer-events-none shadow-md animate-[fadeIn_120ms_ease-out]"
    >
      {hint.message}
    </div>
  );
}
