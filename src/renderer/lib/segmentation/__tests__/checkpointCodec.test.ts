/** Checkpoint voxel codec (branch 2 R5): runs round-trip exactly, through gzip+base64. */
import { describe, expect, it } from 'vitest';
import { encodeRuns, forEachInRuns, packRuns, unpackRuns } from '../checkpointCodec';

describe('runs', () => {
  it('encode set indices as [start, length] pairs and visit them back', () => {
    const set = new Set([2, 3, 4, 9, 10, 15]);
    const runs = encodeRuns(16, (i) => set.has(i));
    expect(Array.from(runs)).toEqual([2, 3, 9, 2, 15, 1]);
    const back: number[] = [];
    forEachInRuns(runs, (i) => back.push(i));
    expect(back).toEqual([2, 3, 4, 9, 10, 15]);
  });
  it('an empty mask is no runs; a full mask one run', () => {
    expect(Array.from(encodeRuns(5, () => false))).toEqual([]);
    expect(Array.from(encodeRuns(5, () => true))).toEqual([0, 5]);
  });
});

describe('pack / unpack', () => {
  it('round-trips a large sparse mask exactly', async () => {
    const n = 512 * 512 * 40;
    const runs = encodeRuns(n, (i) => (i % 9973) < 300);
    const payload = await packRuns(runs);
    expect(['g', 'r']).toContain(payload[0]);
    expect(Array.from(await unpackRuns(payload))).toEqual(Array.from(runs));
  });
  it('rejects an unknown format', async () => {
    await expect(unpackRuns('zAAAA')).rejects.toThrow(/unknown payload format/);
  });
});
