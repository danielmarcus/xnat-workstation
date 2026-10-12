/**
 * Surfaces of a binary volume for the 3D QC view (SegWorks parity #230, #247; branch 7),
 * in index coordinates (a voxel's centre is its integer index). Both extractions give a
 * closed, consistently outward-oriented triangle mesh with shared vertices, so it can be
 * smoothed (taubinSmooth) and its volume measured.
 *
 *  - voxelSurface: the voxel faces — exact, blocky.
 *  - surfaceNets: naive Surface Nets (Gibson 1998, as in VTK's SurfaceNets3D) — one vertex
 *    per boundary cell at the mean of its crossing edges; smooth, and fewer triangles than
 *    marching cubes, with no ambiguous cases.
 */
import type { Dims } from './components';

export interface Mesh {
  positions: Float32Array;
  indices: Uint32Array;
}

/** Cyclic axis triples (a, b, c): e_b × e_c = e_a. */
const AXES: Array<[number, number, number]> = [[0, 1, 2], [1, 2, 0], [2, 0, 1]];

export function voxelSurface(mask: ArrayLike<number>, dims: Dims): Mesh {
  const [nx, ny, nz] = dims;
  const at = (i: number, j: number, k: number) => (i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz ? !!mask[i + nx * (j + ny * k)] : false);
  const pos: number[] = [];
  const idx: number[] = [];
  const vmap = new Map<number, number>();
  // Corners live on a (nx+1)(ny+1)(nz+1) lattice; corner (ci, cj, ck) is at index − 0.5.
  const vert = (ci: number, cj: number, ck: number) => {
    const key = ci + (nx + 1) * (cj + (ny + 1) * ck);
    let v = vmap.get(key);
    if (v === undefined) {
      v = pos.length / 3;
      vmap.set(key, v);
      pos.push(ci - 0.5, cj - 0.5, ck - 0.5);
    }
    return v;
  };
  const c = [0, 0, 0];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!mask[i + nx * (j + ny * k)]) continue;
    const p = [i, j, k];
    for (const [a, b, cc] of AXES) {
      for (const dir of [1, -1]) {
        const q = p.slice();
        q[a] += dir;
        if (at(q[0], q[1], q[2])) continue;
        // The face's corners in the (b, c) plane, at a = p_a + (dir > 0 ? 1 : 0).
        const quad: number[] = [];
        for (const [db, dc] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
          c[a] = p[a] + (dir > 0 ? 1 : 0);
          c[b] = p[b] + db;
          c[cc] = p[cc] + dc;
          quad.push(vert(c[0], c[1], c[2]));
        }
        if (dir < 0) quad.reverse();
        idx.push(quad[0], quad[1], quad[2], quad[0], quad[2], quad[3]);
      }
    }
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
}

export function surfaceNets(mask: ArrayLike<number>, dims: Dims): Mesh {
  const [nx, ny, nz] = dims;
  const at = (i: number, j: number, k: number) => (i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz && mask[i + nx * (j + ny * k)] ? 1 : 0);
  // Cells span samples x..x+1 for x in −1..n−1; stored with a +1 offset.
  const cx = nx + 1, cy = ny + 1, cz = nz + 1;
  const cellVert = new Int32Array(cx * cy * cz).fill(-1);
  const pos: number[] = [];
  const corner = new Uint8Array(8);
  for (let z = -1; z < nz; z++) for (let y = -1; y < ny; y++) for (let x = -1; x < nx; x++) {
    let sum = 0;
    for (let n = 0; n < 8; n++) {
      corner[n] = at(x + (n & 1), y + ((n >> 1) & 1), z + ((n >> 2) & 1));
      sum += corner[n];
    }
    if (sum === 0 || sum === 8) continue;
    // The mean of the midpoints of the cube edges whose ends differ.
    let px = 0, py = 0, pz = 0, m = 0;
    for (let n = 0; n < 8; n++) {
      for (const bit of [1, 2, 4]) {
        if (n & bit) continue;
        const o = n | bit;
        if (corner[n] === corner[o]) continue;
        px += x + ((n & 1) + (o & 1)) / 2;
        py += y + (((n >> 1) & 1) + ((o >> 1) & 1)) / 2;
        pz += z + (((n >> 2) & 1) + ((o >> 2) & 1)) / 2;
        m++;
      }
    }
    cellVert[(x + 1) + cx * ((y + 1) + cy * (z + 1))] = pos.length / 3;
    pos.push(px / m, py / m, pz / m);
  }
  const cell = (c: number[]) => cellVert[(c[0] + 1) + cx * ((c[1] + 1) + cy * (c[2] + 1))];
  const idx: number[] = [];
  const n3 = [nx, ny, nz];
  const p = [0, 0, 0], q = [0, 0, 0], c = [0, 0, 0];
  // Every sample edge whose ends differ gets the quad of the four cells around it.
  for (const [a, b, cc] of AXES) {
    for (p[cc] = 0; p[cc] < n3[cc]; p[cc]++) for (p[b] = 0; p[b] < n3[b]; p[b]++) for (p[a] = -1; p[a] < n3[a]; p[a]++) {
      q[0] = p[0]; q[1] = p[1]; q[2] = p[2];
      q[a] += 1;
      const s0 = at(p[0], p[1], p[2]), s1 = at(q[0], q[1], q[2]);
      if (s0 === s1) continue;
      const quad: number[] = [];
      for (const [db, dc] of [[-1, -1], [0, -1], [0, 0], [-1, 0]]) {
        c[a] = p[a];
        c[b] = p[b] + db;
        c[cc] = p[cc] + dc;
        quad.push(cell(c));
      }
      // Inside at p ⇒ the outward normal is +a, which this (b, c) order already gives.
      if (!s0) quad.reverse();
      idx.push(quad[0], quad[1], quad[2], quad[0], quad[2], quad[3]);
    }
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
}

/** Enclosed volume (divergence theorem; positive for an outward mesh). */
export function meshVolume(m: Mesh): number {
  let v = 0;
  const P = m.positions;
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = m.indices[t] * 3, b = m.indices[t + 1] * 3, c = m.indices[t + 2] * 3;
    v += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1])
      - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c])
      + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  return v / 6;
}

export function meshArea(m: Mesh): number {
  let s = 0;
  const P = m.positions;
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = m.indices[t] * 3, b = m.indices[t + 1] * 3, c = m.indices[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    s += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return s;
}
