// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadAndCacheImageMock = vi.hoisted(() => vi.fn());
const getImageLoadObjectMock = vi.hoisted(() => vi.fn());

vi.mock('@cornerstonejs/core', () => ({
  imageLoader: {
    loadAndCacheImage: loadAndCacheImageMock,
  },
  cache: {
    getImageLoadObject: getImageLoadObjectMock,
  },
}));

import { imagePreloadService } from '../imagePreloadService';

describe('imagePreloadService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    imagePreloadService.cancelPreload('panel_0');
    imagePreloadService.cancelPreload('panel_1');
    loadAndCacheImageMock.mockResolvedValue({ imageId: 'mock' });
    getImageLoadObjectMock.mockReturnValue(null); // Nothing cached by default.
  });

  it('calls loadAndCacheImage for all images except the first', async () => {
    const imageIds = ['img-0', 'img-1', 'img-2', 'img-3'];
    imagePreloadService.startPreload('panel_0', imageIds);

    // Wait for async preload to complete.
    await vi.waitFor(() => {
      expect(imagePreloadService.isFullyLoaded('panel_0')).toBe(true);
    });

    // First image should be skipped (already loaded by setStack).
    expect(loadAndCacheImageMock).not.toHaveBeenCalledWith('img-0');
    expect(loadAndCacheImageMock).toHaveBeenCalledWith('img-1');
    expect(loadAndCacheImageMock).toHaveBeenCalledWith('img-2');
    expect(loadAndCacheImageMock).toHaveBeenCalledWith('img-3');
    expect(loadAndCacheImageMock).toHaveBeenCalledTimes(3);
  });

  it('skips already-cached images', async () => {
    getImageLoadObjectMock.mockImplementation((imageId: string) =>
      imageId === 'img-2' ? { promise: Promise.resolve() } : null,
    );

    const imageIds = ['img-0', 'img-1', 'img-2', 'img-3'];
    imagePreloadService.startPreload('panel_0', imageIds);

    await vi.waitFor(() => {
      expect(imagePreloadService.isFullyLoaded('panel_0')).toBe(true);
    });

    // img-2 was cached → should not be loaded again.
    expect(loadAndCacheImageMock).not.toHaveBeenCalledWith('img-2');
    expect(loadAndCacheImageMock).toHaveBeenCalledWith('img-1');
    expect(loadAndCacheImageMock).toHaveBeenCalledWith('img-3');
    expect(loadAndCacheImageMock).toHaveBeenCalledTimes(2);
  });

  it('cancelPreload stops further loads', async () => {
    // Make loads slow so we can cancel mid-flight.
    let resolvers: Array<() => void> = [];
    loadAndCacheImageMock.mockImplementation(
      () => new Promise<void>((resolve) => { resolvers.push(resolve); }),
    );

    const imageIds = ['img-0', 'img-1', 'img-2', 'img-3', 'img-4', 'img-5', 'img-6', 'img-7'];
    imagePreloadService.startPreload('panel_0', imageIds);

    // Let a tick pass so the first batch starts.
    await new Promise((r) => setTimeout(r, 0));

    imagePreloadService.cancelPreload('panel_0');

    // Resolve any pending loads.
    resolvers.forEach((r) => r());

    expect(imagePreloadService.isFullyLoaded('panel_0')).toBe(false);
  });

  it('concurrent panels do not interfere with each other', async () => {
    const idsA = ['a-0', 'a-1', 'a-2'];
    const idsB = ['b-0', 'b-1', 'b-2', 'b-3'];

    imagePreloadService.startPreload('panel_0', idsA);
    imagePreloadService.startPreload('panel_1', idsB);

    await vi.waitFor(() => {
      expect(imagePreloadService.isFullyLoaded('panel_0')).toBe(true);
      expect(imagePreloadService.isFullyLoaded('panel_1')).toBe(true);
    });

    // panel_0: 2 loads (skip a-0), panel_1: 3 loads (skip b-0)
    expect(loadAndCacheImageMock).toHaveBeenCalledTimes(5);
  });

  it('does nothing for single-image stacks', () => {
    imagePreloadService.startPreload('panel_0', ['only-img']);
    expect(loadAndCacheImageMock).not.toHaveBeenCalled();
  });

  it('handles load failures gracefully without crashing', async () => {
    loadAndCacheImageMock.mockRejectedValue(new Error('Network error'));

    const imageIds = ['img-0', 'img-1', 'img-2'];
    imagePreloadService.startPreload('panel_0', imageIds);

    // Should complete without throwing, even though all loads failed.
    await vi.waitFor(() => {
      const progress = imagePreloadService.getProgress('panel_0');
      expect(progress).not.toBeNull();
    });

    // isFullyLoaded may be false (loads failed), but no crash.
    expect(() => imagePreloadService.isFullyLoaded('panel_0')).not.toThrow();
  });
});
