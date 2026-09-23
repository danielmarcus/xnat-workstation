import { describe, it, expect } from 'vitest';
import { labelmapStorage } from '../labelmapLayers';

describe('labelmapStorage', () => {
  it('reads Cornerstone 5 layers: a stack layer on a volume viewport has no volumeId', () => {
    // The exact shape v5 stores for a sub-seg attached to an ORTHOGRAPHIC viewport.
    const v5 = {
      imageIds: ['generated:a_0', 'generated:a_1'],
      labelmaps: {
        'a-storage-0': { labelmapId: 'a-storage-0', storageKind: 'stack', imageIds: ['generated:a_0', 'generated:a_1'] },
      },
      primaryLabelmapId: 'a-storage-0',
      segmentBindings: { 1: { labelmapId: 'a-storage-0', labelValue: 1 } },
    };
    expect(labelmapStorage(v5)).toEqual({ volumeIds: [], imageIdLists: [['generated:a_0', 'generated:a_1']] });
  });

  it('reads volume and stack layers side by side', () => {
    const mixed = {
      labelmaps: {
        v: { storageKind: 'volume', volumeId: 'vol-1' },
        s: { storageKind: 'stack', imageIds: ['x'] },
      },
    };
    expect(labelmapStorage(mixed)).toEqual({ volumeIds: ['vol-1'], imageIdLists: [['x']] });
  });

  it('falls back to the 4.x top-level fields when there are no layers', () => {
    expect(labelmapStorage({ volumeId: 'vol-4x' })).toEqual({ volumeIds: ['vol-4x'], imageIdLists: [] });
    expect(labelmapStorage({ imageIds: ['a', 'b'] })).toEqual({ volumeIds: [], imageIdLists: [['a', 'b']] });
  });

  it('is empty for missing or empty data', () => {
    expect(labelmapStorage(undefined)).toEqual({ volumeIds: [], imageIdLists: [] });
    expect(labelmapStorage({ imageIds: [] })).toEqual({ volumeIds: [], imageIdLists: [] });
  });
});
