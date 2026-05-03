/**
 * Tests for the Phase 3.5c-canvas contour hit-test logic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const csState = vi.hoisted(() => ({
  annotations: [] as Array<{
    annotationUID?: string;
    metadata?: { referencedImageId?: string };
    data?: { contour?: { polyline?: number[][] } };
  }>,
}));

vi.mock('@cornerstonejs/tools', () => ({
  annotation: {
    state: {
      getAllAnnotations: () => csState.annotations,
    },
  },
}));

import {
  DEFAULT_HIT_RADIUS_PX,
  distanceToSegment,
  findContourAtCanvasPoint,
  type HitTestViewport,
} from './contourHitTest';

beforeEach(() => {
  csState.annotations = [];
});
afterEach(() => {
  csState.annotations = [];
});

// ─── distanceToSegment (pure-logic) ───────────────────────────────────

describe('distanceToSegment', () => {
  it('zero distance for a point on the segment', () => {
    expect(distanceToSegment([5, 5], [0, 0], [10, 10])).toBeCloseTo(0);
  });

  it('perpendicular distance to a line', () => {
    expect(distanceToSegment([5, 0], [0, 0], [10, 0])).toBe(0);
    expect(distanceToSegment([5, 3], [0, 0], [10, 0])).toBe(3);
  });

  it('endpoint distance when projection falls outside the segment', () => {
    // Segment from (0,0) to (10,0); point (-5, 0) is 5 left of the start.
    expect(distanceToSegment([-5, 0], [0, 0], [10, 0])).toBe(5);
    // Same for past-the-end.
    expect(distanceToSegment([15, 0], [0, 0], [10, 0])).toBe(5);
  });

  it('degenerate segment (a==b) → distance to the point', () => {
    expect(distanceToSegment([3, 4], [0, 0], [0, 0])).toBe(5);
  });
});

// ─── findContourAtCanvasPoint ────────────────────────────────────────

function makeViewport(currentImageId: string): HitTestViewport {
  return {
    getCurrentImageId: () => currentImageId,
    // identity world→canvas mapping for tests; first two coords pass through.
    worldToCanvas: ([x, y]) => [x, y],
  };
}

function pushAnnotation(opts: {
  uid: string;
  imageId: string;
  polyline: number[][];
}): void {
  csState.annotations.push({
    annotationUID: opts.uid,
    metadata: { referencedImageId: opts.imageId },
    data: { contour: { polyline: opts.polyline } },
  });
}

describe('findContourAtCanvasPoint', () => {
  it('returns null when no viewport', () => {
    expect(findContourAtCanvasPoint(null, [0, 0])).toBeNull();
  });

  it('returns null when viewport has no current image', () => {
    expect(findContourAtCanvasPoint({ worldToCanvas: () => [0, 0] }, [0, 0])).toBeNull();
  });

  it('returns null when no annotations match the current slice', () => {
    pushAnnotation({ uid: 'a1', imageId: 'other-slice', polyline: [[0, 0, 0], [10, 0, 0]] });
    const result = findContourAtCanvasPoint(makeViewport('slice-1'), [5, 0]);
    expect(result).toBeNull();
  });

  it('finds an annotation whose polyline passes through the cursor', () => {
    pushAnnotation({
      uid: 'a1',
      imageId: 'slice-1',
      polyline: [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]],
    });
    const result = findContourAtCanvasPoint(makeViewport('slice-1'), [5, 0]);
    expect(result?.annotationUID).toBe('a1');
    expect(result?.distance).toBeCloseTo(0);
  });

  it('returns null when cursor is outside the hit radius', () => {
    pushAnnotation({
      uid: 'a1',
      imageId: 'slice-1',
      polyline: [[0, 0, 0], [10, 0, 0]],
    });
    const result = findContourAtCanvasPoint(makeViewport('slice-1'), [50, 50]);
    expect(result).toBeNull();
  });

  it('respects custom hitRadiusPx', () => {
    pushAnnotation({
      uid: 'a1',
      imageId: 'slice-1',
      polyline: [[0, 0, 0], [10, 0, 0]],
    });
    // 8 px above the segment → outside default 12px? no, within. Outside 5px.
    expect(findContourAtCanvasPoint(makeViewport('slice-1'), [5, 8])).not.toBeNull();
    expect(findContourAtCanvasPoint(makeViewport('slice-1'), [5, 8], { hitRadiusPx: 5 })).toBeNull();
  });

  it('picks the closest annotation when multiple are within radius', () => {
    pushAnnotation({
      uid: 'far',
      imageId: 'slice-1',
      polyline: [[0, 5, 0], [10, 5, 0]], // 5px from cursor at [5, 0]
    });
    pushAnnotation({
      uid: 'near',
      imageId: 'slice-1',
      polyline: [[0, 1, 0], [10, 1, 0]], // 1px from cursor at [5, 0]
    });
    const result = findContourAtCanvasPoint(makeViewport('slice-1'), [5, 0]);
    expect(result?.annotationUID).toBe('near');
  });

  it('skips annotations with too-short polylines (< 2 points)', () => {
    pushAnnotation({ uid: 'a1', imageId: 'slice-1', polyline: [[0, 0, 0]] });
    pushAnnotation({ uid: 'a2', imageId: 'slice-1', polyline: [] });
    expect(findContourAtCanvasPoint(makeViewport('slice-1'), [0, 0])).toBeNull();
  });

  it('skips annotations missing annotationUID', () => {
    csState.annotations.push({
      metadata: { referencedImageId: 'slice-1' },
      data: { contour: { polyline: [[0, 0, 0], [10, 0, 0]] } },
    });
    expect(findContourAtCanvasPoint(makeViewport('slice-1'), [5, 0])).toBeNull();
  });

  it('skips annotations whose polyline points fail to project', () => {
    pushAnnotation({ uid: 'a1', imageId: 'slice-1', polyline: [[0, 0, 0], [10, 0, 0]] });
    const viewport: HitTestViewport = {
      getCurrentImageId: () => 'slice-1',
      worldToCanvas: () => null,
    };
    expect(findContourAtCanvasPoint(viewport, [5, 0])).toBeNull();
  });

  it('default hit radius is 12px', () => {
    expect(DEFAULT_HIT_RADIUS_PX).toBe(12);
  });
});
