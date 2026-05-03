/**
 * Tests for the AcquisitionNumber metadata extension provider.
 *
 * The visibility adapter consults `metaData.get('acquisitionNumberExtension', imageId)`
 * as a fallback when wadouri's `instance` aggregate doesn't surface
 * AcquisitionNumber. The provider parses x00200012 from the
 * wadouri-cached dicom-parser dataset.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cacheState: Record<string, { string: (tag: string) => string | undefined } | null> = {};
const cacheLoaded: Record<string, boolean> = {};

vi.mock('@cornerstonejs/dicom-image-loader', () => ({
  wadouri: {
    dataSetCacheManager: {
      isLoaded: (uri: string) => cacheLoaded[uri] === true,
      get: (uri: string) => cacheState[uri] ?? undefined,
    },
  },
}));

const addProviderCalls: Array<{ provider: (type: string, imageId: string) => unknown; priority: number }> = [];
vi.mock('@cornerstonejs/core', () => ({
  metaData: {
    addProvider: (provider: (type: string, imageId: string) => unknown, priority: number) => {
      addProviderCalls.push({ provider, priority });
    },
  },
}));

import {
  ACQUISITION_NUMBER_EXTENSION,
  resolveAcquisitionNumber,
  registerAcquisitionNumberProvider,
  _resetAcquisitionNumberProviderForTests,
} from './acquisitionNumberProvider';

beforeEach(() => {
  for (const k of Object.keys(cacheState)) delete cacheState[k];
  for (const k of Object.keys(cacheLoaded)) delete cacheLoaded[k];
  addProviderCalls.length = 0;
  _resetAcquisitionNumberProviderForTests();
});

afterEach(() => {
  addProviderCalls.length = 0;
  _resetAcquisitionNumberProviderForTests();
});

describe('resolveAcquisitionNumber', () => {
  it('parses an integer AcquisitionNumber from the wadouri-cached dataset', () => {
    cacheState['dicomfile:0'] = { string: (tag: string) => (tag === 'x00200012' ? '5' : undefined) };
    cacheLoaded['dicomfile:0'] = true;
    expect(resolveAcquisitionNumber('dicomfile:0')).toEqual({ AcquisitionNumber: 5 });
  });

  it('returns AcquisitionNumber=null when the tag is empty', () => {
    cacheState['dicomfile:0'] = { string: (_tag: string) => '' };
    cacheLoaded['dicomfile:0'] = true;
    expect(resolveAcquisitionNumber('dicomfile:0')).toEqual({ AcquisitionNumber: null });
  });

  it('returns AcquisitionNumber=null for a non-numeric value', () => {
    cacheState['dicomfile:0'] = { string: (_tag: string) => 'abc' };
    cacheLoaded['dicomfile:0'] = true;
    expect(resolveAcquisitionNumber('dicomfile:0')).toEqual({ AcquisitionNumber: null });
  });

  it('returns undefined when no cached dataset is available (lets the next provider try)', () => {
    expect(resolveAcquisitionNumber('dicomfile:99')).toBeUndefined();
  });

  it('returns undefined when imageId is empty', () => {
    expect(resolveAcquisitionNumber('')).toBeUndefined();
  });

  it('strips wadouri: prefix when matching the dataSetCacheManager URI', () => {
    cacheState['file:///a/b.dcm'] = { string: (tag: string) => (tag === 'x00200012' ? '7' : undefined) };
    cacheLoaded['file:///a/b.dcm'] = true;
    expect(resolveAcquisitionNumber('wadouri:file:///a/b.dcm')).toEqual({ AcquisitionNumber: 7 });
  });

  it('coerces stringly-typed AcquisitionNumber to a number (DICOM IS VR is a string)', () => {
    cacheState['dicomfile:0'] = { string: (_tag: string) => '12' };
    cacheLoaded['dicomfile:0'] = true;
    expect(resolveAcquisitionNumber('dicomfile:0')).toEqual({ AcquisitionNumber: 12 });
  });
});

describe('registerAcquisitionNumberProvider', () => {
  it('installs a provider that handles only the acquisitionNumberExtension type', () => {
    registerAcquisitionNumberProvider();
    expect(addProviderCalls).toHaveLength(1);
    const { provider, priority } = addProviderCalls[0];
    expect(priority).toBe(100);
    // Returns undefined for unrelated module types.
    expect(provider('instance', 'dicomfile:0')).toBeUndefined();
    expect(provider('generalSeriesModule', 'dicomfile:0')).toBeUndefined();

    // Returns a structured result for the extension type when the dataset is cached.
    cacheState['dicomfile:0'] = { string: (tag: string) => (tag === 'x00200012' ? '3' : undefined) };
    cacheLoaded['dicomfile:0'] = true;
    expect(provider(ACQUISITION_NUMBER_EXTENSION, 'dicomfile:0')).toEqual({ AcquisitionNumber: 3 });
  });

  it('is idempotent — a second call does not register a second provider', () => {
    registerAcquisitionNumberProvider();
    registerAcquisitionNumberProvider();
    expect(addProviderCalls).toHaveLength(1);
  });
});
