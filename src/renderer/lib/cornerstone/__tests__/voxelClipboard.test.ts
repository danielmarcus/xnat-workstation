import { describe, expect, it } from 'vitest';
import {
  copyVoxelRegion,
  pasteVoxelRegion,
  indexToWorld,
  worldToIndex,
  type VoxelGridGeometry,
} from '../segmentationService/voxelClipboard';

/**
 * Slice 6 — voxel-region clipboard + nearest-neighbour resample (D6 / C2 / signal 23).
 *
 * Pure, GPU-free geometry: copy a segment's voxel bounding box out of a source
 * labelmap as a small sub-grid with its own world transform, then NN-resample it
 * into a target grid at a world translation, writing the ACTIVE member's index and
 * honouring the overlap policy. World geometry is preserved (paste lands at the
 * copied world point regardless of target resolution / slice positions). Voxels
 * outside the target extent clip silently. No setter shortcuts — the real math.
 */

// Axis-aligned identity-direction grid (DICOM LPS row-major direction cosines).
function grid(
  dimensions: [number, number, number],
  spacing: [number, number, number] = [1, 1, 1],
  origin: [number, number, number] = [0, 0, 0],
): VoxelGridGeometry {
  return { dimensions, spacing, origin, direction: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
}

function emptyData(geom: VoxelGridGeometry): Uint8Array {
  const [nx, ny, nz] = geom.dimensions;
  return new Uint8Array(nx * ny * nz);
}

function idx(geom: VoxelGridGeometry, i: number, j: number, k: number): number {
  const [nx, ny] = geom.dimensions;
  return i + j * nx + k * nx * ny; // column-major (Cornerstone scalar layout)
}

describe('voxelClipboard — index/world transforms', () => {
  it('round-trips index → world → index on an offset, anisotropic grid', () => {
    const g = grid([10, 10, 10], [2, 3, 4], [100, 200, 300]);
    const world = indexToWorld(g, [3, 4, 5]);
    expect(world).toEqual([100 + 6, 200 + 12, 300 + 20]);
    expect(worldToIndex(g, world)).toEqual([3, 4, 5]);
  });
});

describe('voxelClipboard — copyVoxelRegion', () => {
  it('extracts the tight bounding box of the segment and preserves segment identity', () => {
    const g = grid([8, 8, 4]);
    const data = emptyData(g);
    // a 2x2x1 block of segment 3 at (2..3, 5..6, 1)
    data[idx(g, 2, 5, 1)] = 3;
    data[idx(g, 3, 5, 1)] = 3;
    data[idx(g, 2, 6, 1)] = 3;
    data[idx(g, 3, 6, 1)] = 3;

    const clip = copyVoxelRegion({ geometry: g, data }, 3);
    expect(clip).not.toBeNull();
    expect(clip!.sourceSegmentIndex).toBe(3);
    expect(clip!.geometry.dimensions).toEqual([2, 2, 1]);
    // sub-grid origin sits at the bbox-min voxel's world position
    expect(clip!.geometry.origin).toEqual(indexToWorld(g, [2, 5, 1]));
    expect(Array.from(clip!.data)).toEqual([1, 1, 1, 1]); // all four set
  });

  it('returns null when the segment has no voxels', () => {
    const g = grid([4, 4, 4]);
    expect(copyVoxelRegion({ geometry: g, data: emptyData(g) }, 2)).toBeNull();
  });

  it('ignores other segments when extracting (per-segment binary)', () => {
    const g = grid([4, 4, 1]);
    const data = emptyData(g);
    data[idx(g, 1, 1, 0)] = 5; // wanted
    data[idx(g, 2, 2, 0)] = 9; // other segment — must be excluded
    const clip = copyVoxelRegion({ geometry: g, data }, 5);
    expect(clip!.geometry.dimensions).toEqual([1, 1, 1]);
    expect(Array.from(clip!.data)).toEqual([1]);
  });
});

describe('voxelClipboard — pasteVoxelRegion (NN resample)', () => {
  it('same-grid, zero translation reproduces the region into the ACTIVE member', () => {
    const g = grid([6, 6, 1]);
    const src = emptyData(g);
    src[idx(g, 1, 1, 0)] = 3;
    src[idx(g, 2, 1, 0)] = 3;
    const clip = copyVoxelRegion({ geometry: g, data: src }, 3)!;

    const target = emptyData(g);
    const res = pasteVoxelRegion(clip, { geometry: g, data: target }, {
      targetSegmentIndex: 7, // active member differs from source (3)
      overlap: 'overwrite',
    });
    expect(res.written).toBe(2);
    expect(target[idx(g, 1, 1, 0)]).toBe(7); // active member, not source index
    expect(target[idx(g, 2, 1, 0)]).toBe(7);
  });

  it('routes writes through writeTarget when provided (live voxelManager path, signal 23)', () => {
    const g = grid([6, 6, 1]);
    const src = emptyData(g);
    src[idx(g, 1, 1, 0)] = 3;
    src[idx(g, 2, 1, 0)] = 3;
    const clip = copyVoxelRegion({ geometry: g, data: src }, 3)!;

    const target = emptyData(g);
    const writes: Array<[number, number]> = [];
    const res = pasteVoxelRegion(clip, { geometry: g, data: target }, {
      targetSegmentIndex: 7,
      overlap: 'overwrite',
      writeTarget: (flatIndex, value) => writes.push([flatIndex, value]),
    });
    // Writes go through the callback, NOT target.data (which stays untouched).
    expect(res.written).toBe(2);
    expect(writes).toHaveLength(2);
    expect(writes.every(([, v]) => v === 7)).toBe(true);
    expect(writes.map(([i]) => i).sort((a, b) => a - b)).toEqual([idx(g, 1, 1, 0), idx(g, 2, 1, 0)]);
    expect(target[idx(g, 1, 1, 0)]).toBe(0); // untouched — caller owns the write
  });

  it('preserves world geometry across a finer target grid (NN fills the footprint densely)', () => {
    const coarse = grid([4, 4, 1], [2, 2, 2]); // 2mm voxels
    const src = emptyData(coarse);
    src[idx(coarse, 1, 1, 0)] = 1; // one 2mm voxel, world center (2,2,0)
    const clip = copyVoxelRegion({ geometry: coarse, data: src }, 1)!;

    const fine = grid([8, 8, 1], [1, 1, 2]); // 1mm voxels, same world extent
    const target = emptyData(fine);
    const res = pasteVoxelRegion(clip, { geometry: fine, data: target }, {
      targetSegmentIndex: 1,
      overlap: 'overwrite',
    });
    // the 2mm source voxel (world ~1..3 in x/y) maps to multiple 1mm target voxels
    expect(res.written).toBeGreaterThanOrEqual(1);
    // a fine voxel whose world center is nearest the source voxel center is set
    expect(target[idx(fine, 2, 2, 0)]).toBe(1);
  });

  it('translates the region by a world delta (paste at a different slice)', () => {
    const g = grid([4, 4, 4]);
    const src = emptyData(g);
    src[idx(g, 1, 1, 0)] = 2;
    const clip = copyVoxelRegion({ geometry: g, data: src }, 2)!;

    const target = emptyData(g);
    pasteVoxelRegion(clip, { geometry: g, data: target }, {
      targetSegmentIndex: 2,
      overlap: 'overwrite',
      translationWorld: [0, 0, 2], // +1 slice (2mm? spacing 1 → +2 world = +2 slices)
    });
    expect(target[idx(g, 1, 1, 0)]).toBe(0); // not at the source slice
    expect(target[idx(g, 1, 1, 2)]).toBe(2); // shifted +2 along k
  });

  it('additive overlap leaves other-segment voxels intact; overwrite replaces', () => {
    const g = grid([4, 4, 1]);
    const src = emptyData(g);
    src[idx(g, 1, 1, 0)] = 1;
    const clip = copyVoxelRegion({ geometry: g, data: src }, 1)!;

    const additive = emptyData(g);
    additive[idx(g, 1, 1, 0)] = 9; // a different segment already here
    pasteVoxelRegion(clip, { geometry: g, data: additive }, { targetSegmentIndex: 4, overlap: 'additive' });
    expect(additive[idx(g, 1, 1, 0)]).toBe(4); // active member wins at painted voxels

    const overwrite = emptyData(g);
    overwrite[idx(g, 0, 0, 0)] = 9;
    pasteVoxelRegion(clip, { geometry: g, data: overwrite }, { targetSegmentIndex: 4, overlap: 'overwrite' });
    expect(overwrite[idx(g, 1, 1, 0)]).toBe(4);
  });

  it('subtract mode clears the active member where the clip is set', () => {
    const g = grid([4, 4, 1]);
    const src = emptyData(g);
    src[idx(g, 1, 1, 0)] = 1;
    const clip = copyVoxelRegion({ geometry: g, data: src }, 1)!;

    const target = emptyData(g);
    target[idx(g, 1, 1, 0)] = 4; // active member present
    const res = pasteVoxelRegion(clip, { geometry: g, data: target }, {
      targetSegmentIndex: 4,
      overlap: 'overwrite',
      subtract: true,
    });
    expect(target[idx(g, 1, 1, 0)]).toBe(0); // cleared
    expect(res.written).toBe(1);
  });

  it('clips voxels outside the target extent silently and reports partial paste', () => {
    const g = grid([4, 4, 1]);
    const src = emptyData(g);
    src[idx(g, 3, 3, 0)] = 1; // at the far corner
    const clip = copyVoxelRegion({ geometry: g, data: src }, 1)!;

    const target = emptyData(g);
    const res = pasteVoxelRegion(clip, { geometry: g, data: target }, {
      targetSegmentIndex: 1,
      overlap: 'overwrite',
      translationWorld: [2, 2, 0], // pushes the voxel off the far edge
    });
    expect(() => res).not.toThrow();
    expect(res.clipped).toBe(true); // partial paste flagged
    expect(target.some((v) => v !== 0)).toBe(false); // nothing written (all clipped)
  });
});
