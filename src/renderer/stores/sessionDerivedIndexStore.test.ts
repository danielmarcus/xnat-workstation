import type { XnatScan } from '@shared/types/xnat';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@cornerstonejs/core', () => ({
  metaData: {
    get: vi.fn(),
  },
}));

vi.mock('@cornerstonejs/dicom-image-loader', () => ({
  wadouri: {
    dataSetCacheManager: {
      isLoaded: vi.fn(() => false),
      load: vi.fn(),
      get: vi.fn(),
    },
  },
}));

vi.mock('../lib/dicom/segReferencedSeriesUid', () => ({
  getSegReferenceInfo: vi.fn(() => ({
    referencedSeriesUID: null,
    referencedSOPInstanceUIDs: [],
  })),
}));

vi.mock('../lib/cornerstone/rtStructService', () => ({
  rtStructService: {
    parseRtStruct: vi.fn(() => ({
      referencedSeriesUID: null,
    })),
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
});
