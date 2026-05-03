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
  resetContainerActionsWiring,
  revertContainer,
  saveAllDirty,
  saveContainer,
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
