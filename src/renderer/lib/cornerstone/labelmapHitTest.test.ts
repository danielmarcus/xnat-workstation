/**
 * Tests for the Phase 3.5c-canvas-labelmap voxel sampling helper.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const csState = vi.hoisted(() => ({
  reps: new Map<string, Array<{ type: string; segmentationId: string }>>(),
  // Stub `getSegmentIndexAtWorldPoint` — the test rig drives this with
  // a per-(segId, worldPoint-tag) result table.
  sampleResults: new Map<string, number>(),
}));

vi.mock('@cornerstonejs/core', () => ({}));

vi.mock('@cornerstonejs/tools', () => ({
  Enums: {
    SegmentationRepresentations: {
      Labelmap: 'Labelmap',
      Contour: 'Contour',
      Surface: 'Surface',
    },
  },
  segmentation: {
    state: {
      getViewportSegmentationRepresentations: (vpId: string) =>
        csState.reps.get(vpId) ?? [],
    },
  },
  utilities: {
    segmentation: {
      getSegmentIndexAtWorldPoint: (segId: string, worldPoint: number[]) => {
        // Tag = "segId:x,y,z" so we can prime exact responses per call.
        const key = `${segId}:${worldPoint[0]},${worldPoint[1]},${worldPoint[2]}`;
        return csState.sampleResults.get(key) ?? 0;
      },
    },
  },
}));

import { findLabelmapSegmentAtWorldPoint } from './labelmapHitTest';
import type { HitTestViewport } from './contourHitTest';

beforeEach(() => {
  csState.reps.clear();
  csState.sampleResults.clear();
});
afterEach(() => {
  csState.reps.clear();
  csState.sampleResults.clear();
});

const viewport: HitTestViewport = {
  id: 'vp-1',
  canvasToWorld: ([x, y]) => [x, y, 0],
  worldToCanvas: ([x, y]) => [x, y],
};

describe('findLabelmapSegmentAtWorldPoint', () => {
  it('returns null when viewport is null', () => {
    expect(findLabelmapSegmentAtWorldPoint(null, [0, 0, 0])).toBeNull();
  });

  it('returns null when viewport has no id', () => {
    expect(findLabelmapSegmentAtWorldPoint({}, [0, 0, 0])).toBeNull();
  });

  it('returns null when no labelmap reps are attached', () => {
    csState.reps.set('vp-1', []);
    expect(findLabelmapSegmentAtWorldPoint(viewport, [0, 0, 0])).toBeNull();
  });

  it('skips contour reps (only labelmap reps are sampled)', () => {
    csState.reps.set('vp-1', [{ type: 'Contour', segmentationId: 'rt-1' }]);
    csState.sampleResults.set('rt-1:5,5,0', 7);
    expect(findLabelmapSegmentAtWorldPoint(viewport, [5, 5, 0])).toBeNull();
  });

  it('finds a labelmap segment at the world point', () => {
    csState.reps.set('vp-1', [{ type: 'Labelmap', segmentationId: 'seg_1' }]);
    csState.sampleResults.set('seg_1:5,5,0', 3);
    expect(findLabelmapSegmentAtWorldPoint(viewport, [5, 5, 0])).toEqual({
      segmentationId: 'seg_1',
      segmentIndex: 3,
    });
  });

  it('returns null when sampling returns 0 (no segment at that voxel)', () => {
    csState.reps.set('vp-1', [{ type: 'Labelmap', segmentationId: 'seg_1' }]);
    csState.sampleResults.set('seg_1:5,5,0', 0);
    expect(findLabelmapSegmentAtWorldPoint(viewport, [5, 5, 0])).toBeNull();
  });

  it('returns null when sampling returns a non-integer or negative value', () => {
    csState.reps.set('vp-1', [{ type: 'Labelmap', segmentationId: 'seg_1' }]);
    csState.sampleResults.set('seg_1:5,5,0', -1);
    expect(findLabelmapSegmentAtWorldPoint(viewport, [5, 5, 0])).toBeNull();
  });

  it('iterates multiple labelmap reps and returns the first non-zero hit', () => {
    csState.reps.set('vp-1', [
      { type: 'Labelmap', segmentationId: 'seg_1' },
      { type: 'Labelmap', segmentationId: 'seg_2' },
    ]);
    csState.sampleResults.set('seg_1:5,5,0', 0);
    csState.sampleResults.set('seg_2:5,5,0', 4);
    expect(findLabelmapSegmentAtWorldPoint(viewport, [5, 5, 0])).toEqual({
      segmentationId: 'seg_2',
      segmentIndex: 4,
    });
  });

  it('first non-zero hit wins (later reps not consulted)', () => {
    csState.reps.set('vp-1', [
      { type: 'Labelmap', segmentationId: 'seg_a' },
      { type: 'Labelmap', segmentationId: 'seg_b' },
    ]);
    csState.sampleResults.set('seg_a:5,5,0', 1);
    csState.sampleResults.set('seg_b:5,5,0', 2);
    const hit = findLabelmapSegmentAtWorldPoint(viewport, [5, 5, 0]);
    expect(hit?.segmentationId).toBe('seg_a');
  });

  it('skips reps without a segmentationId', () => {
    csState.reps.set('vp-1', [
      { type: 'Labelmap', segmentationId: '' },
      { type: 'Labelmap', segmentationId: 'seg_real' },
    ]);
    csState.sampleResults.set('seg_real:0,0,0', 5);
    expect(findLabelmapSegmentAtWorldPoint(viewport, [0, 0, 0])).toEqual({
      segmentationId: 'seg_real',
      segmentIndex: 5,
    });
  });
});
