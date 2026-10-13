/** 3D cleanup of solver results (branch 5, G1): keep component, islands, smoothing, shrink–grow. */
import { describe, expect, it } from 'vitest';
import { keepComponent, majoritySmooth3d, postProcess3d, removeIslands3d, shrinkGrow3d, DEFAULT_POST_PROCESS } from '../volumeCleanup';
import type { Dims } from '../../solvers/volume';

const D: Dims = [10, 10, 4];
const at = (x: number, y: number, z: number) => x + 10 * (y + 10 * z);
const count = (m: Uint8Array) => m.reduce((s, v) => s + v, 0);
/** A 4×4×2 block at (1,1,1) and a 2×1×1 speck at (8,8,2). */
function twoParts() {
  const m = new Uint8Array(400);
  for (let z = 1; z <= 2; z++) for (let y = 1; y <= 4; y++) for (let x = 1; x <= 4; x++) m[at(x, y, z)] = 1;
  m[at(8, 8, 2)] = 1; m[at(8, 7, 2)] = 1;
  return m;
}

describe('volume cleanup', () => {
  it('keep: the seeded component, or the largest when no seed is in any', () => {
    const seeds = new Uint8Array(400);
    seeds[at(8, 8, 2)] = 1;
    expect(count(keepComponent(twoParts(), D, 'seed', seeds))).toBe(2);
    expect(count(keepComponent(twoParts(), D, 'largest'))).toBe(32);
    expect(count(keepComponent(twoParts(), D, 'seed', new Uint8Array(400)))).toBe(32);
  });

  it('islands below the minimum go, unless they hold a seed', () => {
    expect(count(removeIslands3d(twoParts(), D, 5))).toBe(32);
    const seeds = new Uint8Array(400);
    seeds[at(8, 7, 2)] = 1;
    expect(count(removeIslands3d(twoParts(), D, 5, seeds))).toBe(34);
    expect(count(removeIslands3d(twoParts(), D, 0))).toBe(34);
  });

  it('majority smoothing removes the speck and fills a one-voxel pit; seeds stay', () => {
    const m = twoParts();
    m[at(2, 2, 1)] = 0;
    const out = majoritySmooth3d(m, D, 1);
    expect(out[at(8, 8, 2)]).toBe(0);
    expect(out[at(2, 2, 1)]).toBe(1);
    const seeds = new Uint8Array(400);
    seeds[at(8, 8, 2)] = 1;
    expect(majoritySmooth3d(m, D, 1, seeds)[at(8, 8, 2)]).toBe(1);
  });

  it('shrink–grow (opening) removes a 1-voxel-thin spur and keeps the block', () => {
    // A block thick enough (5 voxels) to survive one 6-neighbour erosion.
    const d: Dims = [12, 12, 7];
    const ix = (x: number, y: number, z: number) => x + 12 * (y + 12 * z);
    const m = new Uint8Array(12 * 12 * 7);
    for (let z = 1; z <= 5; z++) for (let y = 1; y <= 5; y++) for (let x = 1; x <= 5; x++) m[ix(x, y, z)] = 1;
    for (let x = 6; x <= 10; x++) m[ix(x, 3, 3)] = 1; // spur off the block
    const out = shrinkGrow3d(m, d, 1);
    expect(out[ix(8, 3, 3)]).toBe(0);
    expect(out[ix(3, 3, 3)]).toBe(1);
    expect(out[ix(1, 3, 3)]).toBe(1); // the block's face comes back
  });

  it('off by default: the chain returns the mask untouched', () => {
    const m = twoParts();
    expect(postProcess3d(m, D, DEFAULT_POST_PROCESS)).toBe(m);
    expect(count(postProcess3d(m, D, { ...DEFAULT_POST_PROCESS, enabled: true, keep: 'largest', minIsland: 0 }))).toBe(32);
  });
});
