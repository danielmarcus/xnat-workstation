/**
 * useTimeScrubber — the UI↔service seam for the 4D time-point scrubber (§2). Reads
 * the current/total time points from viewerStore (published by useViewport on load)
 * and exposes setTimepoint, which switches the volume's displayed time point
 * (instant, view-preserving) and updates the store. total <= 1 ⇒ not a 4D series.
 */
import { useCallback } from 'react';
import { viewportService } from '../lib/cornerstone/viewportService';
import { useViewerStore } from '../stores/viewerStore';

export function useTimeScrubber(panelId: string): {
  current: number; // 1-based
  total: number;
  setTimepoint: (t: number) => void;
} {
  const current = useViewerStore((s) => s.panelTimepointMap[panelId] ?? 1);
  const total = useViewerStore((s) => s.panelNumTimepointsMap[panelId] ?? 1);
  const setTimepoint = useCallback(
    (t: number) => {
      viewportService.setTimepoint(panelId, t);
      useViewerStore.getState()._setPanelTimepoint(panelId, t);
    },
    [panelId],
  );
  return { current, total, setTimepoint };
}
