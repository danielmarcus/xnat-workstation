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
  inferSourceScanIdFromConvention,
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
    // UID caches are preserved across clear() so re-expanding skips downloads
    expect(cleared.sourceSeriesUidByScanId).toEqual({
      'sess-1/1': 'UID-A',
      'sess-1/2': 'UID-B',
    });
    expect(cleared.derivedRefSeriesUidByScanId).toEqual({
      'sess-1/3001': 'UID-A',
      'sess-1/4001': 'UID-MISSING',
    });
    expect(cleared.resolvedSessionIds.size).toBe(0);
    expect(cleared.provisionalMappings).toEqual({});
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

// ─── Scan ID Convention Heuristic ─────────────────────────────────────────────

describe('inferSourceScanIdFromConvention', () => {
  it('maps SEG scan IDs following 30xx convention', () => {
    expect(inferSourceScanIdFromConvention(seg('3001'))).toBe('1');
    expect(inferSourceScanIdFromConvention(seg('3011'))).toBe('11');
    expect(inferSourceScanIdFromConvention(seg('3002'))).toBe('2');
    expect(inferSourceScanIdFromConvention(seg('30100'))).toBe('100');
  });

  it('maps SEG scan IDs with collision prefixes (31xx, 32xx)', () => {
    expect(inferSourceScanIdFromConvention(seg('3101'))).toBe('1');
    expect(inferSourceScanIdFromConvention(seg('3211'))).toBe('11');
    expect(inferSourceScanIdFromConvention(seg('3901'))).toBe('1');
  });

  it('maps RTSTRUCT scan IDs following 40xx convention', () => {
    expect(inferSourceScanIdFromConvention(rtstruct('4001'))).toBe('1');
    expect(inferSourceScanIdFromConvention(rtstruct('4011'))).toBe('11');
    expect(inferSourceScanIdFromConvention(rtstruct('4211'))).toBe('11');
  });

  it('returns null for non-matching scan IDs', () => {
    // Non-numeric
    expect(inferSourceScanIdFromConvention(seg('ABC'))).toBeNull();
    // Too short (only 2 digits — no suffix)
    expect(inferSourceScanIdFromConvention(seg('30'))).toBeNull();
    // Wrong prefix digit for SEG
    expect(inferSourceScanIdFromConvention(seg('4001'))).toBeNull();
    // Wrong prefix digit for RTSTRUCT
    expect(inferSourceScanIdFromConvention(rtstruct('3001'))).toBeNull();
    // Source scan (not derived)
    expect(inferSourceScanIdFromConvention(source('3001'))).toBeNull();
    // Arbitrary non-convention ID
    expect(inferSourceScanIdFromConvention(seg('999'))).toBeNull();
    expect(inferSourceScanIdFromConvention(seg('1001'))).toBeNull();
  });

  it('requires scan to be classified as the correct derived type', () => {
    // A scan with ID 3001 but not classified as SEG
    expect(inferSourceScanIdFromConvention({ id: '3001', type: 'CT' })).toBeNull();
    // A scan with ID 4001 but not classified as RTSTRUCT
    expect(inferSourceScanIdFromConvention({ id: '4001', type: 'CT' })).toBeNull();
  });
});

describe('buildProvisionalIndex', () => {
  beforeEach(() => {
    resetStore();
  });

  it('instantly maps convention scans and seeds provisional UIDs', () => {
    const scans = [source('1'), source('2'), seg('3001'), rtstruct('4002')];
    useSessionDerivedIndexStore.getState().buildProvisionalIndex('sess-1', scans);

    const state = useSessionDerivedIndexStore.getState();

    // derivedIndex should have the mappings
    expect(state.derivedIndex['1']?.segScans.map((s) => s.id)).toEqual(['3001']);
    expect(state.derivedIndex['2']?.rtStructScans.map((s) => s.id)).toEqual(['4002']);

    // provisionalMappings tracked
    expect(state.provisionalMappings['sess-1/3001']).toBe('1');
    expect(state.provisionalMappings['sess-1/4002']).toBe('2');

    // Provisional UIDs seeded in UID maps
    expect(state.sourceSeriesUidByScanId['sess-1/1']).toBe('provisional:1');
    expect(state.sourceSeriesUidByScanId['sess-1/2']).toBe('provisional:2');
    expect(state.derivedRefSeriesUidByScanId['sess-1/3001']).toBe('provisional:1');
    expect(state.derivedRefSeriesUidByScanId['sess-1/4002']).toBe('provisional:2');
  });

  it('skips derived scans whose inferred source does not exist', () => {
    // Source scan 5 doesn't exist, so seg 3005 should not be mapped
    const scans = [source('1'), seg('3005')];
    useSessionDerivedIndexStore.getState().buildProvisionalIndex('sess-1', scans);

    const state = useSessionDerivedIndexStore.getState();
    expect(Object.keys(state.provisionalMappings)).toEqual([]);
    expect(state.derivedIndex['5']).toBeUndefined();
  });

  it('skips non-convention derived scans', () => {
    const scans = [source('1'), seg('999')];
    useSessionDerivedIndexStore.getState().buildProvisionalIndex('sess-1', scans);

    const state = useSessionDerivedIndexStore.getState();
    expect(Object.keys(state.provisionalMappings)).toEqual([]);
  });

  it('does not overwrite existing real UIDs for source scans', () => {
    // Pre-populate a real UID for source scan 1
    useSessionDerivedIndexStore.getState().setSourceSeriesUid('sess-1', '1', 'REAL-UID-A');

    const scans = [source('1'), seg('3001')];
    useSessionDerivedIndexStore.getState().buildProvisionalIndex('sess-1', scans);

    const state = useSessionDerivedIndexStore.getState();
    // Source UID should still be the real one
    expect(state.sourceSeriesUidByScanId['sess-1/1']).toBe('REAL-UID-A');
    // Derived ref UID gets provisional (will be overwritten by real resolution)
    expect(state.derivedRefSeriesUidByScanId['sess-1/3001']).toBe('provisional:1');
  });
});

describe('provisional + UID resolution integration', () => {
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

  it('provisional mapping confirmed by UID resolution — counts remain correct', async () => {
    const scans = [source('1'), seg('3001')];
    const getScanImageIds = vi.fn(async () => ['wadouri:https://xnat/img.dcm?objectUID=SOP-1']);
    const downloadScanFile = vi.fn(async () => new ArrayBuffer(16));

    mocked.metaDataGet.mockImplementation((type: string) =>
      type === 'generalSeriesModule' ? { seriesInstanceUID: 'SER-A' } : undefined,
    );
    mocked.getSegReferenceInfo.mockReturnValue({
      referencedSeriesUID: 'SER-A',
      referencedSOPInstanceUIDs: [],
    });

    await useSessionDerivedIndexStore.getState().resolveAssociationsForSession(
      'sess-1', scans, getScanImageIds, downloadScanFile,
    );

    const state = useSessionDerivedIndexStore.getState();
    // SEG correctly mapped to source 1
    expect(state.derivedIndex['1']?.segScans.map((s) => s.id)).toEqual(['3001']);
    // Provisional entries cleaned up
    expect(Object.keys(state.provisionalMappings)).toEqual([]);
    // Real UIDs in place
    expect(state.sourceSeriesUidByScanId['sess-1/1']).toBe('SER-A');
    expect(state.derivedRefSeriesUidByScanId['sess-1/3001']).toBe('SER-A');
    expect(state.resolvedSessionIds.has('sess-1')).toBe(true);
  });

  it('provisional mapping corrected when UID says different source', async () => {
    // Convention says SEG 3001 → source 1, but UID resolution reveals it
    // actually references source 2's SeriesInstanceUID.
    const scans = [source('1'), source('2'), seg('3001')];
    const getScanImageIds = vi.fn(async () => ['wadouri:https://xnat/img.dcm']);
    const downloadScanFile = vi.fn(async () => new ArrayBuffer(16));

    // Source 1 gets SER-A, source 2 gets SER-B
    mocked.metaDataGet.mockImplementation((type: string, imageId: string) => {
      if (type !== 'generalSeriesModule') return undefined;
      return undefined; // force dataset path
    });
    mocked.dataSetGet.mockImplementation(() => ({
      string: (tag: string) => {
        // Will be called for both source scans; return different UIDs based on call order.
        // The mock tracks calls — source 1 first, source 2 second.
        return null;
      },
    }));

    // Directly seed source UIDs to control the test
    useSessionDerivedIndexStore.getState().setSourceSeriesUid('sess-1', '1', 'SER-A');
    useSessionDerivedIndexStore.getState().setSourceSeriesUid('sess-1', '2', 'SER-B');

    // SEG references source 2 (SER-B), not source 1 as convention suggests
    mocked.getSegReferenceInfo.mockReturnValue({
      referencedSeriesUID: 'SER-B',
      referencedSOPInstanceUIDs: [],
    });

    await useSessionDerivedIndexStore.getState().resolveAssociationsForSession(
      'sess-1', scans, getScanImageIds, downloadScanFile,
    );

    const state = useSessionDerivedIndexStore.getState();
    // SEG should be mapped to source 2 (corrected from provisional source 1)
    expect(state.derivedIndex['2']?.segScans.map((s) => s.id)).toEqual(['3001']);
    // Source 1 should have no SEG
    expect(state.derivedIndex['1']?.segScans ?? []).toEqual([]);
    expect(state.resolvedSessionIds.has('sess-1')).toBe(true);
  });

  it('mixed session: convention scans + external scans both resolve', async () => {
    // 3001 follows convention (SEG for source 1)
    // 999 is an external SEG with non-convention ID
    const scans = [source('1'), source('2'), seg('3001'), seg('999')];
    const getScanImageIds = vi.fn(async () => ['wadouri:https://xnat/img.dcm']);
    const downloadScanFile = vi.fn(async () => new ArrayBuffer(16));

    useSessionDerivedIndexStore.getState().setSourceSeriesUid('sess-1', '1', 'SER-A');
    useSessionDerivedIndexStore.getState().setSourceSeriesUid('sess-1', '2', 'SER-B');

    let callCount = 0;
    mocked.getSegReferenceInfo.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First call: seg 3001 references source 1 (convention match)
        return { referencedSeriesUID: 'SER-A', referencedSOPInstanceUIDs: [] };
      }
      // Second call: seg 999 references source 2
      return { referencedSeriesUID: 'SER-B', referencedSOPInstanceUIDs: [] };
    });

    await useSessionDerivedIndexStore.getState().resolveAssociationsForSession(
      'sess-1', scans, getScanImageIds, downloadScanFile,
    );

    const state = useSessionDerivedIndexStore.getState();
    expect(state.derivedIndex['1']?.segScans.map((s) => s.id)).toEqual(['3001']);
    expect(state.derivedIndex['2']?.segScans.map((s) => s.id)).toEqual(['999']);
    expect(state.resolvedSessionIds.has('sess-1')).toBe(true);
  });

  it('session with no convention scans behaves as before', async () => {
    // All derived scans have non-convention IDs
    const scans = [source('1'), seg('999'), rtstruct('888')];
    const getScanImageIds = vi.fn(async () => ['wadouri:https://xnat/img.dcm']);
    const downloadScanFile = vi.fn(async () => new ArrayBuffer(16));

    useSessionDerivedIndexStore.getState().setSourceSeriesUid('sess-1', '1', 'SER-A');

    mocked.getSegReferenceInfo.mockReturnValue({
      referencedSeriesUID: 'SER-A',
      referencedSOPInstanceUIDs: [],
    });
    mocked.parseRtStruct.mockReturnValue({
      referencedSeriesUID: 'SER-A',
    });

    await useSessionDerivedIndexStore.getState().resolveAssociationsForSession(
      'sess-1', scans, getScanImageIds, downloadScanFile,
    );

    const state = useSessionDerivedIndexStore.getState();
    expect(state.derivedIndex['1']?.segScans.map((s) => s.id)).toEqual(['999']);
    expect(state.derivedIndex['1']?.rtStructScans.map((s) => s.id)).toEqual(['888']);
    // No provisional entries should exist
    expect(Object.keys(state.provisionalMappings)).toEqual([]);
    expect(state.resolvedSessionIds.has('sess-1')).toBe(true);
  });

  it('provisional UIDs do not prevent real UID resolution', async () => {
    const scans = [source('1'), seg('3001')];
    const getScanImageIds = vi.fn(async () => ['wadouri:https://xnat/img.dcm']);
    const downloadScanFile = vi.fn(async () => new ArrayBuffer(16));

    mocked.metaDataGet.mockImplementation((type: string) =>
      type === 'generalSeriesModule' ? { seriesInstanceUID: 'SER-REAL' } : undefined,
    );
    mocked.getSegReferenceInfo.mockReturnValue({
      referencedSeriesUID: 'SER-REAL',
      referencedSOPInstanceUIDs: [],
    });

    await useSessionDerivedIndexStore.getState().resolveAssociationsForSession(
      'sess-1', scans, getScanImageIds, downloadScanFile,
    );

    const state = useSessionDerivedIndexStore.getState();
    // Real UIDs should be in place, not provisional
    expect(state.sourceSeriesUidByScanId['sess-1/1']).toBe('SER-REAL');
    expect(state.derivedRefSeriesUidByScanId['sess-1/3001']).toBe('SER-REAL');
    // Downloads should still happen (provisional doesn't short-circuit)
    expect(downloadScanFile).toHaveBeenCalledTimes(1);
    expect(getScanImageIds).toHaveBeenCalledTimes(1);
  });
});
