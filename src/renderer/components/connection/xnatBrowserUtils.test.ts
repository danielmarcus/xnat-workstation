import { beforeAll, describe, expect, it } from 'vitest';
import type { XnatScan } from '@shared/types/xnat';
import {
  getFirstNumber,
  isBrowsableSourceScan,
  scanSupportsThumbnail,
  toThumbnailDataUrl,
} from './xnatBrowserUtils';

function makeScan(partial: Partial<XnatScan>): XnatScan {
  return {
    id: partial.id ?? '1',
    ...partial,
  };
}

beforeAll(() => {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => ({
      fillStyle: '',
      fillRect: () => undefined,
      drawImage: () => undefined,
      createImageData: (w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
      }),
      putImageData: () => undefined,
    }),
  });

  Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
    configurable: true,
    value: () => 'data:image/jpeg;base64,mock',
  });
});

describe('xnatBrowserUtils', () => {
  it('determines thumbnail eligibility from xsiType, SOP class, and modality/type heuristics', () => {
    expect(scanSupportsThumbnail(makeScan({ xsiType: 'xnat:segScanData' }))).toBe(false);
    expect(scanSupportsThumbnail(makeScan({ xsiType: 'xnat:srScanData' }))).toBe(false);
    expect(scanSupportsThumbnail(makeScan({ xsiType: 'xnat:otherDicomScanData' }))).toBe(false);
    expect(scanSupportsThumbnail(makeScan({ sopClassUID: '1.2.840.10008.5.1.4.1.1.66.4' }))).toBe(false);
    expect(scanSupportsThumbnail(makeScan({ sopClassUID: '1.2.840.10008.5.1.4.1.1.88.67' }))).toBe(false);
    expect(scanSupportsThumbnail(makeScan({ modality: 'SEG' }))).toBe(false);
    expect(scanSupportsThumbnail(makeScan({ type: 'RTSTRUCT' }))).toBe(false);
    expect(scanSupportsThumbnail(makeScan({ type: 'Structured Report' }))).toBe(false);
    expect(scanSupportsThumbnail(makeScan({ seriesDescription: 'Structured Report Notes' }))).toBe(false);
    expect(scanSupportsThumbnail(makeScan({ modality: 'CT', type: 'AXIAL', seriesDescription: 'Abdomen' }))).toBe(true);
    expect(scanSupportsThumbnail(makeScan({ sopClassUID: '1.2.840.10008.5.1.4.1.1.2' }))).toBe(true);
  });

  it('filters source scans by excluding derived and structured-report rows', () => {
    expect(isBrowsableSourceScan(makeScan({ modality: 'CT', type: 'AXIAL' }))).toBe(true);
    expect(isBrowsableSourceScan(makeScan({ type: 'SEG', xsiType: 'xnat:segScanData' }))).toBe(false);
    expect(isBrowsableSourceScan(makeScan({ type: 'RTSTRUCT', xsiType: 'xnat:otherDicomScanData' }))).toBe(false);
    expect(isBrowsableSourceScan(makeScan({ type: 'SR' }))).toBe(false);
    expect(isBrowsableSourceScan(makeScan({ sopClassUID: '1.2.840.10008.5.1.4.1.1.88.33' }))).toBe(false);
    expect(isBrowsableSourceScan(makeScan({ xsiType: 'xnat:otherDicomScanData', type: 'Secondary Capture' }))).toBe(false);
  });

  it('extracts numeric values safely from scalar and array inputs', () => {
    expect(getFirstNumber(12)).toBe(12);
    expect(getFirstNumber('42')).toBe(42);
    expect(getFirstNumber([9, 10])).toBe(9);
    expect(getFirstNumber([])).toBeNull();
    expect(getFirstNumber('NaN')).toBeNull();
    expect(getFirstNumber(undefined)).toBeNull();
  });

  it('builds thumbnail data URLs via getCanvas fast-path and pixel-data fallback', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 12;

    const fastPath = toThumbnailDataUrl({
      getCanvas: () => canvas,
    });
    expect(fastPath).toMatch(/^data:image\/jpeg;base64,/);

    const fallback = toThumbnailDataUrl({
      rows: 2,
      columns: 2,
      slope: 1,
      intercept: 0,
      windowCenter: [50],
      windowWidth: [100],
      photometricInterpretation: 'MONOCHROME2',
      getPixelData: () => new Uint16Array([0, 25, 50, 75]),
    });
    expect(fallback).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('returns null when no thumbnail source can be derived', () => {
    expect(toThumbnailDataUrl({})).toBeNull();
    expect(
      toThumbnailDataUrl({
        rows: 0,
        columns: 0,
        getPixelData: () => new Uint8Array([]),
      }),
    ).toBeNull();
  });
});
