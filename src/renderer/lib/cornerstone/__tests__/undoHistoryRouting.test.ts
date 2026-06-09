import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Slice 4 — the routing SEAM: every memo a tool pushes to Cornerstone's global
 * ring must also be routed into the per-container history (tagged by the memo's
 * resolved segmentationId). This is the layer where a per-container-undo bug would
 * actually live, so it is tested directly rather than bypassed: install the push
 * hook over a fake DefaultHistoryMemo, push a memo, and assert it reached the
 * recordContainerMemo dep AFTER enrichment.
 */
const h = vi.hoisted(() => ({
  ring: { push: vi.fn((item: unknown) => item), size: 200, ring: [] as unknown[], position: 0 },
}));

vi.mock('@cornerstonejs/core', () => ({
  utilities: { HistoryMemo: { DefaultHistoryMemo: h.ring } },
}));

import { utilities as csUtilities } from '@cornerstonejs/core';
import { createUndoHistory } from '../segmentationService/undoHistory';

function makeHistory(recordContainerMemo: (memo: unknown) => void) {
  return createUndoHistory({
    getSegmentDisplayLabel: () => 'Segment 1',
    isSegmentLocked: () => false,
    getAnnotation: () => undefined,
    showAlertDialog: () => undefined,
    recordContainerMemo,
  });
}

describe('undoHistory push-hook routing (Slice 4 seam)', () => {
  beforeEach(() => {
    h.ring.push = vi.fn((item: unknown) => item);
  });

  it('routes each pushed (enriched) memo into recordContainerMemo', () => {
    const recorded: unknown[] = [];
    const hist = makeHistory((memo) => recorded.push(memo));
    hist.installHistoryMemoTracking();

    const memo = { segmentationId: 'seg-A', segmentIndex: 1, restoreMemo: () => undefined };
    (csUtilities as unknown as { HistoryMemo: { DefaultHistoryMemo: { push: (i: unknown) => unknown } } })
      .HistoryMemo.DefaultHistoryMemo.push(memo);

    expect(recorded).toEqual([memo]); // reached the per-container recorder
    hist.uninstallHistoryMemoTracking();
  });

  it('does not throw when no recordContainerMemo dep is provided (back-compat)', () => {
    const hist = createUndoHistory({
      getSegmentDisplayLabel: () => 'Segment 1',
      isSegmentLocked: () => false,
      getAnnotation: () => undefined,
      showAlertDialog: () => undefined,
    });
    hist.installHistoryMemoTracking();
    const memo = { segmentationId: 'seg-A', segmentIndex: 1, restoreMemo: () => undefined };
    expect(() =>
      (csUtilities as unknown as { HistoryMemo: { DefaultHistoryMemo: { push: (i: unknown) => unknown } } })
        .HistoryMemo.DefaultHistoryMemo.push(memo),
    ).not.toThrow();
    hist.uninstallHistoryMemoTracking();
  });
});
