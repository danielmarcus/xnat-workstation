import { beforeEach, describe, expect, it, vi } from 'vitest';

const volumeMocks = vi.hoisted(() => {
  type Listener = (evt: Event & { detail?: unknown }) => void;
  class TestEventTarget {
    private listeners = new Map<string, Set<Listener>>();

    addEventListener(type: string, cb: Listener): void {
      if (!this.listeners.has(type)) {
        this.listeners.set(type, new Set());
      }
      this.listeners.get(type)!.add(cb);
    }

    removeEventListener(type: string, cb: Listener): void {
      this.listeners.get(type)?.delete(cb);
    }

    dispatch(type: string, detail?: unknown): void {
      const evt = { type, detail } as Event & { detail?: unknown };
      for (const cb of this.listeners.get(type) ?? []) {
        cb(evt);
      }
    }

    listenerCount(type: string): number {
      return this.listeners.get(type)?.size ?? 0;
    }

    clear(): void {
      this.listeners.clear();
    }
  }

  const eventTarget = new TestEventTarget();

  return {
    eventTarget,
    createAndCacheVolume: vi.fn(),
    removeVolumeLoadObject: vi.fn(),
    getDynamicVolumeInfo: vi.fn(() => ({ isDynamicVolume: false, timePoints: [], splittingTag: '' })),
  };
});

vi.mock('@cornerstonejs/core', () => ({
  volumeLoader: {
    createAndCacheVolume: volumeMocks.createAndCacheVolume,
  },
  cache: {
    removeVolumeLoadObject: volumeMocks.removeVolumeLoadObject,
  },
  eventTarget: volumeMocks.eventTarget,
  Enums: {
    Events: {
      IMAGE_VOLUME_LOADING_COMPLETED: 'IMAGE_VOLUME_LOADING_COMPLETED',
      IMAGE_LOADED: 'IMAGE_LOADED',
    },
  },
  utilities: { getDynamicVolumeInfo: volumeMocks.getDynamicVolumeInfo },
}));

import { generateVolumeId, volumeSchemeFor, volumeService } from '../volumeService';

describe('volumeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    volumeMocks.eventTarget.clear();
  });

  it('generates stable unique ids with per-millisecond sequence', () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(1700000000000).mockReturnValueOnce(1700000000000).mockReturnValueOnce(1700000001000);

    const a = generateVolumeId();
    const b = generateVolumeId();
    const c = generateVolumeId();

    expect(a).toBe('cornerstoneStreamingImageVolume:xnat_mpr_1700000000000_0');
    expect(b).toBe('cornerstoneStreamingImageVolume:xnat_mpr_1700000000000_1');
    expect(c).toBe('cornerstoneStreamingImageVolume:xnat_mpr_1700000001000_0');
    nowSpy.mockRestore();
  });

  it('creates cached volumes and loads with progress callbacks and listener cleanup', async () => {
    const imageIds = ['img-1', 'img-2', 'img-3'];
    const load = vi.fn(async () => {
      volumeMocks.eventTarget.dispatch('IMAGE_LOADED', { image: { imageId: 'img-1' } });
      volumeMocks.eventTarget.dispatch('IMAGE_LOADED', { image: { imageId: 'img-2' } });
      volumeMocks.eventTarget.dispatch('IMAGE_LOADED', { image: { imageId: 'other' } });
      volumeMocks.eventTarget.dispatch('IMAGE_VOLUME_LOADING_COMPLETED');
    });

    volumeMocks.createAndCacheVolume.mockResolvedValue({ load });

    await volumeService.create('vol-1', imageIds);

    const progress = vi.fn();
    await volumeService.load('vol-1', progress);

    expect(volumeMocks.createAndCacheVolume).toHaveBeenCalledWith('vol-1', { imageIds });
    expect(load).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenCalledWith({ loaded: 1, total: 3 });
    expect(progress).toHaveBeenCalledWith({ loaded: 2, total: 3 });
    expect(progress).toHaveBeenLastCalledWith({ loaded: 3, total: 3 });
    expect(volumeMocks.eventTarget.listenerCount('IMAGE_LOADED')).toBe(0);
    expect(volumeMocks.eventTarget.listenerCount('IMAGE_VOLUME_LOADING_COMPLETED')).toBe(0);
  });

  it('throws clear errors for unknown volumes and supports no-progress loads', async () => {
    await expect(volumeService.load('missing')).rejects.toThrow('[volumeService] Volume not found: missing');

    const load = vi.fn(async () => undefined);
    volumeMocks.createAndCacheVolume.mockResolvedValue({ load });
    await volumeService.create('vol-2', ['img-1']);
    await expect(volumeService.load('vol-2')).resolves.toBeUndefined();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('destroys volume refs and swallows cache cleanup errors', async () => {
    const load = vi.fn(async () => undefined);
    volumeMocks.createAndCacheVolume.mockResolvedValue({ load });
    await volumeService.create('vol-3', ['img-1']);

    volumeMocks.removeVolumeLoadObject.mockImplementationOnce(() => {
      throw new Error('missing cache entry');
    });
    expect(() => volumeService.destroy('vol-3')).not.toThrow();

    await expect(volumeService.load('vol-3')).rejects.toThrow('[volumeService] Volume not found: vol-3');
  });
});

describe('volumeService — shared (scanId, FoR) volumes + ref-counting (Phase 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    volumeMocks.eventTarget.clear();
    volumeMocks.createAndCacheVolume.mockResolvedValue({ load: vi.fn() });
    volumeMocks.getDynamicVolumeInfo.mockReturnValue({ isDynamicVolume: false, timePoints: [], splittingTag: '' });
  });

  it('reuses one volume for the same (scanId, FoR) and increments the refcount', async () => {
    const ids = ['a', 'b', 'c'];
    const r1 = await volumeService.acquire('scan4', 'FoR-1', ids);
    expect(r1.created).toBe(true);
    expect(r1.refCount).toBe(1);

    const r2 = await volumeService.acquire('scan4', 'FoR-1', ids);
    expect(r2.created).toBe(false);
    expect(r2.volumeId).toBe(r1.volumeId);
    expect(r2.refCount).toBe(2);

    expect(volumeMocks.createAndCacheVolume).toHaveBeenCalledTimes(1); // created once, reused
    expect(volumeService.getRefCount(r1.volumeId)).toBe(2);
  });

  it('derives distinct volume ids for different (scanId, FoR) pairs', async () => {
    const a = await volumeService.acquire('scanA', 'FoR-X', ['1']);
    const b = await volumeService.acquire('scanB', 'FoR-X', ['1']);
    const c = await volumeService.acquire('scanA', 'FoR-Y', ['1']);
    expect(new Set([a.volumeId, b.volumeId, c.volumeId]).size).toBe(3);
    expect(a.volumeId).toBe(volumeService.sharedVolumeId('scanA', 'FoR-X'));
  });

  it('destroys + uncaches the volume only when the last holder releases', async () => {
    const r = await volumeService.acquire('scanDestroy', 'FoR-1', ['1']);
    await volumeService.acquire('scanDestroy', 'FoR-1', ['1']); // refcount → 2

    expect(volumeService.release(r.volumeId)).toBe(1);
    expect(volumeMocks.removeVolumeLoadObject).not.toHaveBeenCalledWith(r.volumeId);

    expect(volumeService.release(r.volumeId)).toBe(0);
    expect(volumeMocks.removeVolumeLoadObject).toHaveBeenCalledWith(r.volumeId);
    expect(volumeService.getRefCount(r.volumeId)).toBe(0);
  });

  it('releasing an unknown / over-released volume is a no-op', () => {
    expect(volumeService.release(volumeService.sharedVolumeId('nope', 'nope'))).toBe(0);
    expect(volumeMocks.removeVolumeLoadObject).not.toHaveBeenCalled();
  });
});

describe('volumeService — 4D / multi-volume routing (C6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    volumeMocks.eventTarget.clear();
    volumeMocks.createAndCacheVolume.mockResolvedValue({ load: vi.fn() });
    volumeMocks.getDynamicVolumeInfo.mockReturnValue({ isDynamicVolume: false, timePoints: [], splittingTag: '' });
  });

  it('volumeSchemeFor maps 4D → dynamic loader scheme, 3D → static', () => {
    expect(volumeSchemeFor(true)).toBe('cornerstoneStreamingDynamicImageVolume');
    expect(volumeSchemeFor(false)).toBe('cornerstoneStreamingImageVolume');
  });

  it('acquire routes a 4D series to the DYNAMIC volume loader', async () => {
    volumeMocks.getDynamicVolumeInfo.mockReturnValue({
      isDynamicVolume: true,
      timePoints: [['a'], ['b']],
      splittingTag: 'TriggerTime',
    });
    const { volumeId } = await volumeService.acquire('scan4d', 'FoR-1', ['a0', 'a1', 'b0', 'b1']);
    expect(volumeId.startsWith('cornerstoneStreamingDynamicImageVolume:')).toBe(true);
    expect(volumeMocks.createAndCacheVolume).toHaveBeenCalledWith(volumeId, { imageIds: ['a0', 'a1', 'b0', 'b1'] });
    volumeService.release(volumeId);
  });

  it('acquire routes a normal 3D series to the STATIC volume loader', async () => {
    const { volumeId } = await volumeService.acquire('scan3d', 'FoR-2', ['a0', 'a1', 'a2']);
    expect(volumeId.startsWith('cornerstoneStreamingImageVolume:')).toBe(true);
    expect(volumeId.startsWith('cornerstoneStreamingDynamicImageVolume:')).toBe(false);
    volumeService.release(volumeId);
  });

  it('acquire falls back to static if 4D detection throws (never blocks the load)', async () => {
    volumeMocks.getDynamicVolumeInfo.mockImplementation(() => {
      throw new Error('metadata not ready');
    });
    const { volumeId } = await volumeService.acquire('scanX', 'FoR-3', ['a0']);
    expect(volumeId.startsWith('cornerstoneStreamingImageVolume:')).toBe(true);
    volumeService.release(volumeId);
  });
});
