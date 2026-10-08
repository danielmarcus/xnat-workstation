import { describe, expect, it } from 'vitest';
import { islandAt, islandOutline, sliceAxisFor } from '../maskIslands';

/**
 * Mask islands (unified selection S4): the selectable component of a segment is one
 * connected painted region on one slice. A 4×4×2 grid, identity orientation, unit
 * spacing; flat index = i + 4j + 16k.
 */
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
function grid(painted: number[], value = 1) {
  const data = new Uint8Array(32);
  for (const f of painted) data[f] = value;
  return { geometry: { dimensions: [4, 4, 2], spacing: [1, 1, 1], origin: [0, 0, 0], direction: IDENTITY }, data, value };
}
const at = (i: number, j: number, k: number) => i + 4 * j + 16 * k;

describe('maskIslands', () => {
  it('islandAt collects the 8-connected region on the seed\'s slice only', () => {
    // Slice k=0: a diagonal pair (connected by a corner) and a separate voxel.
    // Slice k=1 directly below the seed — must NOT be included (different slice).
    const g = grid([at(0, 0, 0), at(1, 1, 0), at(3, 3, 0), at(0, 0, 1)]);
    expect(islandAt(g, at(0, 0, 0), 2).sort((x, y) => x - y)).toEqual([at(0, 0, 0), at(1, 1, 0)]);
    expect(islandAt(g, at(3, 3, 0), 2)).toEqual([at(3, 3, 0)]);
  });

  it('islandAt is empty when the seed is not part of the segment', () => {
    expect(islandAt(grid([at(0, 0, 0)]), at(2, 2, 0), 2)).toEqual([]);
  });

  it('respects the segment value (a multi-label grid)', () => {
    const g = grid([at(0, 0, 0), at(1, 0, 0)], 2);
    expect(islandAt({ ...g, value: 1 }, at(0, 0, 0), 2)).toEqual([]);
    expect(islandAt(g, at(0, 0, 0), 2).length).toBe(2);
  });

  it('islandOutline of a single voxel is its four edges, at half-voxel offsets in the slice plane', () => {
    const g = grid([at(1, 1, 0)]);
    const seg = islandOutline(g, [at(1, 1, 0)], 2);
    expect(seg.length).toBe(4 * 6);
    const xs = new Set<number>();
    const ys = new Set<number>();
    for (let s = 0; s < seg.length; s += 3) { xs.add(seg[s]); ys.add(seg[s + 1]); expect(seg[s + 2]).toBe(0); }
    expect([...xs].sort()).toEqual([0.5, 1.5]);
    expect([...ys].sort()).toEqual([0.5, 1.5]);
  });

  it('islandOutline omits edges shared between island voxels', () => {
    const g = grid([at(1, 1, 0), at(2, 1, 0)]);
    // A 2×1 block: 6 outer edges (not 8).
    expect(islandOutline(g, [at(1, 1, 0), at(2, 1, 0)], 2).length).toBe(6 * 6);
  });

  it('sliceAxisFor picks the grid axis along the view direction (any orientation)', () => {
    expect(sliceAxisFor(IDENTITY, [0, 0, -1])).toBe(2);
    expect(sliceAxisFor(IDENTITY, [1, 0, 0])).toBe(0);
    // Grid axes permuted (a sagittal acquisition): column 0 = world z.
    const sag = [0, 0, 1, 0, 1, 0, 1, 0, 0];
    expect(sliceAxisFor(sag, [0, 0, 1])).toBe(0);
  });
});
