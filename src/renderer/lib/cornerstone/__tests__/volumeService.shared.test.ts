/**
 * Reference-counted shared-volume cache (Phase 1.2).
 *
 * Tests focus on the cache bookkeeping (refCount, key isolation, lifecycle).
 * The Cornerstone volumeLoader is mocked because the volume creation itself
 * is a heavyweight operation we don't need to exercise here — the
 * bookkeeping logic is what's new and testable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock @cornerstonejs/core volumeLoader.createAndCacheVolume + cache.removeVolumeLoadObject.
const mockCreateAndCacheVolume = vi.fn(async (volumeId: string, _opts: { imageIds: string[] }) => ({
  volumeId,
  load: vi.fn(),
}));
const mockRemoveVolumeLoadObject = vi.fn();

vi.mock('@cornerstonejs/core', () => ({
  volumeLoader: {
    createAndCacheVolume: (id: string, opts: { imageIds: string[] }) =>
      mockCreateAndCacheVolume(id, opts),
  },
  cache: {
    removeVolumeLoadObject: (id: string) => mockRemoveVolumeLoadObject(id),
  },
  Enums: {
    Events: {
      IMAGE_LOADED: 'IMAGE_LOADED',
      IMAGE_VOLUME_LOADING_COMPLETED: 'IMAGE_VOLUME_LOADING_COMPLETED',
    },
  },
  eventTarget: {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  },
}));

import { volumeService } from '../volumeService';

describe('volumeService shared-volume cache', () => {
  beforeEach(() => {
    volumeService._clearSharedVolumes();
    mockCreateAndCacheVolume.mockClear();
    mockRemoveVolumeLoadObject.mockClear();
  });

  afterEach(() => {
    volumeService._clearSharedVolumes();
  });

  it('first acquire creates a new volume and returns isNew=true', async () => {
    const result = await volumeService.acquireSharedVolume(
      'scan-1',
      'foruid-1',
      ['img1', 'img2', 'img3'],
    );

    expect(result.isNew).toBe(true);
    expect(result.volumeId).toContain('scan-1');
    expect(result.volumeId).toContain('foruid-1');
    expect(mockCreateAndCacheVolume).toHaveBeenCalledTimes(1);
    expect(volumeService._getSharedVolumeRefCount('scan-1', 'foruid-1')).toBe(1);
  });

  it('second acquire with same key returns existing volume, isNew=false, refcount=2', async () => {
    const first = await volumeService.acquireSharedVolume('scan-1', 'foruid-1', ['img1']);
    const second = await volumeService.acquireSharedVolume('scan-1', 'foruid-1', ['img1']);

    expect(second.isNew).toBe(false);
    expect(second.volumeId).toBe(first.volumeId);
    expect(mockCreateAndCacheVolume).toHaveBeenCalledTimes(1);
    expect(volumeService._getSharedVolumeRefCount('scan-1', 'foruid-1')).toBe(2);
  });

  it('different scanIds → independent volumes', async () => {
    const a = await volumeService.acquireSharedVolume('scan-A', 'foruid-1', ['img']);
    const b = await volumeService.acquireSharedVolume('scan-B', 'foruid-1', ['img']);

    expect(a.volumeId).not.toBe(b.volumeId);
    expect(mockCreateAndCacheVolume).toHaveBeenCalledTimes(2);
  });

  it('different FoRs → independent volumes', async () => {
    const a = await volumeService.acquireSharedVolume('scan-1', 'foruid-A', ['img']);
    const b = await volumeService.acquireSharedVolume('scan-1', 'foruid-B', ['img']);

    expect(a.volumeId).not.toBe(b.volumeId);
    expect(mockCreateAndCacheVolume).toHaveBeenCalledTimes(2);
  });

  it('release decrements refcount, only destroys at 0', async () => {
    await volumeService.acquireSharedVolume('scan-1', 'foruid-1', ['img']);
    await volumeService.acquireSharedVolume('scan-1', 'foruid-1', ['img']);
    expect(volumeService._getSharedVolumeRefCount('scan-1', 'foruid-1')).toBe(2);

    volumeService.releaseSharedVolume('scan-1', 'foruid-1');
    expect(volumeService._getSharedVolumeRefCount('scan-1', 'foruid-1')).toBe(1);
    expect(mockRemoveVolumeLoadObject).not.toHaveBeenCalled();

    volumeService.releaseSharedVolume('scan-1', 'foruid-1');
    expect(volumeService._getSharedVolumeRefCount('scan-1', 'foruid-1')).toBe(0);
    expect(mockRemoveVolumeLoadObject).toHaveBeenCalledTimes(1);
  });

  it('re-acquire after full release creates a fresh volume', async () => {
    const a = await volumeService.acquireSharedVolume('scan-1', 'foruid-1', ['img']);
    volumeService.releaseSharedVolume('scan-1', 'foruid-1');

    const b = await volumeService.acquireSharedVolume('scan-1', 'foruid-1', ['img']);
    expect(b.isNew).toBe(true);
    // Volume IDs are deterministic on (scanId, foruid), so the second creation
    // hits the same volumeId. That's fine — the cache was purged.
    expect(b.volumeId).toBe(a.volumeId);
    expect(mockCreateAndCacheVolume).toHaveBeenCalledTimes(2);
  });

  it('release on an unknown key warns but does not throw', () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => volumeService.releaseSharedVolume('unknown', 'foruid')).not.toThrow();
    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining('unknown'),
    );
    consoleWarn.mockRestore();
  });

  it('getSharedVolumeId returns null when no entry exists', () => {
    expect(volumeService.getSharedVolumeId('scan-1', 'foruid-1')).toBeNull();
  });

  it('getSharedVolumeId returns the cached id when an entry exists', async () => {
    const { volumeId } = await volumeService.acquireSharedVolume('scan-1', 'foruid-1', ['img']);
    expect(volumeService.getSharedVolumeId('scan-1', 'foruid-1')).toBe(volumeId);
  });
});
