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
          getScanFiles: vi.fn(async () => ({ ok: true, files: [] as Array<{ uri: string; instanceNumber?: number }>, serverUrl: 'https://xnat.example' })),
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
      files: [
        { uri: '/c/10.dcm' },
        { uri: '/c/2.dcm' },
      ],
    }));
    setElectronApi({ getScanFiles });

    // Without instanceNumber, falls back to filename sort
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

  it('orders scan image ids by InstanceNumber from catalog when available', async () => {
    setElectronApi({
      getScanFiles: vi.fn(async () => ({
        ok: true,
        serverUrl: 'https://xnat.example',
        files: [
          { uri: '/scan/img-b.dcm', instanceNumber: 2 },
          { uri: '/scan/img-a.dcm', instanceNumber: 1 },
        ],
      })),
    });

    const ordered = await dicomwebLoader.getScanImageIds('sess-2', '22');
    expect(ordered).toEqual([
      'wadouri:https://xnat.example/scan/img-a.dcm',
      'wadouri:https://xnat.example/scan/img-b.dcm',
    ]);
  });

  it('falls back to filename sort when instanceNumber is absent from all entries', async () => {
    setElectronApi({
      getScanFiles: vi.fn(async () => ({
        ok: true,
        serverUrl: 'https://xnat.example',
        files: [
          { uri: '/scan/img-b.dcm' },
          { uri: '/scan/img-a.dcm' },
        ],
      })),
    });

    const ordered = await dicomwebLoader.getScanImageIds('sess-2b', '22');
    expect(ordered).toEqual([
      'wadouri:https://xnat.example/scan/img-a.dcm',
      'wadouri:https://xnat.example/scan/img-b.dcm',
    ]);
  });

  it('sorts entries without instanceNumber to the end when some have it', async () => {
    setElectronApi({
      getScanFiles: vi.fn(async () => ({
        ok: true,
        serverUrl: 'https://xnat.example',
        files: [
          { uri: '/scan/c.dcm' },
          { uri: '/scan/a.dcm', instanceNumber: 2 },
          { uri: '/scan/b.dcm', instanceNumber: 1 },
        ],
      })),
    });

    const ordered = await dicomwebLoader.getScanImageIds('sess-2c', '22');
    expect(ordered).toEqual([
      'wadouri:https://xnat.example/scan/b.dcm',
      'wadouri:https://xnat.example/scan/a.dcm',
      'wadouri:https://xnat.example/scan/c.dcm',
    ]);
  });

  it('expands a single multiframe DICOM file into frame-addressable image ids', async () => {
    setElectronApi({
      getScanFiles: vi.fn(async () => ({
        ok: true,
        serverUrl: 'https://xnat.example',
        files: [{ uri: '/scan/tomo.dcm', instanceNumber: 474 }],
      })),
    });

    dicomwebMocks.uriDataSetMap.set('https://xnat.example/scan/tomo.dcm', {
      string: (tag: string) => (tag === 'x00280008' ? '53' : undefined),
    });

    const ordered = await dicomwebLoader.getScanImageIds('sess-tomo', '474');
    expect(ordered).toHaveLength(53);
    expect(ordered[0]).toBe('wadouri:https://xnat.example/scan/tomo.dcm&frame=1');
    expect(ordered[52]).toBe('wadouri:https://xnat.example/scan/tomo.dcm&frame=53');
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
      getScanFiles: vi.fn(async () => ({ ok: false, error: 'not connected', files: [] })),
    });
    await expect(dicomwebLoader.getScanImageIds('sess-3', '33')).rejects.toThrow(
      'Failed to get scan files: not connected',
    );

    dicomwebLoader.clearScanImageIdsCache();
    setElectronApi({
      getScanFiles: vi.fn(async () => ({ ok: true, serverUrl: 'https://xnat.example', files: [] })),
    });
    await expect(dicomwebLoader.getScanImageIds('sess-3', '33')).rejects.toThrow(
      'No DICOM files found for this scan',
    );
  });
});
