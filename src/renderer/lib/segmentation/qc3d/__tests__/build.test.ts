/** The 3D QC surface build (branch 7 Q2): components, world-space meshes, thin boost. */
import { describe, expect, it } from 'vitest';
import { buildQcSurfaces, type QcGeometry } from '../build';
import { meshVolume } from '../mesh';

const N = 40;
const geometry: QcGeometry = {
  dimensions: [N, N, N], spacing: [0.5, 0.5, 2], origin: [100, -50, 10],
  direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
};
// A ball (r 8 voxels) at (20,20,20), a 3-voxel rod far away, and a lone voxel.
const mask = new Uint8Array(N * N * N);
const set = (i: number, j: number, k: number) => { mask[i + N * (j + N * k)] = 1; };
for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if ((i - 20) ** 2 + (j - 20) ** 2 + (k - 20) ** 2 <= 64) set(i, j, k);
set(2, 2, 2); set(3, 2, 2); set(4, 2, 2);
set(36, 36, 36);

const base = { mask, geometry, resolution: 256 as const, renderer: 'blocky' as const, smoothIterations: 0, thinBoost: false };

describe('buildQcSurfaces', () => {
  it('reports components largest first with cc volumes and world centroids', () => {
    const r = buildQcSurfaces(base);
    expect(r.components.map((c) => c.voxels)).toEqual([r.components[0].voxels, 3, 1]);
    expect(r.components[0].volumeCc).toBeCloseTo((r.components[0].voxels * 0.5 * 0.5 * 2) / 1000);
    expect(r.components[0].centroidWorld).toEqual([110, -40, 50]);
    expect(r.components[2].centroidWorld).toEqual([118, -32, 82]);
  });

  it('meshes each component in world space: a blocky mesh encloses its voxels’ volume', () => {
    const r = buildQcSurfaces(base);
    expect(r.meshes).toHaveLength(3);
    const ball = r.meshes.find((m) => m.componentId === r.components[0].id)!;
    expect(meshVolume({ positions: ball.positions, indices: ball.indices })).toBeCloseTo(r.components[0].voxels * 0.5 * 0.5 * 2, 1);
    // every vertex lies within the ball's world box (± half a voxel)
    for (let v = 0; v < ball.positions.length; v += 3) {
      expect(ball.positions[v]).toBeGreaterThanOrEqual(100 + 11.5 * 0.5 - 1e-6);
      expect(ball.positions[v]).toBeLessThanOrEqual(100 + 28.5 * 0.5 + 1e-6);
    }
    // normals are unit length and point outward (lighting depends on it)
    expect(Math.hypot(ball.normals[0], ball.normals[1], ball.normals[2])).toBeCloseTo(1);
    let outward = 0;
    for (let v = 0; v < ball.positions.length; v += 3) {
      const d = [ball.positions[v] - 110, ball.positions[v + 1] + 40, ball.positions[v + 2] - 50];
      if (d[0] * ball.normals[v] + d[1] * ball.normals[v + 1] + d[2] * ball.normals[v + 2] > 0) outward++;
    }
    expect(outward).toBe(ball.positions.length / 3);
  });

  it('a lower resolution coarsens the mesh but keeps every component', () => {
    const fine = buildQcSurfaces(base);
    const coarse = buildQcSurfaces({ ...base, resolution: 128, geometry: { ...geometry, dimensions: [N, N, N] } });
    expect(coarse.meshes).toHaveLength(3);
    expect(buildQcSurfaces({ ...base, mask: up(mask), geometry: { ...geometry, dimensions: [N * 4, N, N] }, resolution: 128 }).factor).toBe(2);
    expect(coarse.meshes[0].indices.length).toBeLessThanOrEqual(fine.meshes[0].indices.length);
  });

  it('thin boost thickens a one-voxel rod for display, and leaves the ball alone', () => {
    const plain = buildQcSurfaces(base);
    const boosted = buildQcSurfaces({ ...base, thinBoost: true });
    const vol = (r: typeof plain, id: number) => {
      const m = r.meshes.find((x) => x.componentId === id)!;
      return meshVolume({ positions: m.positions, indices: m.indices });
    };
    const rod = plain.components[1].id;
    expect(vol(boosted, rod)).toBeGreaterThan(vol(plain, rod) * 5);
    expect(vol(boosted, plain.components[0].id)).toBeCloseTo(vol(plain, plain.components[0].id), 1);
    expect(boosted.components[1].voxels).toBe(3); // the report is unchanged
  });

  it('smooth renderer + Taubin gives a closed mesh close to the ball’s volume', () => {
    const r = buildQcSurfaces({ ...base, renderer: 'smooth', smoothIterations: 10 });
    const ball = r.meshes[0];
    const v = meshVolume({ positions: ball.positions, indices: ball.indices });
    expect(Math.abs(v / (r.components[0].voxels * 0.5) - 1)).toBeLessThan(0.15);
  });
});

/** Stretch a volume ×4 along i (to exercise the resampling factor). */
function up(m: Uint8Array): Uint8Array {
  const o = new Uint8Array(N * 4 * N * N);
  for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N * 4; i++) o[i + N * 4 * (j + N * k)] = m[Math.floor(i / 4) + N * (j + N * k)];
  return o;
}

describe('buildQcSurfaces on thick slices (S10.5, #100)', () => {
  it('pools each axis by its own factor: a one-slice plate is one slice thick, not three', () => {
    const d: [number, number, number] = [300, 300, 10];
    const g: QcGeometry = { dimensions: d, spacing: [0.7, 0.7, 2.5], origin: [0, 0, 0], direction: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
    const m = new Uint8Array(d[0] * d[1] * d[2]);
    for (let j = 100; j < 200; j++) for (let i = 100; i < 200; i++) m[i + d[0] * (j + d[1] * 5)] = 1;
    const r = buildQcSurfaces({ mask: m, geometry: g, resolution: 128, renderer: 'blocky', smoothIterations: 0, thinBoost: false });
    const P = r.meshes[0].positions;
    let z0 = Infinity, z1 = -Infinity, x0 = Infinity, x1 = -Infinity;
    for (let v = 0; v < P.length; v += 3) { z0 = Math.min(z0, P[v + 2]); z1 = Math.max(z1, P[v + 2]); x0 = Math.min(x0, P[v]); x1 = Math.max(x1, P[v]); }
    expect(z1 - z0, 'the plate’s thickness in mm').toBeCloseTo(2.5, 3);
    expect(z0).toBeCloseTo(4.5 * 2.5, 3);
    // in-plane it is still pooled (×3): its width is 70 mm to within a pooled block
    expect(Math.abs(x1 - x0 - 70)).toBeLessThanOrEqual(3 * 0.7 + 1e-6);
  });
});
