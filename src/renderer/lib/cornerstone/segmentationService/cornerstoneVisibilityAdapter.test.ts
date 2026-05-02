/**
 * Tests for the Cornerstone-backed visibility metadata adapter.
 *
 * The default `cornerstoneVisibilityAdapter` reads from
 *   - Cornerstone's `metaData.get(...)` provider,
 *   - viewport's `getCurrentImageId()`,
 *   - `sourceImageTracking.getSourceImageIds(...)`,
 *   - `csAnnotation.state.getAnnotation(...).metadata.referencedImageId`.
 *
 * The `createVisibilityAdapter` factory takes those four lookups as deps,
 * so we test the factory + the small `identityFromImageId` helper without
 * needing to mock Cornerstone at the module level.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createVisibilityAdapter,
  identityFromImageId,
} from './cornerstoneVisibilityAdapter';

// ─── identityFromImageId ────────────────────────────────────────────────

describe('identityFromImageId', () => {
  function makeMetaData(records: Record<string, Record<string, unknown>>) {
    return (type: string, _imageId: string) => records[type];
  }

  it('returns full identity when seriesUID + FoR + AcquisitionNumber all present', () => {
    const getMetaData = makeMetaData({
      generalSeriesModule: { seriesInstanceUID: 'SERIES_A' },
      imagePlaneModule: { frameOfReferenceUID: 'FOR_X' },
      instance: { AcquisitionNumber: 3 },
    });
    expect(identityFromImageId('img1', getMetaData)).toEqual({
      seriesUID: 'SERIES_A',
      frameOfReferenceUID: 'FOR_X',
      acquisitionNumber: 3,
    });
  });

  it('returns null when seriesInstanceUID is missing', () => {
    const getMetaData = makeMetaData({
      generalSeriesModule: {},
      imagePlaneModule: { frameOfReferenceUID: 'FOR_X' },
      instance: { AcquisitionNumber: 1 },
    });
    expect(identityFromImageId('img1', getMetaData)).toBeNull();
  });

  it('returns null when frameOfReferenceUID is missing', () => {
    const getMetaData = makeMetaData({
      generalSeriesModule: { seriesInstanceUID: 'SERIES_A' },
      imagePlaneModule: {},
      instance: { AcquisitionNumber: 1 },
    });
    expect(identityFromImageId('img1', getMetaData)).toBeNull();
  });

  it('returns null on empty imageId', () => {
    const getMetaData = makeMetaData({});
    expect(identityFromImageId('', getMetaData)).toBeNull();
  });

  it('coerces stringly-typed AcquisitionNumber to a number', () => {
    const getMetaData = makeMetaData({
      generalSeriesModule: { seriesInstanceUID: 'S' },
      imagePlaneModule: { frameOfReferenceUID: 'F' },
      instance: { AcquisitionNumber: '7' },
    });
    expect(identityFromImageId('img1', getMetaData)?.acquisitionNumber).toBe(7);
  });

  it('treats AcquisitionNumber=0 as a real value (not "missing")', () => {
    const getMetaData = makeMetaData({
      generalSeriesModule: { seriesInstanceUID: 'S' },
      imagePlaneModule: { frameOfReferenceUID: 'F' },
      instance: { AcquisitionNumber: 0 },
    });
    expect(identityFromImageId('img1', getMetaData)?.acquisitionNumber).toBe(0);
  });

  it('returns acquisitionNumber=null when the tag is missing', () => {
    const getMetaData = makeMetaData({
      generalSeriesModule: { seriesInstanceUID: 'S' },
      imagePlaneModule: { frameOfReferenceUID: 'F' },
      instance: {}, // no AcquisitionNumber
    });
    expect(identityFromImageId('img1', getMetaData)?.acquisitionNumber).toBeNull();
  });

  it('returns acquisitionNumber=null for empty-string AcquisitionNumber (DICOM IS VR may arrive empty)', () => {
    const getMetaData = makeMetaData({
      generalSeriesModule: { seriesInstanceUID: 'S' },
      imagePlaneModule: { frameOfReferenceUID: 'F' },
      instance: { AcquisitionNumber: '' },
    });
    expect(identityFromImageId('img1', getMetaData)?.acquisitionNumber).toBeNull();
  });

  it('returns acquisitionNumber=null for non-numeric AcquisitionNumber (corrupt metadata)', () => {
    const getMetaData = makeMetaData({
      generalSeriesModule: { seriesInstanceUID: 'S' },
      imagePlaneModule: { frameOfReferenceUID: 'F' },
      instance: { AcquisitionNumber: 'abc' },
    });
    expect(identityFromImageId('img1', getMetaData)?.acquisitionNumber).toBeNull();
  });

  it('handles undefined provider returns gracefully', () => {
    const getMetaData = (_type: string, _imageId: string) => undefined;
    expect(identityFromImageId('img1', getMetaData)).toBeNull();
  });
});

// ─── createVisibilityAdapter (factory) ──────────────────────────────────

describe('createVisibilityAdapter', () => {
  function makeFullDeps(overrides: Partial<Parameters<typeof createVisibilityAdapter>[0]> = {}) {
    const records: Record<string, Record<string, Record<string, unknown>>> = {
      'src-img-A': {
        generalSeriesModule: { seriesInstanceUID: 'SERIES_A' },
        imagePlaneModule: { frameOfReferenceUID: 'FOR_X' },
        instance: { AcquisitionNumber: 1 },
      },
      'src-img-B': {
        generalSeriesModule: { seriesInstanceUID: 'SERIES_B' },
        imagePlaneModule: { frameOfReferenceUID: 'FOR_X' },
        instance: { AcquisitionNumber: 2 },
      },
    };

    return createVisibilityAdapter({
      getMetaData: vi.fn((type: string, imageId: string) => records[imageId]?.[type]),
      getViewportImageId: vi.fn((vpId: string) => (vpId === 'vp-A' ? 'src-img-A' : null)),
      getSegmentationSourceImageId: vi.fn((segId: string) => (segId === 'seg-B' ? 'src-img-B' : null)),
      getAnnotationReferencedImageId: vi.fn((annId: string) => (annId === 'ann-A' ? 'src-img-A' : null)),
      ...overrides,
    });
  }

  it('getViewportSourceIdentity routes through getViewportImageId + identityFromImageId', () => {
    const adapter = makeFullDeps();
    expect(adapter.getViewportSourceIdentity('vp-A')).toEqual({
      seriesUID: 'SERIES_A',
      frameOfReferenceUID: 'FOR_X',
      acquisitionNumber: 1,
    });
  });

  it('getViewportSourceIdentity returns null when viewport has no current imageId', () => {
    const adapter = makeFullDeps();
    expect(adapter.getViewportSourceIdentity('vp-unknown')).toBeNull();
  });

  it('getSegmentationSourceIdentity reads from sourceImageTracking shim', () => {
    const adapter = makeFullDeps();
    expect(adapter.getSegmentationSourceIdentity('seg-B')).toEqual({
      seriesUID: 'SERIES_B',
      frameOfReferenceUID: 'FOR_X',
      acquisitionNumber: 2,
    });
  });

  it('getSegmentationSourceIdentity returns null for untracked segmentation', () => {
    const adapter = makeFullDeps();
    expect(adapter.getSegmentationSourceIdentity('seg-unknown')).toBeNull();
  });

  it('getAnnotationSourceIdentity reads from referencedImageId lookup', () => {
    const adapter = makeFullDeps();
    expect(adapter.getAnnotationSourceIdentity('ann-A')).toEqual({
      seriesUID: 'SERIES_A',
      frameOfReferenceUID: 'FOR_X',
      acquisitionNumber: 1,
    });
  });

  it('getAnnotationSourceIdentity returns null for loose annotation (no referencedImageId)', () => {
    const adapter = makeFullDeps();
    expect(adapter.getAnnotationSourceIdentity('ann-loose')).toBeNull();
  });

  it('returns null when imageId resolves but metadata is missing required fields', () => {
    // Override deps so the imageId resolves but the metadata lookup returns
    // a partial record (e.g., FoR present but seriesUID missing).
    const adapter = createVisibilityAdapter({
      getMetaData: (type) => (type === 'imagePlaneModule' ? { frameOfReferenceUID: 'FOR_X' } : {}),
      getViewportImageId: () => 'src-img-A',
      getSegmentationSourceImageId: () => null,
      getAnnotationReferencedImageId: () => null,
    });
    expect(adapter.getViewportSourceIdentity('vp')).toBeNull();
  });
});
