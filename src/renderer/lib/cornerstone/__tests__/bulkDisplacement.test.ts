import { describe, expect, it } from 'vitest';
import { bulkDisplacementMm } from '../bulkDisplacement';
import type { VolumeGeometry } from '../bulkDisplacement';

/** 4×4×4 volume, all background (0) except a single bright voxel at (i,j,k). */
function blobAt(i: number, j: number, k: number, spacing: [number, number, number] = [1, 1, 1]): VolumeGeometry {
  const [nx, ny, nz] = [4, 4, 4];
  const data = new Float32Array(nx * ny * nz); // background 0
  data[i + j * nx + k * nx * ny] = 100; // bright object
  return { scalarData: data, dimensions: [nx, ny, nz], spacing, origin: [0, 0, 0] };
}

describe('bulkDisplacementMm', () => {
  it('returns 0 for identical centroids', () => {
    expect(bulkDisplacementMm(blobAt(1, 1, 1), blobAt(1, 1, 1))).toBeCloseTo(0, 5);
  });

  it('measures the centroid shift in mm (unit spacing)', () => {
    // blob moves from x=1 to x=3 ⇒ 2 mm displacement.
    expect(bulkDisplacementMm(blobAt(1, 1, 1), blobAt(3, 1, 1))).toBeCloseTo(2, 5);
  });

  it('scales by voxel spacing', () => {
    // same 2-voxel shift in x, but 2 mm/voxel ⇒ 4 mm.
    expect(bulkDisplacementMm(blobAt(1, 1, 1, [2, 1, 1]), blobAt(3, 1, 1, [2, 1, 1]))).toBeCloseTo(4, 5);
  });

  it('measures a diagonal shift as Euclidean distance', () => {
    // (1,1,1) → (2,2,1): √(1²+1²) = √2.
    expect(bulkDisplacementMm(blobAt(1, 1, 1), blobAt(2, 2, 1))).toBeCloseTo(Math.SQRT2, 5);
  });

  it('returns null for a uniform (objectless) volume — cannot estimate, so caller defaults to show', () => {
    const uniform: VolumeGeometry = {
      scalarData: new Float32Array(64).fill(50),
      dimensions: [4, 4, 4],
      spacing: [1, 1, 1],
      origin: [0, 0, 0],
    };
    expect(bulkDisplacementMm(uniform, blobAt(1, 1, 1))).toBeNull();
  });
});
