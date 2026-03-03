import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  metaDataGet: vi.fn(),
  dataSetIsLoaded: vi.fn(),
  dataSetLoad: vi.fn(),
  dataSetGet: vi.fn(),
}));

vi.mock('@cornerstonejs/core', () => ({
  metaData: {
    get: mocks.metaDataGet,
  },
}));

vi.mock('@cornerstonejs/dicom-image-loader', () => ({
  wadouri: {
    dataSetCacheManager: {
      isLoaded: mocks.dataSetIsLoaded,
      load: mocks.dataSetLoad,
      get: mocks.dataSetGet,
    },
  },
}));

import {
  SEG_LOCK_STALE_MS,
  acquireSegLock,
  clearRecoveredSessions,
  clearSegLoadingLocks,
  extractObjectUidFromImageId,
  findPanelByReferencedSopInstanceUIDs,
  findPanelBySeriesUID,
  findSourceScanByReferencedSopInstanceUIDs,
  findSourceScanBySeriesUID,
  getSeriesUidForImageId,
  getSopInstanceUidForImageId,
  hasRecoveredSession,
  isPrimaryImageScan,
  markRecoveredSession,
  releaseSegLock,
  toWadouriUri,
} from '../appHelpers';

describe('appHelpers', () => {
  beforeEach(() => {
    clearRecoveredSessions();
    clearSegLoadingLocks();
    vi.clearAllMocks();
    mocks.dataSetIsLoaded.mockReturnValue(true);
    mocks.dataSetLoad.mockResolvedValue(undefined);
    mocks.dataSetGet.mockReturnValue(undefined);
    mocks.metaDataGet.mockReturnValue(undefined);
  });

  it('classifies primary image scans deterministically', () => {
    expect(
      isPrimaryImageScan({
        id: '1',
        sopClassUID: '1.2.840.10008.5.1.4.1.1.2',
      } as any),
    ).toBe(true);

    expect(
      isPrimaryImageScan({
        id: '2',
        sopClassUID: '1.2.840.10008.5.1.4.1.1.66.4',
      } as any),
    ).toBe(false);

    expect(
      isPrimaryImageScan({
        id: '3',
        modality: 'SR',
      } as any),
    ).toBe(false);

    expect(
      isPrimaryImageScan({
        id: '4',
        xsiType: 'xnat:otherDicomScanData',
      } as any),
    ).toBe(false);
  });

  it('tracks recovered sessions idempotently', () => {
    expect(hasRecoveredSession('S1')).toBe(false);
    markRecoveredSession('S1');
    expect(hasRecoveredSession('S1')).toBe(true);
    clearRecoveredSessions();
    expect(hasRecoveredSession('S1')).toBe(false);
  });

  it('enforces SEG loading locks and stale expiration', () => {
    expect(acquireSegLock('seg-1', 1000)).toBe(true);
    expect(acquireSegLock('seg-1', 1001)).toBe(false);
    expect(acquireSegLock('seg-1', 1000 + SEG_LOCK_STALE_MS + 1)).toBe(true);
    releaseSegLock('seg-1');
    expect(acquireSegLock('seg-1', 2000)).toBe(true);
  });

  it('normalizes wadouri URI and extracts SOP UID query params', () => {
    expect(toWadouriUri('wadouri:https://xnat/path?objectUID=abc')).toBe('https://xnat/path?objectUID=abc');
    expect(extractObjectUidFromImageId('wadouri:https://xnat/path?objectUID=abc')).toBe('abc');
    expect(extractObjectUidFromImageId('wadouri:https://xnat/path?SOPInstanceUID=def')).toBe('def');
    expect(extractObjectUidFromImageId('wadouri:https://xnat/path?objectUid=ghi')).toBe('ghi');
    expect(extractObjectUidFromImageId('wadouri:https://xnat/path')).toBeNull();
  });

  it('finds loaded panel by series UID', () => {
    const result = findPanelBySeriesUID(
      'SERIES_MATCH',
      { panel_0: ['img0'], panel_1: ['img1'] },
      (module, imageId) =>
        module === 'generalSeriesModule' && imageId === 'img1'
          ? ({ seriesInstanceUID: 'SERIES_MATCH' } as any)
          : undefined,
    );
    expect(result).toEqual({ panelId: 'panel_1', imageIds: ['img1'] });
    expect(findPanelBySeriesUID('nope', { panel_0: ['img0'] }, () => undefined)).toBeNull();
  });

  it('finds loaded panel by referenced SOP UIDs via URL or metadata fallback', () => {
    const panelImageIds = {
      panel_0: ['wadouri:https://xnat/file?objectUID=SOP_FAST'],
      panel_1: ['img-no-query'],
    };
    const fast = findPanelByReferencedSopInstanceUIDs(['SOP_FAST'], panelImageIds, () => undefined);
    expect(fast).toEqual({
      panelId: 'panel_0',
      imageIds: panelImageIds.panel_0,
    });

    const metadataFallback = findPanelByReferencedSopInstanceUIDs(
      ['SOP_META'],
      panelImageIds,
      (module, imageId) =>
        module === 'sopCommonModule' && imageId === 'img-no-query'
          ? ({ sopInstanceUID: 'SOP_META' } as any)
          : undefined,
    );
    expect(metadataFallback).toEqual({
      panelId: 'panel_1',
      imageIds: panelImageIds.panel_1,
    });

    expect(findPanelByReferencedSopInstanceUIDs([], panelImageIds, () => undefined)).toBeNull();
  });

  it('resolves series UID from metadata first, then dataset cache fallback', async () => {
    mocks.metaDataGet.mockReturnValueOnce({ seriesInstanceUID: 'META_SERIES' });
    await expect(getSeriesUidForImageId('img-meta')).resolves.toBe('META_SERIES');

    mocks.metaDataGet.mockReturnValue(undefined);
    mocks.dataSetIsLoaded.mockReturnValue(false);
    mocks.dataSetGet.mockReturnValue({ string: vi.fn(() => 'DATASET_SERIES') });
    await expect(getSeriesUidForImageId('wadouri:https://xnat/s1')).resolves.toBe('DATASET_SERIES');
    expect(mocks.dataSetLoad).toHaveBeenCalled();

    mocks.dataSetLoad.mockRejectedValueOnce(new Error('boom'));
    await expect(getSeriesUidForImageId('wadouri:https://xnat/s2')).resolves.toBeNull();
  });

  it('resolves SOP UID from URL first, then metadata/dataset fallback', async () => {
    await expect(
      getSopInstanceUidForImageId('wadouri:https://xnat/file?SOPInstanceUID=SOP_URL'),
    ).resolves.toBe('SOP_URL');

    mocks.metaDataGet.mockReturnValueOnce({ sopInstanceUID: 'SOP_META' });
    await expect(getSopInstanceUidForImageId('img-meta')).resolves.toBe('SOP_META');

    mocks.metaDataGet.mockReturnValue(undefined);
    mocks.dataSetIsLoaded.mockReturnValue(false);
    mocks.dataSetGet.mockReturnValue({ string: vi.fn(() => 'SOP_DATASET') });
    await expect(getSopInstanceUidForImageId('wadouri:https://xnat/s1')).resolves.toBe('SOP_DATASET');
    expect(mocks.dataSetLoad).toHaveBeenCalled();
  });

  it('finds source scan by series UID and skips non-primary scans', async () => {
    const getScanImageIds = vi.fn(async (_sessionId: string, scanId: string) => {
      if (scanId === '2') return ['img-2-a', 'img-2-b'];
      return [];
    });
    const getSeriesUid = vi.fn(async (imageId: string) => (imageId === 'img-2-a' ? 'SERIES_MATCH' : null));

    const result = await findSourceScanBySeriesUID(
      'S1',
      'SERIES_MATCH',
      [
        { id: 'seg', sopClassUID: '1.2.840.10008.5.1.4.1.1.66.4' },
        { id: '2', modality: 'CT' },
      ] as any,
      { getScanImageIds, getSeriesUidForImageId: getSeriesUid },
    );

    expect(result).toEqual({ scanId: '2', imageIds: ['img-2-a', 'img-2-b'] });
    expect(getScanImageIds).toHaveBeenCalledTimes(1);
  });

  it('finds source scan by SOP fallback and tolerates per-scan errors', async () => {
    const getScanImageIds = vi.fn(async (_sessionId: string, scanId: string) => {
      if (scanId === '1') throw new Error('network');
      if (scanId === '2') return ['img-no-query-1', 'img-no-query-2'];
      return [];
    });
    const getSop = vi.fn(async (imageId: string) => (imageId === 'img-no-query-1' ? 'SOP_MATCH' : null));

    const result = await findSourceScanByReferencedSopInstanceUIDs(
      'S1',
      ['SOP_MATCH'],
      [{ id: '1', modality: 'CT' }, { id: '2', modality: 'MR' }] as any,
      { getScanImageIds, getSopInstanceUidForImageId: getSop },
    );

    expect(result).toEqual({ scanId: '2', imageIds: ['img-no-query-1', 'img-no-query-2'] });
    expect(getScanImageIds).toHaveBeenCalledTimes(2);
  });
});
