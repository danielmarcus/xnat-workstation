/**
 * useSegmentMetrics — inline per-segment geometry metrics for the Annotations panel
 * member rows (frozen mockup §3: `86 cm³` in the row's metric slot).
 *
 * The numbers come from `segmentationService.getSegmentStatistics`, which runs
 * Cornerstone's labelmap-statistics worker — far too expensive to call per render or
 * per paint event. So this hook:
 *   • only computes for SEG containers that are currently EXPANDED (visible rows);
 *   • debounces on `segmentationStore.editEpoch` (bumped when labelmap pixels
 *     change), so a stroke recomputes once after it settles, not per event;
 *   • caches by container + segment index + the epoch it was computed at, and keeps
 *     showing the previous value while a recompute is in flight (no flicker).
 */
import { useEffect, useRef, useState } from 'react';
import type { Container } from '@shared/types/annotation';
import { useSegmentationStore } from '../stores/segmentationStore';
import { segmentationService } from '../lib/cornerstone/segmentationService';
import { formatSegmentMetric } from '../lib/annotations/segmentMetric';

/** Debounce for the statistics worker after the last labelmap edit. */
const SETTLE_MS = 700;

const keyOf = (containerId: string, segmentIndex: number) => `${containerId}:${segmentIndex}`;

export function useSegmentMetrics(
  containers: Container[],
  isExpanded: (containerId: string) => boolean,
): (containerId: string, segmentIndex: number) => string | undefined {
  const editEpoch = useSegmentationStore((s) => s.editEpoch);
  const [metrics, setMetrics] = useState<Record<string, string | undefined>>({});
  // Guards against a slow worker result overwriting a newer one.
  const runIdRef = useRef(0);

  // The visible SEG (container, segment) pairs — recompute when this set changes
  // (create/delete/expand) or when an edit lands.
  const targets = containers
    .filter((c) => c.kind === 'SEG' && isExpanded(c.id))
    .map((c) => ({
      id: c.id,
      indices: c.members
        .map((m) => m.segmentIndex ?? Number(m.id))
        .filter((n) => Number.isInteger(n) && n > 0),
    }))
    .filter((t) => t.indices.length > 0);
  const signature = targets.map((t) => `${t.id}#${t.indices.join(',')}`).join('|');

  useEffect(() => {
    if (targets.length === 0) {
      setMetrics((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }
    const runId = ++runIdRef.current;
    const timer = setTimeout(() => {
      void (async () => {
        const next: Record<string, string | undefined> = {};
        for (const target of targets) {
          try {
            const byIndex = await segmentationService.getSegmentStatistics(target.id, target.indices);
            for (const index of target.indices) {
              next[keyOf(target.id, index)] = formatSegmentMetric(byIndex[index]);
            }
          } catch (err) {
            // Statistics are a nicety: leave the row's metric blank rather than
            // surfacing a failure (CLAUDE.md surface taxonomy — silent + warn).
            console.warn(`[useSegmentMetrics] statistics for ${target.id} failed:`, err);
          }
        }
        if (runId !== runIdRef.current) return; // superseded by a newer run
        setMetrics((prev) => ({ ...prev, ...next }));
      })();
    }, SETTLE_MS);
    return () => clearTimeout(timer);
    // `targets` is derived from `signature`; depending on the string keeps the effect
    // from re-running on every render (a fresh array identity each time).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, editEpoch]);

  return (containerId: string, segmentIndex: number) => metrics[keyOf(containerId, segmentIndex)];
}
