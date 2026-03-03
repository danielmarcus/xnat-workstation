import type { XnatScan } from '@shared/types/xnat';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  metaDataGet: vi.fn(),
  dataSetIsLoaded: vi.fn(),
  dataSetLoad: vi.fn(),
  dataSetGet: vi.fn(),
  dataSetString: vi.fn(),
  getSegReferenceInfo: vi.fn(),
  parseRtStruct: vi.fn(),
}));

vi.mock('@cornerstonejs/core', () => ({
  metaData: {
    get: mocked.metaDataGet,
  },
}));

vi.mock('@cornerstonejs/dicom-image-loader', () => ({
  wadouri: {
    dataSetCacheManager: {
      isLoaded: mocked.dataSetIsLoaded,
      load: mocked.dataSetLoad,
      get: mocked.dataSetGet,
    },
  },
}));

vi.mock('../lib/dicom/segReferencedSeriesUid', () => ({
  getSegReferenceInfo: mocked.getSegReferenceInfo,
}));

vi.mock('../lib/cornerstone/rtStructService', () => ({
  rtStructService: {
    parseRtStruct: mocked.parseRtStruct,
  },
}));

import {
  isDerivedScan,
  isRtStructScan,
  isSegScan,
  isSrScan,
  useSessionDerivedIndexStore,
} from './sessionDerivedIndexStore';

function resetStore(): void {
  useSessionDerivedIndexStore.setState(useSessionDerivedIndexStore.getInitialState(), true);
}

function source(id: string): XnatScan {
  return { id, type: 'CT' };
}

function seg(id: string): XnatScan {
  return { id, xsiType: 'xnat:segscandata', type: 'SEG' };
}

function rtstruct(id: string): XnatScan {
  return { id, xsiType: 'xnat:otherdicomscandata', seriesDescription: 'RTSTRUCT Export' };
}

describe('sessionDerivedIndexStore classification helpers', () => {
  beforeEach(() => {
    resetStore();
  });

  it('identifies SEG, RTSTRUCT, derived, and SR scans', () => {
    expect(isSegScan(seg('3001'))).toBe(true);
    expect(
      isSegScan({ id: '3002', sopClassUID: '1.2.840.10008.5.1.4.1.1.66.4' }),
    ).toBe(true);

    expect(isRtStructScan(rtstruct('4001'))).toBe(true);
    expect(
      isRtStructScan({ id: '4002', sopClassUID: '1.2.840.10008.5.1.4.1.1.481.3' }),
    ).toBe(true);

    expect(isDerivedScan(seg('3001'))).toBe(true);
    expect(isDerivedScan(rtstruct('4001'))).toBe(true);
    expect(isDerivedScan(source('1'))).toBe(false);

    expect(isSrScan({ id: '5001', xsiType: 'xnat:srscandata' })).toBe(true);
    expect(isSrScan({ id: '5002', modality: 'SR' })).toBe(true);
    expect(isSrScan(source('2'))).toBe(false);
  });
});

describe('useSessionDerivedIndexStore deterministic transitions', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();

    mocked.metaDataGet.mockReturnValue(undefined);
    mocked.dataSetIsLoaded.mockReturnValue(false);
    mocked.dataSetLoad.mockResolvedValue(undefined);
    mocked.dataSetString.mockReturnValue(null);
    mocked.dataSetGet.mockImplementation(() => ({
      string: mocked.dataSetString,
    }));
    mocked.getSegReferenceInfo.mockReturnValue({
      referencedSeriesUID: null,
      referencedSOPInstanceUIDs: [],
    });
    mocked.parseRtStruct.mockReturnValue({
      referencedSeriesUID: null,
    });
  });

  it('builds baseline index and maps derived scans with deduplication', () => {
    const scans = [source('1'), source('2'), seg('3001'), rtstruct('4001')];
    useSessionDerivedIndexStore.getState().buildDerivedIndex(scans);

    const stateAfterBuild = useSessionDerivedIndexStore.getState();
    expect(Object.keys(stateAfterBuild.derivedIndex).sort()).toEqual(['1', '2']);
    expect(stateAfterBuild.unmapped.map((s) => s.id).sort()).toEqual(['3001', '4001']);

    useSessionDerivedIndexStore.getState().addMapping('1', seg('3001'));
    useSessionDerivedIndexStore.getState().addMapping('1', seg('3001'));

    const stateAfterMapping = useSessionDerivedIndexStore.getState();
    expect(stateAfterMapping.derivedIndex['1']?.segScans.map((s) => s.id)).toEqual(['3001']);
    expect(stateAfterMapping.unmapped.map((s) => s.id)).toEqual(['4001']);
  });

  it('rebuilds from UID maps and clears state', () => {
    const scans = [source('1'), source('2'), seg('3001'), rtstruct('4001')];
    useSessionDerivedIndexStore.getState().setSourceSeriesUid('sess-1', '1', 'UID-A');
    useSessionDerivedIndexStore.getState().setSourceSeriesUid('sess-1', '2', 'UID-B');
    useSessionDerivedIndexStore.getState().setDerivedReferencedSeriesUid('sess-1', '3001', 'UID-A');
    useSessionDerivedIndexStore.getState().setDerivedReferencedSeriesUid('sess-1', '4001', 'UID-MISSING');

    useSessionDerivedIndexStore.getState().rebuildFromUids('sess-1', scans);

    const rebuilt = useSessionDerivedIndexStore.getState();
    expect(rebuilt.derivedIndex['1']?.segScans.map((s) => s.id)).toEqual(['3001']);
    expect(rebuilt.derivedIndex['1']?.rtStructScans).toEqual([]);
    expect(rebuilt.unmapped.map((s) => s.id)).toEqual(['4001']);

    useSessionDerivedIndexStore.getState().clear();
    const cleared = useSessionDerivedIndexStore.getState();
    expect(cleared.derivedIndex).toEqual({});
    expect(cleared.unmapped).toEqual([]);
    expect(cleared.sourceSeriesUidByScanId).toEqual({});
    expect(cleared.derivedRefSeriesUidByScanId).toEqual({});
    expect(cleared.resolvedSessionIds.size).toBe(0);
  });

  it('ensureSourceSeriesUid returns cached values and resolves via metadata/cache probing', async () => {
    const store = useSessionDerivedIndexStore.getState();
    store.setSourceSeriesUid('sess-1', '1', 'UID-CACHED');

    const getScanImageIds = vi.fn(async () => ['wadouri:https://xnat/cache-hit.dcm']);
    await expect(store.ensureSourceSeriesUid('sess-1', '1', getScanImageIds)).resolves.toBe('UID-CACHED');
    expect(getScanImageIds).not.toHaveBeenCalled();

    mocked.metaDataGet.mockImplementation((type: string) => {
      if (type === 'generalSeriesModule') {
        return { seriesInstanceUID: 'UID-META' };
      }
      return undefined;
    });
    await expect(store.ensureSourceSeriesUid('sess-1', '2', getScanImageIds)).resolves.toBe('UID-META');
    expect(mocked.dataSetLoad).not.toHaveBeenCalled();

    mocked.metaDataGet.mockReturnValue(undefined);
    mocked.dataSetString.mockReturnValue('UID-DATASET');
    await expect(
      store.ensureSourceSeriesUid('sess-1', '3', async () => ['wadouri:https://xnat/fallback.dcm']),
    ).resolves.toBe('UID-DATASET');
    expect(mocked.dataSetLoad).toHaveBeenCalledWith(
      'https://xnat/fallback.dcm',
      undefined,
      'wadouri:https://xnat/fallback.dcm',
    );
  });

  it('ensureSourceSeriesUid handles failures and returns null', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = useSessionDerivedIndexStore.getState();

    await expect(
      store.ensureSourceSeriesUid('sess-1', '9', async () => {
        throw new Error('ids failed');
      }),
    ).resolves.toBeNull();

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('ensureDerivedReferencedSeriesUid resolves SEG, SOP fallback, RTSTRUCT, and failure paths', async () => {
    const store = useSessionDerivedIndexStore.getState();
    const download = vi.fn(async () => new ArrayBuffer(8));

    mocked.getSegReferenceInfo.mockReturnValueOnce({
      referencedSeriesUID: 'SER-SEG',
      referencedSOPInstanceUIDs: [],
    });
    await expect(
      store.ensureDerivedReferencedSeriesUid('sess-1', '3001', seg('3001'), download),
    ).resolves.toBe('SER-SEG');

    mocked.getSegReferenceInfo.mockReturnValueOnce({
      referencedSeriesUID: null,
      referencedSOPInstanceUIDs: ['SOP-42'],
    });
    await expect(
      store.ensureDerivedReferencedSeriesUid(
        'sess-1',
        '3002',
        seg('3002'),
        download,
        new Map([['SOP-42', 'SER-SOP-FALLBACK']]),
      ),
    ).resolves.toBe('SER-SOP-FALLBACK');

    mocked.parseRtStruct.mockReturnValueOnce({ referencedSeriesUID: 'SER-RT' });
    await expect(
      store.ensureDerivedReferencedSeriesUid('sess-1', '4001', rtstruct('4001'), download),
    ).resolves.toBe('SER-RT');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(
      store.ensureDerivedReferencedSeriesUid(
        'sess-1',
        '999',
        seg('999'),
        async () => {
          throw new Error('download failed');
        },
      ),
    ).resolves.toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('resolveAssociationsForSession resolves index, caches completion, and deduplicates concurrent runs', async () => {
    const scans = [source('1'), seg('3001')];
    const getScanImageIds = vi.fn(async () => ['wadouri:https://xnat/image.dcm?objectUID=SOP-1']);
    const downloadScanFile = vi.fn(async () => new ArrayBuffer(16));

    mocked.metaDataGet.mockImplementation((type: string) =>
      type === 'generalSeriesModule' ? { seriesInstanceUID: 'SER-A' } : undefined,
    );
    mocked.getSegReferenceInfo.mockReturnValue({
      referencedSeriesUID: 'SER-A',
      referencedSOPInstanceUIDs: [],
    });

    await Promise.all([
      useSessionDerivedIndexStore.getState().resolveAssociationsForSession(
        'sess-1',
        scans,
        getScanImageIds,
        downloadScanFile,
      ),
      useSessionDerivedIndexStore.getState().resolveAssociationsForSession(
        'sess-1',
        scans,
        getScanImageIds,
        downloadScanFile,
      ),
    ]);

    const state = useSessionDerivedIndexStore.getState();
    expect(state.derivedIndex['1']?.segScans.map((s) => s.id)).toEqual(['3001']);
    expect(state.resolvedSessionIds.has('sess-1')).toBe(true);
    expect(getScanImageIds).toHaveBeenCalledTimes(1);
    expect(downloadScanFile).toHaveBeenCalledTimes(1);

    await useSessionDerivedIndexStore.getState().resolveAssociationsForSession(
      'sess-1',
      scans,
      getScanImageIds,
      downloadScanFile,
    );

    // Session already resolved, so resolver should rebuild from cache without new I/O.
    expect(getScanImageIds).toHaveBeenCalledTimes(1);
    expect(downloadScanFile).toHaveBeenCalledTimes(1);
  });
});
