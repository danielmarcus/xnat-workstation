import { beforeEach, describe, expect, it, vi } from 'vitest';

const coreMocks = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock('@cornerstonejs/core', () => ({
  metaData: {
    get: coreMocks.get,
  },
}));

import { metadataService } from '../metadataService';

describe('metadataService', () => {
  beforeEach(() => {
    coreMocks.get.mockReset();
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

  it('extracts overlay metadata and formats names/dates/numbers safely', () => {
    coreMocks.get.mockImplementation((module: string) => {
      if (module === 'patientModule') {
        return {
          patientName: { Alphabetic: 'Doe^Jane' },
          patientId: 12345,
        };
      }
      if (module === 'generalStudyModule') {
        return {
          studyDate: 20240131,
          institutionName: { Alphabetic: 'General Hospital' },
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
