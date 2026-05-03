/**
 * Tests for the Phase 3.5c-canvas hover-sync wiring.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEventTarget } = vi.hoisted(() => ({
  mockEventTarget: new EventTarget(),
}));

const csState = vi.hoisted(() => ({
  annotations: new Map<string, {
    data?: { segmentation?: { segmentationId?: string; segmentIndex?: number } };
  }>(),
}));

vi.mock('@cornerstonejs/core', () => ({
  eventTarget: mockEventTarget,
}));

// Per-viewport labelmap reps + sampling table for the labelmap fallback
// in runHitTest. Tests can prime them per-case.
const csLabelmap = vi.hoisted(() => ({
  reps: new Map<string, Array<{ type: string; segmentationId: string }>>(),
  sampleResults: new Map<string, number>(),
}));

vi.mock('@cornerstonejs/tools', () => ({
  Enums: {
    Events: {
      SEGMENTATION_ADDED: 'CS_SEGMENTATION_ADDED',
      SEGMENTATION_REMOVED: 'CS_SEGMENTATION_REMOVED',
      SEGMENTATION_MODIFIED: 'CS_SEGMENTATION_MODIFIED',
    },
    SegmentationRepresentations: {
      Labelmap: 'Labelmap',
      Contour: 'Contour',
      Surface: 'Surface',
    },
  },
  annotation: {
    state: {
      getAnnotation: (uid: string) => csState.annotations.get(uid),
      getAllAnnotations: () => Array.from(csState.annotations.values()),
    },
  },
  segmentation: {
    state: {
      getSegmentation: (id: string) => ({ label: id }),
      getViewportSegmentationRepresentations: (vpId: string) =>
        csLabelmap.reps.get(vpId) ?? [],
    },
  },
  utilities: {
    segmentation: {
      getSegmentIndexAtWorldPoint: (segId: string, worldPoint: number[]) => {
        const key = `${segId}:${worldPoint[0]},${worldPoint[1]},${worldPoint[2]}`;
        return csLabelmap.sampleResults.get(key) ?? 0;
      },
    },
  },
}));

import * as containerBridge from './containerBridge';
import { useContainerSelectionStore } from '../../stores/containerSelectionStore';
import {
  resolveMemberIdFromAnnotation,
  runHitTest,
  wireContourHoverDetection,
} from './contourHoverSync';
import type { HitTestViewport } from './contourHitTest';
import type { Member } from '../../types/annotation';

beforeEach(() => {
  containerBridge.clearAll();
  containerBridge.clearChangeListeners();
  csState.annotations.clear();
  csLabelmap.reps.clear();
  csLabelmap.sampleResults.clear();
  useContainerSelectionStore.getState().setHover(null);
});

afterEach(() => {
  containerBridge.clearAll();
  containerBridge.clearChangeListeners();
  csState.annotations.clear();
  csLabelmap.reps.clear();
  csLabelmap.sampleResults.clear();
  useContainerSelectionStore.getState().setHover(null);
});

function injectMember(csSegId: string, segmentIndex: number, memberId: string): void {
  const containerId = containerBridge.register(csSegId);
  const member: Member = {
    id: memberId,
    name: 'Test',
    color: [255, 0, 0],
    visibility: 'filled',
    locked: false,
    provenance: 'manual',
    roiType: null,
    roiNumber: null,
    interpolationState: null,
    segmentIndex,
    segmentDescription: null,
    segmentedPropertyCategory: null,
    segmentedPropertyType: null,
    poiPoints: null,
    algebra: null,
    algebraSources: null,
    algebraOutOfDate: false,
    algebraManualOverride: false,
    csAnnotationUIDs: null,
    csSegmentationId: csSegId,
    createdAt: 0,
    modifiedAt: 0,
  };
  containerBridge.getContainer(containerId)!.members.push(member);
}

// ─── resolveMemberIdFromAnnotation ────────────────────────────────────

describe('resolveMemberIdFromAnnotation', () => {
  it('returns the matching memberId when annotation maps to a registered member', () => {
    injectMember('seg_1', 1, 'm-1');
    csState.annotations.set('ann-1', {
      data: { segmentation: { segmentationId: 'seg_1', segmentIndex: 1 } },
    });
    expect(resolveMemberIdFromAnnotation('ann-1')).toBe('m-1');
  });

  it('returns null when the annotation has no segmentation reference', () => {
    csState.annotations.set('ann-loose', { data: {} });
    expect(resolveMemberIdFromAnnotation('ann-loose')).toBeNull();
  });

  it('returns null when the annotation’s segmentation isn’t bridge-tracked', () => {
    csState.annotations.set('ann-1', {
      data: { segmentation: { segmentationId: 'seg-untracked', segmentIndex: 1 } },
    });
    expect(resolveMemberIdFromAnnotation('ann-1')).toBeNull();
  });

  it('returns null when the bridge container has no member at that segmentIndex', () => {
    injectMember('seg_1', 1, 'm-1');
    csState.annotations.set('ann-2', {
      data: { segmentation: { segmentationId: 'seg_1', segmentIndex: 99 } },
    });
    expect(resolveMemberIdFromAnnotation('ann-2')).toBeNull();
  });

  it('returns null on empty / unknown annotationUID', () => {
    expect(resolveMemberIdFromAnnotation('')).toBeNull();
    expect(resolveMemberIdFromAnnotation('nonexistent')).toBeNull();
  });

  it('returns null when segmentIndex is 0 or negative', () => {
    csState.annotations.set('ann-bad', {
      data: { segmentation: { segmentationId: 'seg_1', segmentIndex: 0 } },
    });
    expect(resolveMemberIdFromAnnotation('ann-bad')).toBeNull();
  });
});

// ─── runHitTest ───────────────────────────────────────────────────────

function makeViewportWithContour(opts: {
  imageId: string;
  polyline: number[][];
  annotationUID: string;
  segmentationId: string;
  segmentIndex: number;
}): { element: HTMLElement; viewport: () => HitTestViewport | null } {
  csState.annotations.set(opts.annotationUID, {
    data: { segmentation: { segmentationId: opts.segmentationId, segmentIndex: opts.segmentIndex } },
  });
  // Contour annotation also needs metadata.referencedImageId + data.contour.polyline
  // for findContourAtCanvasPoint. Push the full shape.
  csState.annotations.set(opts.annotationUID, {
    ...csState.annotations.get(opts.annotationUID),
    ...{
      annotationUID: opts.annotationUID,
      metadata: { referencedImageId: opts.imageId },
      data: {
        contour: { polyline: opts.polyline },
        segmentation: { segmentationId: opts.segmentationId, segmentIndex: opts.segmentIndex },
      },
    } as Record<string, unknown>,
  });

  const element = document.createElement('div');
  element.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: 200,
    bottom: 200,
    width: 200,
    height: 200,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);

  const viewport: () => HitTestViewport = () => ({
    id: 'vp-test',
    getCurrentImageId: () => opts.imageId,
    worldToCanvas: ([x, y]: [number, number, number]): [number, number] => [x, y],
    canvasToWorld: ([x, y]: [number, number]): [number, number, number] => [x, y, 0],
  });

  return { element, viewport };
}

describe('runHitTest', () => {
  it('cursor over a contour sets hover to the matching member', () => {
    injectMember('seg_1', 1, 'm-1');
    const { element, viewport } = makeViewportWithContour({
      imageId: 'slice-1',
      polyline: [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]],
      annotationUID: 'ann-1',
      segmentationId: 'seg_1',
      segmentIndex: 1,
    });

    runHitTest(element, viewport, 5, 0);
    expect(useContainerSelectionStore.getState().hoverMemberId).toBe('m-1');
  });

  it('cursor in empty space clears hover', () => {
    injectMember('seg_1', 1, 'm-1');
    const { element, viewport } = makeViewportWithContour({
      imageId: 'slice-1',
      polyline: [[0, 0, 0], [10, 0, 0]],
      annotationUID: 'ann-1',
      segmentationId: 'seg_1',
      segmentIndex: 1,
    });
    useContainerSelectionStore.getState().setHover('previously-set');

    runHitTest(element, viewport, 100, 100);
    expect(useContainerSelectionStore.getState().hoverMemberId).toBeNull();
  });

  it('cursor over a contour whose member is unregistered → setHover(null)', () => {
    // No injectMember — annotation references a segmentation the bridge
    // doesn't know about.
    const { element, viewport } = makeViewportWithContour({
      imageId: 'slice-1',
      polyline: [[0, 0, 0], [10, 0, 0]],
      annotationUID: 'ann-1',
      segmentationId: 'untracked',
      segmentIndex: 1,
    });
    useContainerSelectionStore.getState().setHover('previously-set');

    runHitTest(element, viewport, 5, 0);
    expect(useContainerSelectionStore.getState().hoverMemberId).toBeNull();
  });

  it('null viewport clears hover', () => {
    useContainerSelectionStore.getState().setHover('was-set');
    const element = document.createElement('div');
    runHitTest(element, () => null, 0, 0);
    expect(useContainerSelectionStore.getState().hoverMemberId).toBeNull();
  });

  it('subtracts the bounding-rect offset to convert client coords to canvas coords', () => {
    injectMember('seg_1', 1, 'm-1');
    const { viewport } = makeViewportWithContour({
      imageId: 'slice-1',
      polyline: [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]],
      annotationUID: 'ann-1',
      segmentationId: 'seg_1',
      segmentIndex: 1,
    });

    // Create a new element whose bounding rect is offset.
    const element = document.createElement('div');
    element.getBoundingClientRect = () => ({
      left: 100,
      top: 200,
      right: 300,
      bottom: 400,
      width: 200,
      height: 200,
      x: 100,
      y: 200,
      toJSON: () => ({}),
    } as DOMRect);

    // Client (105, 200) → canvas (5, 0) which is on the polyline.
    runHitTest(element, viewport, 105, 200);
    expect(useContainerSelectionStore.getState().hoverMemberId).toBe('m-1');
  });

  // ─── Phase 3.5c-canvas-labelmap fallback ──────────────────────────────

  it('falls back to labelmap detection when no contour is hit', () => {
    injectMember('lm_1', 5, 'm-lm');
    csLabelmap.reps.set('vp-test', [{ type: 'Labelmap', segmentationId: 'lm_1' }]);
    csLabelmap.sampleResults.set('lm_1:42,42,0', 5);

    const { element, viewport } = makeViewportWithContour({
      // No contour anywhere near (42,42) — but a labelmap is.
      imageId: 'slice-1',
      polyline: [[0, 0, 0], [1, 0, 0]],
      annotationUID: 'ann-elsewhere',
      segmentationId: 'seg-other',
      segmentIndex: 1,
    });

    runHitTest(element, viewport, 42, 42);
    expect(useContainerSelectionStore.getState().hoverMemberId).toBe('m-lm');
  });

  it('contour hit takes precedence over labelmap (visually-topmost rule)', () => {
    injectMember('seg_1', 1, 'm-contour');
    injectMember('lm_1', 5, 'm-lm');
    csLabelmap.reps.set('vp-test', [{ type: 'Labelmap', segmentationId: 'lm_1' }]);
    csLabelmap.sampleResults.set('lm_1:5,0,0', 5);

    const { element, viewport } = makeViewportWithContour({
      imageId: 'slice-1',
      polyline: [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]],
      annotationUID: 'ann-1',
      segmentationId: 'seg_1',
      segmentIndex: 1,
    });

    // Cursor at (5,0) is on the contour AND inside a labelmap voxel
    // returning 5 — contour wins.
    runHitTest(element, viewport, 5, 0);
    expect(useContainerSelectionStore.getState().hoverMemberId).toBe('m-contour');
  });

  it('cursor in empty space (no contour, no labelmap voxel) clears hover', () => {
    csLabelmap.reps.set('vp-test', [{ type: 'Labelmap', segmentationId: 'lm_1' }]);
    // No sample priming — defaults to 0.

    const { element, viewport } = makeViewportWithContour({
      imageId: 'slice-1',
      polyline: [[0, 0, 0], [1, 0, 0]],
      annotationUID: 'ann-elsewhere',
      segmentationId: 'seg-other',
      segmentIndex: 1,
    });
    useContainerSelectionStore.getState().setHover('was-set');

    runHitTest(element, viewport, 42, 42);
    expect(useContainerSelectionStore.getState().hoverMemberId).toBeNull();
  });

  it('labelmap hit but member not in bridge → setHover(null) (graceful miss)', () => {
    csLabelmap.reps.set('vp-test', [{ type: 'Labelmap', segmentationId: 'lm-untracked' }]);
    csLabelmap.sampleResults.set('lm-untracked:42,42,0', 3);

    const { element, viewport } = makeViewportWithContour({
      imageId: 'slice-1',
      polyline: [[0, 0, 0], [1, 0, 0]],
      annotationUID: 'ann-elsewhere',
      segmentationId: 'seg-other',
      segmentIndex: 1,
    });

    runHitTest(element, viewport, 42, 42);
    expect(useContainerSelectionStore.getState().hoverMemberId).toBeNull();
  });

  it('viewport without canvasToWorld → labelmap fallback skipped (clears hover)', () => {
    injectMember('lm_1', 5, 'm-lm');
    csLabelmap.reps.set('vp-test', [{ type: 'Labelmap', segmentationId: 'lm_1' }]);
    csLabelmap.sampleResults.set('lm_1:42,42,0', 5);

    const element = document.createElement('div');
    element.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 100, bottom: 100,
      width: 100, height: 100, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    // Viewport with NO canvasToWorld — labelmap fallback can't run.
    const viewport = (): HitTestViewport => ({
      id: 'vp-test',
      getCurrentImageId: () => 'slice-1',
      worldToCanvas: ([x, y]: [number, number, number]) => [x, y] as [number, number],
    });

    runHitTest(element, viewport, 42, 42);
    expect(useContainerSelectionStore.getState().hoverMemberId).toBeNull();
  });
});

// ─── wireContourHoverDetection (integration with mouse events) ───────

describe('wireContourHoverDetection', () => {
  it('mouseleave clears the hover even mid-rAF', () => {
    const element = document.createElement('div');
    const dispose = wireContourHoverDetection(element, () => null);

    useContainerSelectionStore.getState().setHover('was-set');
    element.dispatchEvent(new MouseEvent('mouseleave'));
    expect(useContainerSelectionStore.getState().hoverMemberId).toBeNull();

    dispose();
  });

  it('disposer removes listeners (subsequent events do not fire hit-tests)', () => {
    injectMember('seg_1', 1, 'm-1');
    const { element, viewport } = makeViewportWithContour({
      imageId: 'slice-1',
      polyline: [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]],
      annotationUID: 'ann-1',
      segmentationId: 'seg_1',
      segmentIndex: 1,
    });
    const dispose = wireContourHoverDetection(element, viewport);
    dispose();

    // After dispose, mousemove should NOT trigger anything.
    element.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, clientY: 0 }));
    // Nothing was scheduled; hover stays null (it was null at the start).
    expect(useContainerSelectionStore.getState().hoverMemberId).toBeNull();
  });

  // Phase 6.6 deleted the multiViewport.enabled flag. The legacy
  // "flag-off: mousemove is a no-op" test is no longer meaningful —
  // hover-sync is unconditional now.
});
