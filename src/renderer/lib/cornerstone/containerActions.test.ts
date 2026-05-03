/**
 * Tests for the §D7.6 containerActions module — high-level
 * Save / Revert / Export entry points used by the list-panel buttons.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockEventTarget } = vi.hoisted(() => ({ mockEventTarget: new EventTarget() }));

vi.mock('@cornerstonejs/core', () => ({
  eventTarget: mockEventTarget,
}));

vi.mock('@cornerstonejs/tools', () => ({
  Enums: {
    Events: {
      SEGMENTATION_ADDED: 'CS_SEGMENTATION_ADDED',
      SEGMENTATION_REMOVED: 'CS_SEGMENTATION_REMOVED',
    },
  },
  segmentation: {
    state: {
      getSegmentation: vi.fn((id: string) => ({ label: id })),
    },
  },
}));

import * as containerBridge from './containerBridge';
import {
  exportContainer,
  nextSliceIndex,
  resetContainerActionsWiring,
  revertContainer,
  saveAllDirty,
  saveContainer,
  stepThroughInterpolated,
  wireContainerActions,
} from './containerActions';
import type { Member } from '../../types/annotation';

const flushNowMock = vi.fn().mockResolvedValue({ kind: 'success', versionToken: 't' });

vi.mock('./segmentationService/transport', () => ({
  flushNow: (id: string) => flushNowMock(id),
}));

function injectMember(csSegId: string, partial: Partial<Member> = {}): string {
  const containerId = containerBridge.register(csSegId);
  const container = containerBridge.getContainer(containerId)!;
  container.members.push({
    id: `${csSegId}__1`,
    name: 'M',
    color: [0, 0, 0],
    visibility: 'filled',
    locked: false,
    provenance: 'manual',
    roiType: null,
    roiNumber: null,
    interpolationState: null,
    segmentIndex: 1,
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
    ...partial,
  });
  return containerId;
}

beforeEach(() => {
  containerBridge.clearAll();
  flushNowMock.mockReset().mockResolvedValue({ kind: 'success', versionToken: 't' });
});

afterEach(() => {
  containerBridge.clearAll();
  resetContainerActionsWiring();
});

// ─── saveContainer ────────────────────────────────────────────────────

describe('saveContainer', () => {
  it('calls transport.flushNow when container is dirty', async () => {
    const id = injectMember('seg_1');
    containerBridge.setDirty(id, true);
    await saveContainer(id);
    expect(flushNowMock).toHaveBeenCalledWith(id);
  });

  it('skips when container is not dirty', async () => {
    const id = injectMember('seg_1');
    containerBridge.setDirty(id, false);
    await saveContainer(id);
    expect(flushNowMock).not.toHaveBeenCalled();
  });

  it('no-op on empty containerId', async () => {
    await expect(saveContainer('')).resolves.toBeUndefined();
    expect(flushNowMock).not.toHaveBeenCalled();
  });

  it('no-op on unknown containerId', async () => {
    await expect(saveContainer('container-unknown')).resolves.toBeUndefined();
    expect(flushNowMock).not.toHaveBeenCalled();
  });

  it('swallows transport errors (UI surfaces them via transportStore)', async () => {
    const id = injectMember('seg_1');
    containerBridge.setDirty(id, true);
    flushNowMock.mockRejectedValueOnce(new Error('boom'));
    await expect(saveContainer(id)).resolves.toBeUndefined();
  });
});

// ─── revertContainer ──────────────────────────────────────────────────

describe('revertContainer', () => {
  it('does not throw on a known container (currently a deferred no-op)', async () => {
    const id = injectMember('seg_1');
    await expect(revertContainer(id)).resolves.toBeUndefined();
  });

  it('no-op on empty containerId', async () => {
    await expect(revertContainer('')).resolves.toBeUndefined();
  });
});

// ─── exportContainer ──────────────────────────────────────────────────

describe('exportContainer', () => {
  const exportToDicomSeg = vi.fn().mockResolvedValue('base64-seg');
  const exportToRtStruct = vi.fn().mockResolvedValue('base64-rt');
  const saveDicomSeg = vi.fn().mockResolvedValue('/path/to/seg.dcm');
  const saveDicomRtStruct = vi.fn().mockResolvedValue('/path/to/rt.dcm');

  beforeEach(() => {
    exportToDicomSeg.mockReset().mockResolvedValue('base64-seg');
    exportToRtStruct.mockReset().mockResolvedValue('base64-rt');
    saveDicomSeg.mockReset().mockResolvedValue('/path/to/seg.dcm');
    saveDicomRtStruct.mockReset().mockResolvedValue('/path/to/rt.dcm');
    wireContainerActions({
      exportToDicomSeg,
      exportToRtStruct,
      saveDicomSeg,
      saveDicomRtStruct,
    });
  });

  it('SEG container → calls exportToDicomSeg + saveDicomSeg', async () => {
    const id = injectMember('seg_1');
    const c = containerBridge.getContainer(id)!;
    c.kind = 'SEG';
    c.name = 'My SEG';
    const result = await exportContainer(id);
    expect(exportToDicomSeg).toHaveBeenCalledWith('seg_1');
    expect(saveDicomSeg).toHaveBeenCalled();
    expect(saveDicomSeg.mock.calls[0][0]).toBe('base64-seg');
    expect(saveDicomSeg.mock.calls[0][1]).toContain('My_SEG');
    expect(result).toBe('/path/to/seg.dcm');
  });

  it('RTSTRUCT container → calls exportToRtStruct + saveDicomRtStruct', async () => {
    const id = injectMember('seg_1');
    const c = containerBridge.getContainer(id)!;
    c.kind = 'RTSTRUCT';
    c.name = 'My RT';
    const result = await exportContainer(id);
    expect(exportToRtStruct).toHaveBeenCalledWith('seg_1');
    expect(saveDicomRtStruct).toHaveBeenCalled();
    expect(saveDicomRtStruct.mock.calls[0][0]).toBe('base64-rt');
    expect(result).toBe('/path/to/rt.dcm');
  });

  it('POI container → returns null (export not yet supported)', async () => {
    const id = injectMember('seg_1');
    containerBridge.getContainer(id)!.kind = 'POI';
    const result = await exportContainer(id);
    expect(result).toBeNull();
    expect(exportToDicomSeg).not.toHaveBeenCalled();
    expect(exportToRtStruct).not.toHaveBeenCalled();
  });

  it('returns null when export fails (errors are swallowed)', async () => {
    const id = injectMember('seg_1');
    containerBridge.getContainer(id)!.kind = 'SEG';
    exportToDicomSeg.mockRejectedValueOnce(new Error('boom'));
    const result = await exportContainer(id);
    expect(result).toBeNull();
  });

  it('sanitizes container name in the default filename', async () => {
    const id = injectMember('seg_1');
    const c = containerBridge.getContainer(id)!;
    c.kind = 'SEG';
    c.name = 'Has / weird : chars';
    await exportContainer(id);
    expect(saveDicomSeg.mock.calls[0][1]).toBe('Has___weird___chars.dcm');
  });

  it('returns null on unknown containerId', async () => {
    const result = await exportContainer('container-unknown');
    expect(result).toBeNull();
  });

  it('returns null when container has no csSegmentationId', async () => {
    const id = containerBridge.register('seg_1');
    // Container exists but has no members → no csSegmentationId.
    const result = await exportContainer(id);
    expect(result).toBeNull();
  });
});

// ─── saveAllDirty ─────────────────────────────────────────────────────

describe('saveAllDirty', () => {
  it('calls flushNow once per dirty container, sequentially', async () => {
    const id1 = injectMember('seg_1');
    const id2 = injectMember('seg_2');
    const id3 = injectMember('seg_3');
    containerBridge.setDirty(id1, true);
    containerBridge.setDirty(id2, false);
    containerBridge.setDirty(id3, true);

    await saveAllDirty();
    expect(flushNowMock).toHaveBeenCalledTimes(2);
    expect(flushNowMock).toHaveBeenCalledWith(id1);
    expect(flushNowMock).toHaveBeenCalledWith(id3);
    expect(flushNowMock).not.toHaveBeenCalledWith(id2);
  });

  it('no-op when nothing is dirty', async () => {
    injectMember('seg_1');
    await saveAllDirty();
    expect(flushNowMock).not.toHaveBeenCalled();
  });
});

// ─── Phase 4.8: nextSliceIndex (pure helper) ───────────────────────────

describe('nextSliceIndex', () => {
  it('returns null on empty list', () => {
    expect(nextSliceIndex(0, [])).toBe(null);
    expect(nextSliceIndex(null, [])).toBe(null);
  });

  it('returns the smallest slice when current is null', () => {
    expect(nextSliceIndex(null, [5, 3, 8])).toBe(3);
  });

  it('returns the smallest index strictly greater than current', () => {
    expect(nextSliceIndex(3, [3, 5, 8])).toBe(5);
    expect(nextSliceIndex(5, [3, 5, 8])).toBe(8);
  });

  it('wraps to the smallest when current is past the last', () => {
    expect(nextSliceIndex(8, [3, 5, 8])).toBe(3);
    expect(nextSliceIndex(99, [3, 5, 8])).toBe(3);
  });

  it('handles unsorted input by sorting first', () => {
    expect(nextSliceIndex(5, [8, 3, 5])).toBe(8);
  });

  it('returns the only element when list has one entry', () => {
    expect(nextSliceIndex(null, [7])).toBe(7);
    expect(nextSliceIndex(7, [7])).toBe(7); // wraps to itself
    expect(nextSliceIndex(2, [7])).toBe(7);
    expect(nextSliceIndex(99, [7])).toBe(7); // wraps to itself
  });
});

// ─── Phase 4.8: stepThroughInterpolated ────────────────────────────────

describe('stepThroughInterpolated', () => {
  function wireStepThroughDeps(opts: {
    activeViewport?: string | null;
    slices?: { currentImageIdIndex: number | null; sliceIndices: number[] } | null;
  }): { scrollCalls: Array<[string, number]>; readCalls: Array<[string, string, number]> } {
    const scrollCalls: Array<[string, number]> = [];
    const readCalls: Array<[string, string, number]> = [];
    wireContainerActions({
      getActiveViewportId: () => opts.activeViewport ?? null,
      readMemberContourSlices: (vp, segId, segIdx) => {
        readCalls.push([vp, segId, segIdx]);
        return opts.slices === undefined
          ? { currentImageIdIndex: 0, sliceIndices: [3, 7, 12] }
          : opts.slices;
      },
      scrollViewportToIndex: (vp, idx) => {
        scrollCalls.push([vp, idx]);
      },
    });
    return { scrollCalls, readCalls };
  }

  it('navigates the active viewport to the next slice in the member', () => {
    injectMember('seg_1');
    const { scrollCalls } = wireStepThroughDeps({ activeViewport: 'vp1' });
    stepThroughInterpolated('seg_1__1');
    expect(scrollCalls).toEqual([['vp1', 3]]);
  });

  it('uses the member’s csSegmentationId + segmentIndex when reading slices', () => {
    injectMember('seg_xyz', { segmentIndex: 4 });
    const { readCalls } = wireStepThroughDeps({ activeViewport: 'vp1' });
    stepThroughInterpolated('seg_xyz__1');
    expect(readCalls).toEqual([['vp1', 'seg_xyz', 4]]);
  });

  it('wraps after the last slice', () => {
    injectMember('seg_1');
    const { scrollCalls } = wireStepThroughDeps({
      activeViewport: 'vp1',
      slices: { currentImageIdIndex: 12, sliceIndices: [3, 7, 12] },
    });
    stepThroughInterpolated('seg_1__1');
    expect(scrollCalls).toEqual([['vp1', 3]]);
  });

  it('no-op when no viewport is active', () => {
    injectMember('seg_1');
    const { scrollCalls } = wireStepThroughDeps({ activeViewport: null });
    stepThroughInterpolated('seg_1__1');
    expect(scrollCalls).toEqual([]);
  });

  it('no-op when the member has no csSegmentationId', () => {
    injectMember('seg_1', { csSegmentationId: null });
    const { scrollCalls } = wireStepThroughDeps({ activeViewport: 'vp1' });
    stepThroughInterpolated('seg_1__1');
    expect(scrollCalls).toEqual([]);
  });

  it('no-op when readMemberContourSlices returns null', () => {
    injectMember('seg_1');
    const { scrollCalls } = wireStepThroughDeps({ activeViewport: 'vp1', slices: null });
    stepThroughInterpolated('seg_1__1');
    expect(scrollCalls).toEqual([]);
  });

  it('no-op when the member’s segmentation has no contour slices', () => {
    injectMember('seg_1');
    const { scrollCalls } = wireStepThroughDeps({
      activeViewport: 'vp1',
      slices: { currentImageIdIndex: 0, sliceIndices: [] },
    });
    stepThroughInterpolated('seg_1__1');
    expect(scrollCalls).toEqual([]);
  });

  it('no-op on unknown memberId', () => {
    injectMember('seg_1');
    const { scrollCalls } = wireStepThroughDeps({ activeViewport: 'vp1' });
    stepThroughInterpolated('not-a-member');
    expect(scrollCalls).toEqual([]);
  });

  it('no-op on empty memberId', () => {
    injectMember('seg_1');
    const { scrollCalls } = wireStepThroughDeps({ activeViewport: 'vp1' });
    stepThroughInterpolated('');
    expect(scrollCalls).toEqual([]);
  });
});
