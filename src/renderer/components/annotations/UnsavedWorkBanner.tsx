/**
 * UnsavedWorkBanner (Lifecycle track L3 — A13 / E5). A persistent, dismissible
 * banner below the toolbar that surfaces annotation work retained in memory for
 * sessions OTHER than the one you're viewing — so unsaved edits are never silently
 * stranded when you navigate to another session. Per the CLAUDE.md surface taxonomy
 * this is a Banner (non-routine, high-stakes, persistent until dismissed), NOT a
 * toast and NOT the silent in-place autosave row.
 *
 * The presentational banner renders a given summary; the connected container reads
 * the live stores (segmentations + xnatOrigin session + per-container dirty +
 * active session) and computes the summary via the pure unsavedWorkBySession (L1).
 */
import { useEffect, useMemo, useState } from 'react';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { useSegmentationManagerStore } from '../../stores/segmentationManagerStore';
import { useViewerStore } from '../../stores/viewerStore';
import { unsavedWorkBySession, type UnsavedSessionSummary } from '../../lib/annotations/sessionLifecycle';

export function UnsavedWorkBanner(props: {
  sessions: UnsavedSessionSummary[];
  /** Resolve a friendly session label (falls back to the id). */
  sessionLabelOf?: (sessionId: string) => string | undefined;
  onDismiss: () => void;
}) {
  const { sessions, sessionLabelOf, onDismiss } = props;
  if (sessions.length === 0) return null;
  const total = sessions.reduce((n, s) => n + s.count, 0);
  const names = sessions.map((s) => sessionLabelOf?.(s.sessionId) ?? s.sessionId).join(', ');
  return (
    <div
      data-testid="unsaved-work-banner"
      role="status"
      className="flex items-center gap-2 px-3 py-1.5 text-[11px] bg-amber-950/60 border-b border-amber-700/60 text-amber-200"
    >
      <span aria-hidden="true">⚠</span>
      <span className="flex-1 min-w-0 truncate">
        {total} unsaved annotation{total === 1 ? '' : 's'} retained in {sessions.length} other session
        {sessions.length === 1 ? '' : 's'}: <span className="text-amber-100 font-medium">{names}</span>
      </span>
      <button
        type="button"
        className="shrink-0 px-2 py-0.5 rounded text-amber-300 hover:text-amber-100 hover:bg-amber-800/40"
        aria-label="Dismiss unsaved-work banner"
        onClick={onDismiss}
      >
        Dismiss
      </button>
    </div>
  );
}

export default function UnsavedWorkBannerContainer() {
  const segmentations = useSegmentationStore((s) => s.segmentations);
  const xnatOriginMap = useSegmentationStore((s) => s.xnatOriginMap);
  const dirtySegIds = useSegmentationManagerStore((s) => s.dirtySegIds);
  const activeSessionId = useViewerStore((s) => s.sessionId);

  const sessions = useMemo(
    () =>
      unsavedWorkBySession(
        segmentations.map((seg) => ({
          source: { sessionId: xnatOriginMap[seg.segmentationId]?.sessionId ?? '' },
          dirty: !!dirtySegIds[seg.segmentationId],
        })),
        activeSessionId ?? null,
      ),
    [segmentations, xnatOriginMap, dirtySegIds, activeSessionId],
  );

  // Dismiss hides the banner until the set of unsaved sessions CHANGES (new
  // stranded work re-surfaces it). Keyed on the sorted session-id signature.
  const signature = sessions.map((s) => s.sessionId).sort().join('|');
  const [dismissedSig, setDismissedSig] = useState<string | null>(null);
  useEffect(() => {
    setDismissedSig((prev) => (prev !== null && prev !== signature ? null : prev));
  }, [signature]);
  if (dismissedSig === signature) return null;

  return <UnsavedWorkBanner sessions={sessions} onDismiss={() => setDismissedSig(signature)} />;
}
