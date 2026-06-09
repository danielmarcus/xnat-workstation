import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const metaGet = vi.fn((_mod?: string, _id?: string): unknown => undefined);
vi.mock('@cornerstonejs/core', () => ({
  StreamingDynamicImageVolume: class {},
  metaData: { get: (mod: string, id: string) => metaGet(mod, id) },
  utilities: {},
}));

import {
  splitImageIdsIntoTimepointGroups,
  isMultiVolumeSeries,
  timepointCount,
} from '../dynamicVolumeLoader';

/** Stub per-image ImagePositionPatient. */
const setIpps = (byId: Record<string, number[]>): void => {
  metaGet.mockImplementation((mod?: string, id?: string) =>
    mod === 'imagePlaneModule' && id ? { imagePositionPatient: byId[id] } : undefined,
  );
};

beforeEach(() => metaGet.mockReturnValue(undefined));
afterEach(() => vi.clearAllMocks());

describe('splitImageIdsIntoTimepointGroups', () => {
  it('groups by position then transposes to time-point groups (time-point-major input)', () => {
    // order t0:s0, t0:s1, t1:s0, t1:s1 — positions s0=(0,0,0), s1=(0,0,5).
    setIpps({ a: [0, 0, 0], b: [0, 0, 5], c: [0, 0, 0], d: [0, 0, 5] });
    // t0 = [s0,s1] = [a,b]; t1 = [c,d].
    expect(splitImageIdsIntoTimepointGroups(['a', 'b', 'c', 'd'])).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('transposes correctly for position-major input', () => {
    // order s0:t0, s0:t1, s1:t0, s1:t1.
    setIpps({ a: [0, 0, 0], b: [0, 0, 0], c: [0, 0, 5], d: [0, 0, 5] });
    // t0 = [a,c]; t1 = [b,d].
    expect(splitImageIdsIntoTimepointGroups(['a', 'b', 'c', 'd'])).toEqual([
      ['a', 'c'],
      ['b', 'd'],
    ]);
  });

  it('returns a single group for a normal 3D series (distinct positions)', () => {
    setIpps({ a: [0, 0, 0], b: [0, 0, 5], c: [0, 0, 10] });
    expect(splitImageIdsIntoTimepointGroups(['a', 'b', 'c'])).toEqual([['a', 'b', 'c']]);
  });

  it('returns a single group when geometry is missing', () => {
    metaGet.mockReturnValue(undefined);
    expect(splitImageIdsIntoTimepointGroups(['a', 'b'])).toEqual([['a', 'b']]);
  });
});

describe('isMultiVolumeSeries / timepointCount', () => {
  it('detects 4D vs 3D and counts time points', () => {
    setIpps({ a: [0, 0, 0], b: [0, 0, 5], c: [0, 0, 0], d: [0, 0, 5] });
    expect(isMultiVolumeSeries(['a', 'b', 'c', 'd'])).toBe(true);
    expect(timepointCount(['a', 'b', 'c', 'd'])).toBe(2);

    setIpps({ a: [0, 0, 0], b: [0, 0, 5] });
    expect(isMultiVolumeSeries(['a', 'b'])).toBe(false);
    expect(timepointCount(['a', 'b'])).toBe(1);
  });
});
