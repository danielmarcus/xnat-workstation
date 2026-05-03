/**
 * Tests for the Phase 3.5c row → canvas hover sync state machine.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  applyHoverHighlight,
  clearHoverHighlight,
  createHoverDispatcher,
  type MemberHoverSyncDeps,
} from './memberHoverSync';

interface MockCalls {
  setSegmentStyle: Array<[string, number, string, Record<string, unknown>]>;
  resetSegmentStyle: Array<[string, number, string]>;
  renderSegmentationViewports: string[];
}

function makeDeps(opts: {
  representationKinds?: Array<'Labelmap' | 'Contour'>;
} = {}): { deps: MemberHoverSyncDeps; calls: MockCalls } {
  const calls: MockCalls = {
    setSegmentStyle: [],
    resetSegmentStyle: [],
    renderSegmentationViewports: [],
  };
  const deps: MemberHoverSyncDeps = {
    setSegmentStyle: vi.fn((segId, idx, kind, styles) => {
      calls.setSegmentStyle.push([segId, idx, kind, styles]);
    }),
    resetSegmentStyle: vi.fn((segId, idx, kind) => {
      calls.resetSegmentStyle.push([segId, idx, kind]);
    }),
    getRepresentationKinds: () => opts.representationKinds ?? ['Labelmap'],
    renderSegmentationViewports: vi.fn((segId) => {
      calls.renderSegmentationViewports.push(segId);
    }),
  };
  return { deps, calls };
}

describe('applyHoverHighlight', () => {
  it('sets a thicker outline style on the segment', () => {
    const { deps, calls } = makeDeps({ representationKinds: ['Labelmap'] });
    applyHoverHighlight(deps, 'seg_1', 1);
    expect(calls.setSegmentStyle).toHaveLength(1);
    expect(calls.setSegmentStyle[0][3]).toMatchObject({
      outlineWidth: 3,
      outlineOpacity: 1,
    });
  });

  it('contour highlight is thicker than labelmap highlight (per D2 stroke-width-bump rule)', () => {
    const { deps: contourDeps, calls: contourCalls } = makeDeps({ representationKinds: ['Contour'] });
    const { deps: labelmapDeps, calls: labelmapCalls } = makeDeps({ representationKinds: ['Labelmap'] });
    applyHoverHighlight(contourDeps, 'seg_1', 1);
    applyHoverHighlight(labelmapDeps, 'seg_2', 1);
    const contourWidth = contourCalls.setSegmentStyle[0][3].outlineWidth as number;
    const labelmapWidth = labelmapCalls.setSegmentStyle[0][3].outlineWidth as number;
    expect(contourWidth).toBeGreaterThan(labelmapWidth);
  });

  it('applies to all representation kinds for a "both" segmentation', () => {
    const { deps, calls } = makeDeps({ representationKinds: ['Labelmap', 'Contour'] });
    applyHoverHighlight(deps, 'seg_1', 1);
    expect(calls.setSegmentStyle.map((c) => c[2])).toEqual(['Labelmap', 'Contour']);
  });

  it('triggers a render so the style takes effect immediately', () => {
    const { deps, calls } = makeDeps();
    applyHoverHighlight(deps, 'seg_1', 1);
    expect(calls.renderSegmentationViewports).toEqual(['seg_1']);
  });

  it('skips invalid input (empty segmentationId, segmentIndex 0 or negative)', () => {
    const { deps, calls } = makeDeps();
    applyHoverHighlight(deps, '', 1);
    applyHoverHighlight(deps, 'seg_1', 0);
    applyHoverHighlight(deps, 'seg_1', -1);
    applyHoverHighlight(deps, 'seg_1', 1.5);
    expect(calls.setSegmentStyle).toEqual([]);
  });
});

describe('clearHoverHighlight', () => {
  it('resets the per-segment style override for each kind', () => {
    const { deps, calls } = makeDeps({ representationKinds: ['Labelmap', 'Contour'] });
    clearHoverHighlight(deps, 'seg_1', 1);
    expect(calls.resetSegmentStyle).toEqual([
      ['seg_1', 1, 'Labelmap'],
      ['seg_1', 1, 'Contour'],
    ]);
    expect(calls.renderSegmentationViewports).toEqual(['seg_1']);
  });

  it('skips invalid input', () => {
    const { deps, calls } = makeDeps();
    clearHoverHighlight(deps, '', 1);
    clearHoverHighlight(deps, 'seg_1', 0);
    expect(calls.resetSegmentStyle).toEqual([]);
  });
});

describe('createHoverDispatcher', () => {
  it('initial dispatch with a target applies highlight', () => {
    const { deps, calls } = makeDeps();
    const dispatch = createHoverDispatcher(deps);
    dispatch({ segmentationId: 'seg_1', segmentIndex: 1 });
    expect(calls.setSegmentStyle).toHaveLength(1);
    expect(calls.resetSegmentStyle).toEqual([]);
  });

  it('moving to a different target clears the previous before applying the new', () => {
    const { deps, calls } = makeDeps();
    const dispatch = createHoverDispatcher(deps);
    dispatch({ segmentationId: 'seg_1', segmentIndex: 1 });
    dispatch({ segmentationId: 'seg_1', segmentIndex: 2 });

    expect(calls.resetSegmentStyle).toEqual([['seg_1', 1, 'Labelmap']]);
    expect(calls.setSegmentStyle.map((c) => [c[0], c[1]])).toEqual([
      ['seg_1', 1],
      ['seg_1', 2],
    ]);
  });

  it('moving to null clears the current highlight', () => {
    const { deps, calls } = makeDeps();
    const dispatch = createHoverDispatcher(deps);
    dispatch({ segmentationId: 'seg_1', segmentIndex: 1 });
    dispatch(null);
    expect(calls.resetSegmentStyle).toEqual([['seg_1', 1, 'Labelmap']]);
  });

  it('idempotent on no-op (same target dispatched twice)', () => {
    const { deps, calls } = makeDeps();
    const dispatch = createHoverDispatcher(deps);
    dispatch({ segmentationId: 'seg_1', segmentIndex: 1 });
    dispatch({ segmentationId: 'seg_1', segmentIndex: 1 });
    expect(calls.setSegmentStyle).toHaveLength(1);
    expect(calls.resetSegmentStyle).toEqual([]);
  });

  it('null → null is a no-op', () => {
    const { deps, calls } = makeDeps();
    const dispatch = createHoverDispatcher(deps);
    dispatch(null);
    dispatch(null);
    expect(calls.setSegmentStyle).toEqual([]);
    expect(calls.resetSegmentStyle).toEqual([]);
  });

  it('cross-segmentation transition clears + applies on different segmentations', () => {
    const { deps, calls } = makeDeps();
    const dispatch = createHoverDispatcher(deps);
    dispatch({ segmentationId: 'seg_1', segmentIndex: 1 });
    dispatch({ segmentationId: 'seg_2', segmentIndex: 1 });
    expect(calls.resetSegmentStyle[0][0]).toBe('seg_1');
    expect(calls.setSegmentStyle[1][0]).toBe('seg_2');
  });
});
