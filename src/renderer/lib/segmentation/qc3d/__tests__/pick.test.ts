/** Picking in the 3D QC view (branch 7 Q3). */
import { describe, expect, it } from 'vitest';
import { pickNearest } from '../pick';
import { voxelSurface } from '../mesh';

/** A unit cube mesh (voxel faces) shifted to `at`. */
const cube = (key: string, at: number[]) => {
  const m = voxelSurface(new Uint8Array([1]), [1, 1, 1]);
  const positions = Float32Array.from(m.positions, (v, i) => v + at[i % 3]);
  return { key, positions, indices: m.indices };
};

describe('pickNearest', () => {
  const near = cube('near', [0, 0, 5]);
  const far = cube('far', [0, 0, -5]);
  const aside = cube('aside', [10, 0, 0]);

  it('returns the first mesh along the ray', () => {
    expect(pickNearest([far, near, aside], [0, 0, 100], [0, 0, -1])?.key).toBe('near');
    expect(pickNearest([far, near, aside], [0, 0, -100], [0, 0, 1])?.key).toBe('far');
  });

  it('a ray that misses everything picks nothing', () => {
    expect(pickNearest([far, near, aside], [5, 5, 100], [0, 0, -1])).toBeNull();
  });

  it('hits off to the side, and the distance is to the near face', () => {
    const hit = pickNearest([aside], [10.2, 0.1, 100], [0, 0, -1])!;
    expect(hit.key).toBe('aside');
    expect(hit.t).toBeCloseTo(99.5);
  });

  it('nothing behind the ray origin', () => {
    expect(pickNearest([far], [0, 0, -100], [0, 0, -1])).toBeNull();
  });
});
