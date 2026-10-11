/** 3D QC algorithms (SegWorks parity branch 7, Q1). */
import { describe, expect, it } from 'vitest';
import { classifyComponents, labelComponents3d } from '../components';
import { maxPoolResample } from '../resample';
import { meshArea, meshVolume, surfaceNets, voxelSurface, type Mesh } from '../mesh';
import { taubinSmooth } from '../smooth';

type Dims = [number, number, number];
const vol = (dims: Dims, inside: (i: number, j: number, k: number) => boolean) => {
  const [nx, ny, nz] = dims;
  const m = new Uint8Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (inside(i, j, k)) m[i + nx * (j + ny * k)] = 1;
  return m;
};
const ball = (n: number, r: number) => vol([n, n, n], (i, j, k) => (i - n / 2 + 0.5) ** 2 + (j - n / 2 + 0.5) ** 2 + (k - n / 2 + 0.5) ** 2 <= r * r);

/** Every edge of a closed, consistently oriented mesh is used once in each direction. */
function isClosedOriented(m: Mesh): boolean {
  const seen = new Map<string, number>();
  for (let t = 0; t < m.indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = m.indices[t + e], b = m.indices[t + ((e + 1) % 3)];
      const key = `${a}>${b}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  for (const [key, n] of seen) {
    const [a, b] = key.split('>');
    if (n !== 1 || seen.get(`${b}>${a}`) !== 1) return false;
  }
  return true;
}

describe('labelComponents3d', () => {
  const dims: Dims = [20, 20, 20];
  // A 4³ cube, a 2³ cube, a lone voxel, and a voxel touching the 2³ cube only at a corner.
  const m = vol(dims, (i, j, k) =>
    (i >= 2 && i < 6 && j >= 2 && j < 6 && k >= 2 && k < 6)
    || (i >= 10 && i < 12 && j >= 10 && j < 12 && k >= 10 && k < 12)
    || (i === 12 && j === 12 && k === 12)
    || (i === 17 && j === 3 && k === 15));

  it('finds the 26-connected components, largest first, with sizes, boxes and centroids', () => {
    const r = labelComponents3d(m, dims);
    expect(r.components.map((c) => c.voxels)).toEqual([64, 9, 1]);
    expect(r.components[0].bbox).toEqual([2, 2, 2, 5, 5, 5]);
    expect(r.components[0].centroid).toEqual([3.5, 3.5, 3.5]);
    expect(r.components[2].centroid).toEqual([17, 3, 15]);
    // labels map back to the component ids
    expect(r.labels[2 + 20 * (2 + 20 * 2)]).toBe(r.components[0].id);
    expect(r.labels[12 + 20 * (12 + 20 * 12)]).toBe(r.components[1].id);
    expect(r.labels[0]).toBe(0);
  });

  it('bands components: the largest is main; then fragment / stray / speck by voxel thresholds', () => {
    const r = labelComponents3d(m, dims);
    const bands = classifyComponents(r.components, { strayVoxels: 20, speckVoxels: 1 });
    expect(bands).toEqual(['main', 'stray', 'speck']);
    expect(classifyComponents(r.components, { strayVoxels: 5, speckVoxels: 0 })).toEqual(['main', 'fragment', 'stray']);
  });
});

describe('maxPoolResample', () => {
  it('shrinks the longest axis to the target by an integer factor, and a one-voxel speck survives', () => {
    const dims: Dims = [64, 40, 20];
    const m = vol(dims, (i, j, k) => i === 33 && j === 17 && k === 9);
    const r = maxPoolResample(m, dims, 16);
    expect(r.factor).toBe(4);
    expect(r.dims).toEqual([16, 10, 5]);
    expect(r.data.reduce((s, v) => s + v, 0)).toBe(1);
    expect(r.data[8 + 16 * (4 + 10 * 2)]).toBe(1);
  });

  it('a speck survives wherever it sits inside its block', () => {
    const dims: Dims = [64, 40, 20];
    const specks = [[0, 0, 0], [5, 10, 6], [14, 19, 11], [63, 39, 19]];
    const m = vol(dims, (i, j, k) => specks.some(([a, b, c]) => a === i && b === j && c === k));
    const r = maxPoolResample(m, dims, 16);
    expect(r.data.reduce((s, v) => s + v, 0)).toBe(specks.length);
  });

  it('leaves a volume already within the target alone', () => {
    const m = ball(10, 3);
    const r = maxPoolResample(m, [10, 10, 10], 128);
    expect(r.factor).toBe(1);
    expect(r.data).toEqual(m);
  });
});

describe('voxelSurface (blocky)', () => {
  it('one voxel: a closed unit cube', () => {
    const s = voxelSurface(new Uint8Array([1]), [1, 1, 1]);
    expect(s.indices.length / 3).toBe(12);
    expect(meshArea(s)).toBeCloseTo(6);
    expect(meshVolume(s)).toBeCloseTo(1);
    expect(isClosedOriented(s)).toBe(true);
  });

  it('two adjacent voxels share no face', () => {
    const s = voxelSurface(new Uint8Array([1, 1]), [2, 1, 1]);
    expect(meshArea(s)).toBeCloseTo(10);
    expect(meshVolume(s)).toBeCloseTo(2);
    expect(isClosedOriented(s)).toBe(true);
  });

  it('volume equals the voxel count for a ball', () => {
    const m = ball(24, 9);
    const s = voxelSurface(m, [24, 24, 24]);
    expect(meshVolume(s)).toBeCloseTo(m.reduce((a, v) => a + v, 0), 3);
  });
});

describe('surfaceNets (smooth)', () => {
  it('a ball: closed and outward, with volume and area close to the sphere', () => {
    const r = 10;
    const s = surfaceNets(ball(28, r), [28, 28, 28]);
    expect(isClosedOriented(s)).toBe(true);
    expect(meshVolume(s)).toBeGreaterThan(0);
    expect(Math.abs(meshVolume(s) / ((4 / 3) * Math.PI * r ** 3) - 1)).toBeLessThan(0.08);
    expect(Math.abs(meshArea(s) / (4 * Math.PI * r ** 2) - 1)).toBeLessThan(0.1);
  });

  it('touching the volume border still closes the surface', () => {
    const s = surfaceNets(new Uint8Array(27).fill(1), [3, 3, 3]);
    expect(isClosedOriented(s)).toBe(true);
    expect(meshVolume(s)).toBeGreaterThan(0);
  });
});

describe('taubinSmooth', () => {
  it('smooths a blocky ball toward a sphere without shrinking it', () => {
    const r = 9;
    const blocky = voxelSurface(ball(24, r), [24, 24, 24]);
    const smooth = taubinSmooth(blocky, { iterations: 20 });
    const roughness = (m: Mesh) => {
      const rs: number[] = [];
      for (let v = 0; v < m.positions.length; v += 3) rs.push(Math.hypot(m.positions[v] - 11.5, m.positions[v + 1] - 11.5, m.positions[v + 2] - 11.5));
      const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
      return Math.sqrt(rs.reduce((a, b) => a + (b - mean) ** 2, 0) / rs.length);
    };
    expect(roughness(smooth)).toBeLessThan(roughness(blocky) * 0.6);
    expect(Math.abs(meshVolume(smooth) / meshVolume(blocky) - 1)).toBeLessThan(0.05);
    expect(smooth.indices).toBe(blocky.indices); // topology is untouched
  });
});
