/** Slice-track runs (branch 1 S6): occupied slices collapse into inclusive runs. */
import { describe, expect, it } from 'vitest';
import { occupiedGridSlices, toRuns } from '../sliceTrack';

describe('toRuns', () => {
  it('collapses consecutive slices and keeps gaps', () => {
    expect(toRuns([2, 3, 4, 7, 9, 10])).toEqual([[2, 4], [7, 7], [9, 10]]);
    expect(toRuns([])).toEqual([]);
  });
});

describe('occupiedGridSlices', () => {
  const dims: [number, number, number] = [7, 5, 4];
  const n = dims[0] * dims[1] * dims[2];
  const data = new Uint16Array(n);
  // A few voxels of the segment (value 2) and of another (value 1).
  const put = (x: number, y: number, z: number, v: number) => { data[x + y * dims[0] + z * dims[0] * dims[1]] = v; };
  put(1, 0, 0, 2); put(6, 4, 2, 2); put(3, 2, 2, 2); put(5, 1, 3, 1);
  const geometry = { dimensions: dims } as never;
  const brute = (axis: 0 | 1 | 2) => {
    const hit = new Uint8Array(dims[axis]);
    for (let i = 0; i < n; i++) {
      if (data[i] !== 2) continue;
      const x = i % dims[0], y = Math.floor(i / dims[0]) % dims[1], z = Math.floor(i / (dims[0] * dims[1]));
      hit[[x, y, z][axis]] = 1;
    }
    return [...hit];
  };
  const plane = dims[0] * dims[1];
  const stacked = { geometry, value: 2, data, slice: (k: number) => data.subarray(k * plane, (k + 1) * plane) } as never;
  const flat = { geometry, value: 2, data } as never;
  for (const axis of [0, 1, 2] as const) {
    it(`matches a voxel-by-voxel scan along axis ${axis}, stack and volume`, () => {
      expect([...occupiedGridSlices(stacked, axis)]).toEqual(brute(axis));
      expect([...occupiedGridSlices(flat, axis)]).toEqual(brute(axis));
    });
  }
});
