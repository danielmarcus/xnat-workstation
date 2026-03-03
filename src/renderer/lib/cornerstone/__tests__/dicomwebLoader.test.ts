import { beforeEach, describe, expect, it, vi } from 'vitest';

type ModuleName = 'imagePlaneModule' | 'generalImageModule' | 'instance';

const dicomwebMocks = vi.hoisted(() => {
  const uriDataSetMap = new Map<string, { string?: (tag: string) => string | undefined }>();
  const metadataMap = new Map<string, unknown>();

  return {
    uriDataSetMap,
    metadataMap,
    metaDataGet: vi.fn((moduleName: ModuleName, imageId: string) => {
      return metadataMap.get(`${moduleName}|${imageId}`);
    }),
    isLoaded: vi.fn((uri: string) => uriDataSetMap.has(uri)),
    load: vi.fn(async (_uri: string) => undefined),
    get: vi.fn((uri: string) => uriDataSetMap.get(uri)),
  };
});

vi.mock('@cornerstonejs/core', () => ({
  metaData: {
    get: dicomwebMocks.metaDataGet,
  },
}));

vi.mock('@cornerstonejs/dicom-image-loader', () => ({
  wadouri: {
    dataSetCacheManager: {
      isLoaded: dicomwebMocks.isLoaded,
      load: dicomwebMocks.load,
      get: dicomwebMocks.get,
    },
  },
}));

import { dicomwebLoader } from '../dicomwebLoader';

function setElectronApi(partial?: Partial<Window['electronAPI']['xnat']>): void {
  Object.defineProperty(globalThis, 'window', {
    value: {
      electronAPI: {
        xnat: {
          dicomwebFetch: vi.fn(async () => ({ ok: true, status: 200, data: [] })),
          getScanFiles: vi.fn(async () => ({ ok: true, files: [], serverUrl: 'https://xnat.example' })),
          ...partial,
        },
      },
    },
    configurable: true,
  });
}

describe('dicomwebLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dicomwebMocks.metaDataGet.mockImplementation((moduleName: ModuleName, imageId: string) => {
      return dicomwebMocks.metadataMap.get(`${moduleName}|${imageId}`);
    });
    dicomwebLoader.clearScanImageIdsCache();
    dicomwebMocks.metadataMap.clear();
    dicomwebMocks.uriDataSetMap.clear();
  });

  it('builds and sorts series imageIds from QIDO-RS instances', async () => {
    setElectronApi({
      dicomwebFetch: vi.fn(async () => ({
        ok: true,
        status: 200,
        data: [
          {
            '00080018': { Value: ['sop-b'] },
            '00200013': { Value: [2] },
          },
          {
            '00080018': { Value: ['sop-a'] },
            '00200013': { Value: [1] },
          },
        ],
      })),
    });

    const imageIds = await dicomwebLoader.getSeriesImageIds('1.2.study', '1.2.series', 'https://xnat.example/');
    expect(imageIds).toEqual([
      expect.stringContaining('objectUID=sop-a'),
      expect.stringContaining('objectUID=sop-b'),
    ]);
    expect(imageIds[0]).toContain('studyUID=1.2.study');
    expect(imageIds[0]).toContain('seriesUID=1.2.series');
  });

  it('throws on failed/empty QIDO-RS results', async () => {
    setElectronApi({
      dicomwebFetch: vi.fn(async () => ({ ok: false, status: 401, error: 'unauthorized' })),
    });
    await expect(dicomwebLoader.getSeriesImageIds('a', 'b', 'https://xnat')).rejects.toThrow(
      'QIDO-RS failed: 401 unauthorized',
    );

    setElectronApi({
      dicomwebFetch: vi.fn(async () => ({ ok: true, status: 200, data: [] })),
    });
    await expect(dicomwebLoader.getSeriesImageIds('a', 'b', 'https://xnat')).rejects.toThrow(
      'No instances found for series',
    );
  });

  it('caches scan image ids and supports cache invalidation per session', async () => {
    const getScanFiles = vi.fn(async () => ({
      ok: true,
      serverUrl: 'https://xnat.example/',
      files: ['/c/10.dcm', '/c/2.dcm'],
    }));
    setElectronApi({ getScanFiles });

    const first = await dicomwebLoader.getScanImageIds('sess-1', '11');
    expect(first).toEqual([
      'wadouri:https://xnat.example/c/2.dcm',
      'wadouri:https://xnat.example/c/10.dcm',
    ]);

    const second = await dicomwebLoader.getScanImageIds('sess-1', '11');
    expect(second).toEqual(first);
    expect(getScanFiles).toHaveBeenCalledTimes(1);

    dicomwebLoader.clearScanImageIdsCache('sess-1');
    await dicomwebLoader.getScanImageIds('sess-1', '11');
    expect(getScanFiles).toHaveBeenCalledTimes(2);
  });

  it('orders scan image ids by DICOM metadata when requested and falls back on ordering errors', async () => {
    setElectronApi({
      getScanFiles: vi.fn(async () => ({
        ok: true,
        serverUrl: 'https://xnat.example',
        files: ['/scan/img-b.dcm', '/scan/img-a.dcm'],
      })),
    });

    const idA = 'wadouri:https://xnat.example/scan/img-a.dcm';
    const idB = 'wadouri:https://xnat.example/scan/img-b.dcm';
    dicomwebMocks.metadataMap.set(`imagePlaneModule|${idA}`, {
      imagePositionPatient: [0, 0, 10],
      rowCosines: [1, 0, 0],
      columnCosines: [0, 1, 0],
    });
    dicomwebMocks.metadataMap.set(`imagePlaneModule|${idB}`, {
      imagePositionPatient: [0, 0, 0],
      rowCosines: [1, 0, 0],
      columnCosines: [0, 1, 0],
    });
    dicomwebMocks.metadataMap.set(`generalImageModule|${idA}`, { instanceNumber: 2 });
    dicomwebMocks.metadataMap.set(`generalImageModule|${idB}`, { instanceNumber: 1 });

    const ordered = await dicomwebLoader.getScanImageIds('sess-2', '22', { order: 'dicomMetadata' });
    expect(ordered).toEqual([idB, idA]);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    dicomwebLoader.clearScanImageIdsCache('sess-2');
    dicomwebMocks.metaDataGet.mockImplementation(() => {
      throw new Error('metadata failed');
    });

    const fallback = await dicomwebLoader.getScanImageIds('sess-2', '22', { order: 'dicomMetadata' });
    expect(fallback).toEqual([idA, idB]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Metadata ordering failed for scan sess-2/22; using filename order'),
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it('orders arbitrary image ids by metadata and returns identity for trivial inputs', async () => {
    setElectronApi();

    const one = ['wadouri:https://xnat.example/single.dcm'];
    await expect(dicomwebLoader.orderImageIdsByDicomMetadata(one)).resolves.toEqual(one);

    const ids = ['wadouri:https://xnat.example/b.dcm', 'wadouri:https://xnat.example/a.dcm'];
    dicomwebMocks.metadataMap.set(`imagePlaneModule|${ids[0]}`, {
      imagePositionPatient: [0, 0, 5],
      rowCosines: [1, 0, 0],
      columnCosines: [0, 1, 0],
    });
    dicomwebMocks.metadataMap.set(`imagePlaneModule|${ids[1]}`, {
      imagePositionPatient: [0, 0, 1],
      rowCosines: [1, 0, 0],
      columnCosines: [0, 1, 0],
    });

    const ordered = await dicomwebLoader.orderImageIdsByDicomMetadata(ids, 'manual');
    expect(ordered).toEqual([ids[1], ids[0]]);
  });

  it('throws clear scan-file errors for failed lookups and empty scans', async () => {
    setElectronApi({
      getScanFiles: vi.fn(async () => ({ ok: false, error: 'not connected' })),
    });
    await expect(dicomwebLoader.getScanImageIds('sess-3', '33')).rejects.toThrow(
      'Failed to get scan files: not connected',
    );

    setElectronApi({
      getScanFiles: vi.fn(async () => ({ ok: true, serverUrl: 'https://xnat.example', files: [] })),
    });
    await expect(dicomwebLoader.getScanImageIds('sess-3', '33')).rejects.toThrow(
      'No DICOM files found for this scan',
    );
  });
});
