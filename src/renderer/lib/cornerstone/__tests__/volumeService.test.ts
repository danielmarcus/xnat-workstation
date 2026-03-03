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
}));

import { generateVolumeId, volumeService } from '../volumeService';

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
