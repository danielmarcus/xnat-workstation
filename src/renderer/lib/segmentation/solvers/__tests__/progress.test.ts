/**
 * Solver progress (S10.7, #100): the bar moves while a solve runs and reaches the end — Graph
 * Cut used to report nothing until it finished, and Fast GrowCut divided by every voxel of the
 * box, so a gated solve stopped at the fraction it could reach.
 */
import { describe, expect, it } from 'vitest';
import { rasterizeSeeds, voxelCount, type Dims } from '../volume';
import { runSeededSolve, type SeededSolveInput } from '../seeded';

const D: Dims = [32, 32, 12];
const image = Float32Array.from({ length: voxelCount(D) }, (_, i) => {
  const x = i % D[0], y = Math.floor(i / D[0]) % D[1], z = Math.floor(i / (D[0] * D[1]));
  return Math.hypot(x - 16, y - 16, (z - 6) * 3) <= 8 ? 100 : 0;
});
const seeds = rasterizeSeeds(D, [
  { cls: 1, z: 6, points: [[14, 16], [18, 16]], rx: 1.5, ry: 1.5 },
  { cls: 2, z: 6, points: [[2, 2], [8, 2]], rx: 1.5, ry: 1.5 },
]);
const input = (o: Partial<SeededSolveInput>): SeededSolveInput => ({
  method: 'growCut', image, dims: D, spacing: [1, 1, 3], seeds, classes: 2, ...o,
});

function progressOf(o: Partial<SeededSolveInput>): number[] {
  const seen: number[] = [];
  runSeededSolve(input(o), (f) => seen.push(f));
  return seen;
}

describe('seeded solve progress', () => {
  it('Graph Cut reports progress before it finishes, rising to 1', () => {
    const seen = progressOf({ method: 'graphCut', graphCut: { lambda: 50, sigma: 30 } });
    expect(seen.filter((f) => f > 0 && f < 1).length, `progress ${seen}`).toBeGreaterThanOrEqual(2);
    expect(seen.every((f, i) => i === 0 || f >= seen[i - 1])).toBe(true);
    expect(seen[seen.length - 1]).toBe(1);
  });

  it('gated Fast GrowCut: the fraction counts only the voxels it can enter, and ends at 1', () => {
    // The gate admits only the ball (~1/6 of the box): its progress used to stop near 0.17.
    const seen = progressOf({ method: 'growCut', gate: { lo: 50, hi: 150 } });
    const before = seen.filter((f) => f < 1);
    expect(Math.max(...before), `progress ${seen}`).toBeGreaterThan(0.8);
    expect(seen[seen.length - 1]).toBe(1);
  });
});
