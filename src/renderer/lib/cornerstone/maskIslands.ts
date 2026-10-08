/**
 * Mask "islands" — the selectable component of a segment (unified selection,
 * docs/unified-selection.md): one connected painted region of a segment on one slice.
 *
 * Pure functions over a SegmentVoxelGrid-shaped grid (column-major `data`, the segment
 * stored as `value`, geometry with a row-major 3×3 `direction` whose COLUMNS are the
 * grid axes). The slice is a plane of constant index along `axis` — the grid axis the
 * viewer is looking along — so this holds for any acquisition orientation.
 */

export type Vec3 = [number, number, number];

export interface IslandGrid {
  geometry: { dimensions: Vec3 | number[]; spacing: Vec3 | number[]; origin: Vec3 | number[]; direction: number[] };
  data: ArrayLike<number>;
  value: number;
}

/** The grid axis (0 = i, 1 = j, 2 = k) most parallel to a view-plane normal. */
export function sliceAxisFor(direction: number[], viewPlaneNormal: ArrayLike<number>): 0 | 1 | 2 {
  let best: 0 | 1 | 2 = 2;
  let bestDot = -1;
  for (const axis of [0, 1, 2] as const) {
    const dot = Math.abs(
      direction[0 * 3 + axis] * viewPlaneNormal[0]
      + direction[1 * 3 + axis] * viewPlaneNormal[1]
      + direction[2 * 3 + axis] * viewPlaneNormal[2],
    );
    if (dot > bestDot) {
      bestDot = dot;
      best = axis;
    }
  }
  return best;
}

function ijkOf(flat: number, dims: ArrayLike<number>): Vec3 {
  const nx = dims[0];
  const ny = dims[1];
  const k = Math.floor(flat / (nx * ny));
  const rem = flat - k * nx * ny;
  const j = Math.floor(rem / nx);
  return [rem - j * nx, j, k];
}

function flatOf(ijk: ArrayLike<number>, dims: ArrayLike<number>): number {
  return ijk[0] + ijk[1] * dims[0] + ijk[2] * dims[0] * dims[1];
}

/** The two in-plane axes of a slice along `axis`. */
function inPlane(axis: 0 | 1 | 2): [0 | 1 | 2, 0 | 1 | 2] {
  return axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
}

/**
 * The island containing voxel `seed` (flat index) on its slice along `axis`: every voxel
 * of the segment 8-connected to it within that slice. Empty when the seed is not part of
 * the segment.
 */
export function islandAt(grid: IslandGrid, seed: number, axis: 0 | 1 | 2): number[] {
  const dims = grid.geometry.dimensions;
  if (grid.data[seed] !== grid.value) return [];
  const [a, b] = inPlane(axis);
  const seen = new Set<number>([seed]);
  const out: number[] = [];
  const stack = [seed];
  while (stack.length) {
    const flat = stack.pop()!;
    out.push(flat);
    const ijk = ijkOf(flat, dims);
    for (let da = -1; da <= 1; da++) {
      for (let db = -1; db <= 1; db++) {
        if (da === 0 && db === 0) continue;
        const n: Vec3 = [ijk[0], ijk[1], ijk[2]];
        n[a] += da;
        n[b] += db;
        if (n[a] < 0 || n[b] < 0 || n[a] >= dims[a] || n[b] >= dims[b]) continue;
        const nf = flatOf(n, dims);
        if (seen.has(nf) || grid.data[nf] !== grid.value) continue;
        seen.add(nf);
        stack.push(nf);
      }
    }
  }
  return out;
}

/** World position of a (possibly fractional) grid index. */
export function indexToWorld(geometry: IslandGrid['geometry'], ijk: ArrayLike<number>): Vec3 {
  const { origin, spacing, direction } = geometry;
  const out: Vec3 = [origin[0], origin[1], origin[2]];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) out[r] += direction[r * 3 + c] * ijk[c] * spacing[c];
  }
  return out;
}

/**
 * The island's outline as world-space line segments: every voxel edge, in the slice
 * plane, between an island voxel and a non-island neighbour. Returned flat:
 * [x0,y0,z0, x1,y1,z1, …] per segment.
 */
export function islandOutline(grid: IslandGrid, island: number[], axis: 0 | 1 | 2): number[] {
  const dims = grid.geometry.dimensions;
  const members = new Set(island);
  const [a, b] = inPlane(axis);
  const segments: number[] = [];
  const push = (p: Vec3, q: Vec3) => {
    const wp = indexToWorld(grid.geometry, p);
    const wq = indexToWorld(grid.geometry, q);
    segments.push(wp[0], wp[1], wp[2], wq[0], wq[1], wq[2]);
  };
  for (const flat of island) {
    const ijk = ijkOf(flat, dims);
    // For each in-plane side: [neighbour step, the edge's two corners in half-voxel steps].
    const sides: Array<[number, number, [number, number], [number, number]]> = [
      [-1, 0, [-0.5, -0.5], [-0.5, 0.5]],
      [1, 0, [0.5, -0.5], [0.5, 0.5]],
      [0, -1, [-0.5, -0.5], [0.5, -0.5]],
      [0, 1, [-0.5, 0.5], [0.5, 0.5]],
    ];
    for (const [da, db, c0, c1] of sides) {
      const n: Vec3 = [ijk[0], ijk[1], ijk[2]];
      n[a] += da;
      n[b] += db;
      const inside = n[a] >= 0 && n[b] >= 0 && n[a] < dims[a] && n[b] < dims[b] && members.has(flatOf(n, dims));
      if (inside) continue;
      const p: Vec3 = [ijk[0], ijk[1], ijk[2]];
      const q: Vec3 = [ijk[0], ijk[1], ijk[2]];
      p[a] += c0[0]; p[b] += c0[1];
      q[a] += c1[0]; q[b] += c1[1];
      push(p, q);
    }
  }
  return segments;
}
