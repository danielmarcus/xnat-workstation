/**
 * The 3D QC surface build (SegWorks parity #230, #239–240, #247, #249; branch 7): one
 * segment's mask in, its components and a world-space mesh per component out. Pure, so the
 * compute worker runs it and unit tests check it.
 *
 * Components are found at full resolution (the report is exact); each is meshed from its own
 * bounding-box crop, max-pooled by volume-wide factors (each axis brought within the resolution
 * 128/192/256 on its own — one factor for every axis, set by the 512-pixel rows, pooled 40
 * thick slices three at a time and drew a one-slice structure three slices thick), so a speck
 * stays visible and each component can be coloured, hidden and picked on its own.
 */
import { labelComponents3d, type Component3d, type Dims } from './components';
import { maxPoolByFactor } from './resample';
import { surfaceNets, voxelSurface, type Mesh } from './mesh';
import { taubinSmooth } from './smooth';

export interface QcGeometry {
  dimensions: Dims;
  spacing: [number, number, number];
  origin: [number, number, number];
  /** Row-major 3×3 axis cosines, as VoxelGridGeometry. */
  direction: number[];
}

export interface QcBuildInput {
  mask: Uint8Array;
  geometry: QcGeometry;
  resolution: 128 | 192 | 256;
  renderer: 'blocky' | 'smooth';
  /** Taubin iterations (0 = off). */
  smoothIterations: number;
  /** Mesh components thinner than 2 voxels one voxel dilated, for display only. */
  thinBoost: boolean;
  /** Components beyond this many (smallest first) are reported but not meshed. */
  maxMeshed?: number;
}

export interface QcComponent extends Component3d {
  volumeCc: number;
  centroidWorld: [number, number, number];
  /** Estimated thickness in voxels (2·volume / surface area). */
  thickness: number;
}

export interface QcMesh {
  componentId: number;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export interface QcBuildOutput {
  components: QcComponent[];
  meshes: QcMesh[];
  /** The largest pool factor; `factors` per axis. */
  factor: number;
  factors: Dims;
}

export function indexToWorldQc(g: QcGeometry, i: number, j: number, k: number, out: number[] = [0, 0, 0]): number[] {
  const a = i * g.spacing[0], b = j * g.spacing[1], c = k * g.spacing[2];
  for (let r = 0; r < 3; r++) out[r] = g.origin[r] + g.direction[r * 3] * a + g.direction[r * 3 + 1] * b + g.direction[r * 3 + 2] * c;
  return out;
}

export function buildQcSurfaces(inp: QcBuildInput, progress?: (f: number) => void): QcBuildOutput {
  const g = inp.geometry;
  const [nx, ny] = g.dimensions;
  const { labels, components } = labelComponents3d(inp.mask, g.dimensions);
  const voxelCc = (g.spacing[0] * g.spacing[1] * g.spacing[2]) / 1000;
  const factors = g.dimensions.map((n) => Math.max(1, Math.ceil(n / inp.resolution))) as unknown as Dims;
  const factor = Math.max(...factors);
  const out: QcComponent[] = [];
  const meshes: QcMesh[] = [];
  const maxMeshed = inp.maxMeshed ?? 2000;
  for (let n = 0; n < components.length; n++) {
    const c = components[n];
    // Crop with a one-voxel margin (two when the thin boost may dilate).
    const pad = inp.thinBoost ? 2 : 1;
    const [i0, j0, k0, i1, j1, k1] = c.bbox;
    const ox = i0 - pad, oy = j0 - pad, oz = k0 - pad;
    const cd: Dims = [i1 - i0 + 1 + 2 * pad, j1 - j0 + 1 + 2 * pad, k1 - k0 + 1 + 2 * pad];
    let crop: Uint8Array = new Uint8Array(cd[0] * cd[1] * cd[2]);
    let faces = 0;
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const p = i + nx * (j + ny * k);
      if (labels[p] !== c.id) continue;
      crop[(i - ox) + cd[0] * ((j - oy) + cd[1] * (k - oz))] = 1;
      // Exposed faces, for the thickness estimate.
      for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const x = i + di, y = j + dj, z = k + dk;
        const inside = x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < g.dimensions[2] && labels[x + nx * (y + ny * z)] === c.id;
        if (!inside) faces++;
      }
    }
    const thickness = faces ? (2 * c.voxels) / faces : 0;
    const centroidWorld = indexToWorldQc(g, c.centroid[0], c.centroid[1], c.centroid[2]) as [number, number, number];
    out.push({ ...c, volumeCc: c.voxels * voxelCc, centroidWorld, thickness });
    if (n >= maxMeshed) continue;
    if (inp.thinBoost && thickness < 2) crop = dilate26(crop, cd);
    const pooled = maxPoolByFactor(crop, cd, factors);
    let mesh: Mesh = inp.renderer === 'smooth' ? surfaceNets(pooled.data, pooled.dims) : voxelSurface(pooled.data, pooled.dims);
    if (inp.smoothIterations > 0) mesh = taubinSmooth(mesh, { iterations: inp.smoothIterations });
    // Pooled index → crop index (the block's centre) → volume index → world.
    const P = mesh.positions;
    const world = new Float32Array(P.length);
    const w = [0, 0, 0];
    for (let v = 0; v < P.length; v += 3) {
      indexToWorldQc(g, P[v] * factors[0] + (factors[0] - 1) / 2 + ox, P[v + 1] * factors[1] + (factors[1] - 1) / 2 + oy, P[v + 2] * factors[2] + (factors[2] - 1) / 2 + oz, w);
      world[v] = w[0]; world[v + 1] = w[1]; world[v + 2] = w[2];
    }
    meshes.push({ componentId: c.id, positions: world, normals: vertexNormals(world, mesh.indices), indices: mesh.indices });
    progress?.((n + 1) / Math.min(components.length, maxMeshed));
  }
  return { components: out, meshes, factor, factors };
}

function dilate26(m: Uint8Array, d: Dims): Uint8Array {
  const out = Uint8Array.from(m);
  const [nx, ny, nz] = d;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!m[i + nx * (j + ny * k)]) continue;
    for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const x = i + di, y = j + dj, z = k + dk;
      if (x >= 0 && y >= 0 && z >= 0 && x < nx && y < ny && z < nz) out[x + nx * (y + ny * z)] = 1;
    }
  }
  return out;
}

/** Area-weighted vertex normals (outward for an outward mesh). */
export function vertexNormals(P: Float32Array, I: Uint32Array): Float32Array {
  const N = new Float32Array(P.length);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const o of [a, b, c]) { N[o] += nx; N[o + 1] += ny; N[o + 2] += nz; }
  }
  for (let v = 0; v < N.length; v += 3) {
    const l = Math.hypot(N[v], N[v + 1], N[v + 2]) || 1;
    N[v] /= l; N[v + 1] /= l; N[v + 2] /= l;
  }
  return N;
}
