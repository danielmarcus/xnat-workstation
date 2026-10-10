import { beforeEach, describe, expect, it, vi } from 'vitest';

const coreMocks = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock('@cornerstonejs/core', () => ({
  metaData: {
    get: coreMocks.get,
  },
}));

const datasetMocks = vi.hoisted(() => ({ cachedDataset: vi.fn() }));
vi.mock('../dicomDatasetSource', () => datasetMocks);

import { metadataService } from '../metadataService';

describe('metadataService', () => {
  beforeEach(() => {
    coreMocks.get.mockReset();
    datasetMocks.cachedDataset.mockReset();
  });

  it('infers native orientation from image orientation patient vectors', () => {
    coreMocks.get.mockReturnValue({
      imageOrientationPatient: [1, 0, 0, 0, 1, 0],
    });
    expect(metadataService.getNativeOrientation('img-axial')).toBe('AXIAL');

    coreMocks.get.mockReturnValue({
      imageOrientationPatient: [0, 1, 0, 0, 0, 1],
    });
    expect(metadataService.getNativeOrientation('img-sagittal')).toBe('SAGITTAL');

    coreMocks.get.mockReturnValue({
      imageOrientationPatient: [1, 0, 0, 0, 0, 1],
    });
    expect(metadataService.getNativeOrientation('img-coronal')).toBe('CORONAL');
  });

  it('falls back to AXIAL for missing/invalid orientation metadata or read failures', () => {
    coreMocks.get.mockReturnValue(undefined);
    expect(metadataService.getNativeOrientation('missing')).toBe('AXIAL');

    coreMocks.get.mockReturnValue({ imageOrientationPatient: [1, 0, 0] });
    expect(metadataService.getNativeOrientation('short')).toBe('AXIAL');

    coreMocks.get.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(metadataService.getNativeOrientation('error')).toBe('AXIAL');
  });

  // The module shapes below are what the wadouri metadata provider (the one the app
  // registers, useLegacyMetadataProvider) actually returns — read off a loaded image,
  // not assumed. An earlier version of this test mocked `patientId`, a string-ish
  // `studyDate` and an `institutionName` in the study module; none of those exist, so
  // the test passed while Study Date and Institution never rendered in the app.
  it('extracts overlay metadata from the wadouri provider module shapes', () => {
    datasetMocks.cachedDataset.mockReturnValue({
      string: (tag: string) => (tag === 'x00080080' ? 'General Hospital' : undefined),
    });
    coreMocks.get.mockImplementation((module: string) => {
      if (module === 'patientModule') {
        return {
          patientName: 'Doe^Jane',
          patientID: '12345',
        };
      }
      if (module === 'generalStudyModule') {
        return {
          studyDate: { year: 2024, month: 1, day: 31 },
          studyTime: { hours: 0, minutes: 0, seconds: 0 },
        };
      }
      if (module === 'generalSeriesModule') {
        return {
          seriesDescription: 'CT Abdomen',
          seriesNumber: 4,
        };
      }
      if (module === 'imagePlaneModule') {
        return {
          sliceLocation: 12.345,
          sliceThickness: 2,
        };
      }
      if (module === 'imagePixelModule') {
        return {
          rows: 512,
          columns: 256,
        };
      }
      return {};
    });

    expect(metadataService.getOverlayData('img-1')).toEqual({
      patientName: 'Doe, Jane',
      patientId: '12345',
      studyDate: '2024-01-31',
      institutionName: 'General Hospital',
      seriesDescription: 'CT Abdomen',
      seriesNumber: '4',
      sliceLocation: '12.35',
      sliceThickness: '2',
      rows: 512,
      columns: 256,
    });
  });

  it('formats a raw DA string and tolerates an image with no cached header', () => {
    datasetMocks.cachedDataset.mockReturnValue(undefined);
    coreMocks.get.mockImplementation((module: string) =>
      module === 'generalStudyModule' ? { studyDate: '20240131' } : {},
    );

    const overlay = metadataService.getOverlayData('img-2');
    expect(overlay.studyDate).toBe('2024-01-31');
    expect(overlay.institutionName).toBe('');
  });

  it('returns empty overlay defaults for blank image ids and metadata read errors', () => {
    expect(metadataService.getOverlayData('')).toEqual({
      patientName: '',
      patientId: '',
      studyDate: '',
      institutionName: '',
      seriesDescription: '',
      seriesNumber: '',
      sliceLocation: '',
      sliceThickness: '',
      rows: 0,
      columns: 0,
    });

    coreMocks.get.mockImplementation(() => {
      throw new Error('read failed');
    });

    expect(metadataService.getOverlayData('img-error')).toEqual({
      patientName: '',
      patientId: '',
      studyDate: '',
      institutionName: '',
      seriesDescription: '',
      seriesNumber: '',
      sliceLocation: '',
      sliceThickness: '',
      rows: 0,
      columns: 0,
    });
  });
});
