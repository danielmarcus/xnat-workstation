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

vi.mock('@cornerstonejs/tools', () => ({
  Enums: {
    Events: {
      SEGMENTATION_ADDED: 'CS_SEGMENTATION_ADDED',
      SEGMENTATION_REMOVED: 'CS_SEGMENTATION_REMOVED',
      SEGMENTATION_MODIFIED: 'CS_SEGMENTATION_MODIFIED',
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
    },
  },
}));

import * as containerBridge from './containerBridge';
import { useContainerSelectionStore } from '../../stores/containerSelectionStore';
import { usePreferencesStore } from '../../stores/preferencesStore';
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
  useContainerSelectionStore.getState().setHover(null);
  usePreferencesStore.getState().setMultiViewportEnabled(true);
});

afterEach(() => {
  containerBridge.clearAll();
  containerBridge.clearChangeListeners();
  csState.annotations.clear();
  useContainerSelectionStore.getState().setHover(null);
  usePreferencesStore.getState().setMultiViewportEnabled(false);
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
    getCurrentImageId: () => opts.imageId,
    worldToCanvas: ([x, y]: [number, number, number]): [number, number] => [x, y],
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

  it('flag-off path: mousemove is a no-op (no scheduling, no setHover)', () => {
    usePreferencesStore.getState().setMultiViewportEnabled(false);
    injectMember('seg_1', 1, 'm-1');
    const { element, viewport } = makeViewportWithContour({
      imageId: 'slice-1',
      polyline: [[0, 0, 0], [10, 0, 0]],
      annotationUID: 'ann-1',
      segmentationId: 'seg_1',
      segmentIndex: 1,
    });
    const dispose = wireContourHoverDetection(element, viewport);
    useContainerSelectionStore.getState().setHover('was-set');
    element.dispatchEvent(new MouseEvent('mousemove', { clientX: 5, clientY: 0 }));
    // Still 'was-set' — flag-off path doesn't even schedule rAF.
    expect(useContainerSelectionStore.getState().hoverMemberId).toBe('was-set');
    dispose();
  });
});
