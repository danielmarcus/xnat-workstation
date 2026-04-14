import { beforeEach, describe, expect, it, vi } from 'vitest';

const dicomExportHelperMocks = vi.hoisted(() => {
  let lastMeta: any = null;
  let lastDict: any = null;
  const dataSetCache = new Map<string, any>();

  return {
    reset() {
      lastMeta = null;
      lastDict = null;
      dataSetCache.clear();
      vi.clearAllMocks();
    },
    denaturalizeDataset: vi.fn((dataset: any) => dataset),
    naturalizeDataset: vi.fn((dataset: any) => dataset),
    readFile: vi.fn(() => ({ dict: lastDict, meta: lastMeta })),
    writeDicomDict: vi.fn((_DicomDict: unknown, meta: any, dict: any) => {
      lastMeta = meta;
      lastDict = dict;
      return new Uint8Array([1, 2, 3]).buffer;
    }),
    cacheDataSet(uri: string, dataSet: any) {
      dataSetCache.set(uri, dataSet);
    },
    isLoaded: vi.fn((uri: string) => dataSetCache.has(uri)),
    getDataSet: vi.fn((uri: string) => dataSetCache.get(uri)),
  };
});

vi.mock('dcmjs', () => ({
  data: {
    DicomMetaDictionary: {
      denaturalizeDataset: dicomExportHelperMocks.denaturalizeDataset,
      naturalizeDataset: dicomExportHelperMocks.naturalizeDataset,
    },
    DicomMessage: {
      readFile: dicomExportHelperMocks.readFile,
    },
    DicomDict: {},
  },
}));

vi.mock('../writeDicomDict', () => ({
  writeDicomDict: dicomExportHelperMocks.writeDicomDict,
}));

vi.mock('@cornerstonejs/dicom-image-loader', () => ({
  wadouri: {
    dataSetCacheManager: {
      isLoaded: dicomExportHelperMocks.isLoaded,
      get: dicomExportHelperMocks.getDataSet,
    },
  },
}));

import {
  serializeDerivedDicomDataset,
  collectSourceDicomReferences,
  parseReferencedFrameNumber,
} from '../dicomExportHelpers';

describe('dicomExportHelpers', () => {
  beforeEach(() => {
    dicomExportHelperMocks.reset();
  });

  it('serializes a derived SEG with workstation file meta and round-trip validation', () => {
    const dataset = {
      SOPClassUID: '1.2.3',
      SOPInstanceUID: '1.2.3.4',
      StudyInstanceUID: 'STUDY-1',
      SeriesInstanceUID: 'SER-1',
      Modality: 'SEG',
      Rows: 2,
      Columns: 2,
      NumberOfFrames: 1,
      PixelData: new Uint8Array([255]).buffer,
      SegmentSequence: [{}],
      PerFrameFunctionalGroupsSequence: [{}],
      SharedFunctionalGroupsSequence: [{}],
    };

    const result = serializeDerivedDicomDataset(dataset, {
      kind: 'SEG',
      callerTag: 'dicomExportHelpers.test',
      defaultSOPClassUID: '1.2.840.10008.5.1.4.1.1.66.4',
      requiredDatasetFields: [
        'SOPClassUID',
        'SOPInstanceUID',
        'StudyInstanceUID',
        'SeriesInstanceUID',
        'Modality',
        'Rows',
        'Columns',
        'NumberOfFrames',
        'PixelData',
      ],
      expectedDatasetValues: {
        Modality: 'SEG',
        StudyInstanceUID: 'STUDY-1',
      },
      includeContentDateTime: true,
    });

    expect(result.arrayBuffer.byteLength).toBe(3);
    expect(result.parsedDataset).toMatchObject({
      Manufacturer: 'XNAT Workstation',
      ManufacturerModelName: 'XNAT Workstation',
      DeviceSerialNumber: 'XNATWS',
      StudyInstanceUID: 'STUDY-1',
      Modality: 'SEG',
    });
    expect(result.parsedMeta).toMatchObject({
      MediaStorageSOPClassUID: '1.2.3',
      MediaStorageSOPInstanceUID: '1.2.3.4',
      TransferSyntaxUID: '1.2.840.10008.1.2.1',
    });
  });

  it('fails fast when a required dataset field is missing', () => {
    expect(() => serializeDerivedDicomDataset({
      SOPClassUID: '1.2.3',
      SOPInstanceUID: '1.2.3.4',
      SeriesInstanceUID: 'SER-1',
      Modality: 'RTSTRUCT',
    }, {
      kind: 'RTSTRUCT',
      callerTag: 'dicomExportHelpers.test',
      defaultSOPClassUID: '1.2.840.10008.5.1.4.1.1.481.3',
      requiredDatasetFields: ['StudyInstanceUID', 'SeriesInstanceUID'],
    })).toThrow('StudyInstanceUID');
  });

  it('collects source DICOM references including frame-aware metadata', () => {
    const getMetaData = vi.fn((type: string, imageId: string) => {
      if (type === 'generalStudyModule') return { studyInstanceUID: 'STUDY-1' };
      if (type === 'generalSeriesModule') return { seriesInstanceUID: 'SER-1' };
      if (type === 'imagePlaneModule') return { frameOfReferenceUID: 'FOR-1' };
      if (type === 'sopCommonModule') return {
        sopClassUID: '1.2.840.10008.5.1.4.1.1.2',
        sopInstanceUID: 'SOP-1',
      };
      if (type === 'multiframeModule') return { numberOfFrames: 24 };
      return undefined;
    });

    const refs = collectSourceDicomReferences(['wadouri:https://xnat.example/file.dcm&frame=3'], getMetaData);
    expect(refs).toEqual([
      expect.objectContaining({
        studyInstanceUID: 'STUDY-1',
        seriesInstanceUID: 'SER-1',
        frameOfReferenceUID: 'FOR-1',
        sopInstanceUID: 'SOP-1',
        referencedFrameNumber: 3,
        numberOfFrames: 24,
      }),
    ]);
    expect(parseReferencedFrameNumber('wadouri:https://xnat.example/file.dcm&frame=3')).toBe(3);
  });

  it('falls back to the cached raw DICOM dataset when Cornerstone study metadata is missing', () => {
    dicomExportHelperMocks.cacheDataSet('https://xnat.example/file.dcm&frame=3', {
      string: (tag: string) => ({
        x0020000d: 'STUDY-RAW',
        x0020000e: 'SERIES-RAW',
        x00200052: 'FOR-RAW',
        x00080016: '1.2.840.10008.5.1.4.1.1.2',
        x00080018: 'SOP-RAW',
        x00100010: 'Raw^Patient',
        x00100020: 'PATIENT-RAW',
        x00080020: '20260409',
        x00280008: '12',
      }[tag]),
    });

    const getMetaData = vi.fn((type: string) => {
      if (type === 'multiframeModule') return undefined;
      if (type === 'sopCommonModule') return {};
      return undefined;
    });

    const refs = collectSourceDicomReferences(['wadouri:https://xnat.example/file.dcm&frame=3'], getMetaData);

    expect(refs).toEqual([
      expect.objectContaining({
        studyInstanceUID: 'STUDY-RAW',
        seriesInstanceUID: 'SERIES-RAW',
        frameOfReferenceUID: 'FOR-RAW',
        sopClassUID: '1.2.840.10008.5.1.4.1.1.2',
        sopInstanceUID: 'SOP-RAW',
        patientName: 'Raw^Patient',
        patientId: 'PATIENT-RAW',
        studyDate: '20260409',
        referencedFrameNumber: 3,
        numberOfFrames: 12,
      }),
    ]);
  });
});
