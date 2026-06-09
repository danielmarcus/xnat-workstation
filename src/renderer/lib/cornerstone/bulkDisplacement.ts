/**
 * bulkDisplacement — estimate gross anatomy displacement (mm) between two volumes
 * of the same Frame of Reference, used by forEligibility (A2c) to decide whether
 * a same-FoR/different-series pair is "anatomically consistent" (T1/T2 same exam →
 * ~0 mm → show) or "displaced" (separate breath-holds / 4D phase bins → large →
 * hide). PURE: no Cornerstone imports.
 *
 * Heuristic: the intensity-weighted centroid of each volume, in world mm, then the
 * Euclidean distance between them. Axis-aligned (origin + index·spacing) — adequate
 * for a gross bulk-shift signal; not a registration. Background contributes ~0
 * because weights are taken relative to the volume minimum. Returns null when a
 * centroid can't be estimated (uniform/objectless volume) so the caller defaults to
 * "show" (uncertain ⇒ A2b).
 */

export interface VolumeGeometry {
  /** Voxel values, column-major: index = i + j·nx + k·nx·ny. */
  scalarData: ArrayLike<number>;
  dimensions: [number, number, number]; // [nx, ny, nz]
  spacing: [number, number, number]; // mm per voxel [sx, sy, sz]
  origin: [number, number, number]; // world mm of voxel (0,0,0)
}

function intensityWeightedCentroidMm(vol: VolumeGeometry): [number, number, number] | null {
  const [nx, ny, nz] = vol.dimensions;
  const [sx, sy, sz] = vol.spacing;
  const [ox, oy, oz] = vol.origin;
  const data = vol.scalarData;
  const n = data.length;
  if (n <= 0 || nx <= 0 || ny <= 0 || nz <= 0) return null;

  let min = Infinity;
  for (let i = 0; i < n; i++) if (data[i] < min) min = data[i];

  let sumW = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let idx = 0;
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const w = data[idx++] - min; // ≥ 0; background ≈ 0
        if (w <= 0) continue;
        sumW += w;
        cx += w * (ox + i * sx);
        cy += w * (oy + j * sy);
        cz += w * (oz + k * sz);
      }
    }
  }
  if (sumW <= 0) return null; // uniform volume — no object to locate
  return [cx / sumW, cy / sumW, cz / sumW];
}

export function bulkDisplacementMm(a: VolumeGeometry, b: VolumeGeometry): number | null {
  const ca = intensityWeightedCentroidMm(a);
  const cb = intensityWeightedCentroidMm(b);
  if (!ca || !cb) return null;
  return Math.hypot(cb[0] - ca[0], cb[1] - ca[1], cb[2] - ca[2]);
}
