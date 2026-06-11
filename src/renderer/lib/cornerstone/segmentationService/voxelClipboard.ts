/**
 * Voxel-region clipboard + nearest-neighbour resample (D6 / C2).
 *
 * Pure geometry — no Cornerstone/GPU. `copyVoxelRegion` extracts the tight voxel
 * bounding box of ONE segment from a labelmap as a small sub-grid carrying its own
 * world transform (origin/spacing/direction) plus the source segment index (for
 * reference). `pasteVoxelRegion` NN-resamples that sub-grid into a target labelmap
 * at a world translation, writing the ACTIVE member's index (D6.6 — paste never
 * creates a member) and honouring the overlap policy (C6). World geometry is
 * preserved: a voxel copied at world point P lands at P (after translation)
 * regardless of the target's resolution, slice positions, or orientation, because
 * the resample maps through world space, not pixel indices. Voxels whose world
 * position falls outside the target grid clip silently (D6 — the caller shows a
 * brief partial-paste toast when `clipped` is true).
 *
 * Conventions: scalar layout is column-major `i + j·nx + k·nx·ny` (Cornerstone).
 * `direction` is the 9-element row-major 3×3 of unit axis cosines (DICOM LPS); it
 * is assumed orthonormal (true for DICOM ImageOrientationPatient), so its inverse
 * is its transpose.
 */

export type Vec3 = [number, number, number];

export interface VoxelGridGeometry {
  /** Voxel counts [nx, ny, nz]. */
  dimensions: Vec3;
  /** mm per voxel along i, j, k. */
  spacing: Vec3;
  /** World position of voxel (0,0,0)'s center. */
  origin: Vec3;
  /** Row-major 3×3 unit axis cosines (orthonormal). */
  direction: number[];
}

export interface VoxelRegionClip {
  geometry: VoxelGridGeometry;
  /** 1 where the copied segment was set, else 0 (column-major over geometry.dimensions). */
  data: Uint8Array;
  /** Source segment index — preserved for reference (not applied on paste). */
  sourceSegmentIndex: number;
}

export interface PasteOptions {
  /** The active member index voxels are written as (D6.6). */
  targetSegmentIndex: number;
  /** Conflict policy at painted voxels (C6). Both write the active member at painted voxels. */
  overlap: 'additive' | 'overwrite';
  /** World-space delta added to the clip before resampling (paste at a different slice). */
  translationWorld?: Vec3;
  /** Alt-modifier: clear the active member where the clip is set instead of painting it. */
  subtract?: boolean;
  /**
   * Optional live writer. When provided, each written voxel goes through this
   * callback (flat column-major index, value) INSTEAD of `target.data[ti] = v` — so a
   * caller can route writes through a Cornerstone voxelManager's setAtIndex (the
   * brush's own write path), which is required for a derived volume labelmap whose
   * scalar array read-back is a copy. `target.data` is still read for the subtract
   * check and bounds.
   */
  writeTarget?: (flatIndex: number, value: number) => void;
}

export interface PasteResult {
  /** Number of target voxels written (or cleared, in subtract mode). */
  written: number;
  /** True if any painted source voxel fell outside the target extent (partial paste). */
  clipped: boolean;
}

function dot3(a: number, b: number, c: number, v: Vec3): number {
  return a * v[0] + b * v[1] + c * v[2];
}

/** index → world: origin + Direction · (index .* spacing). */
export function indexToWorld(geom: VoxelGridGeometry, index: Vec3): Vec3 {
  const d = geom.direction;
  const s: Vec3 = [index[0] * geom.spacing[0], index[1] * geom.spacing[1], index[2] * geom.spacing[2]];
  return [
    geom.origin[0] + dot3(d[0], d[1], d[2], s),
    geom.origin[1] + dot3(d[3], d[4], d[5], s),
    geom.origin[2] + dot3(d[6], d[7], d[8], s),
  ];
}

/** world → fractional index: (Directionᵀ · (world − origin)) ./ spacing. */
function worldToIndexFloat(geom: VoxelGridGeometry, world: Vec3): Vec3 {
  const d = geom.direction;
  const diff: Vec3 = [world[0] - geom.origin[0], world[1] - geom.origin[1], world[2] - geom.origin[2]];
  // transpose of an orthonormal direction matrix = its inverse
  const v: Vec3 = [
    dot3(d[0], d[3], d[6], diff),
    dot3(d[1], d[4], d[7], diff),
    dot3(d[2], d[5], d[8], diff),
  ];
  return [v[0] / geom.spacing[0], v[1] / geom.spacing[1], v[2] / geom.spacing[2]];
}

/** world → nearest-neighbour integer index. */
export function worldToIndex(geom: VoxelGridGeometry, world: Vec3): Vec3 {
  const f = worldToIndexFloat(geom, world);
  return [Math.round(f[0]), Math.round(f[1]), Math.round(f[2])];
}

function colMajor(dims: Vec3, i: number, j: number, k: number): number {
  return i + j * dims[0] + k * dims[0] * dims[1];
}

function inBounds(dims: Vec3, i: number, j: number, k: number): boolean {
  return i >= 0 && i < dims[0] && j >= 0 && j < dims[1] && k >= 0 && k < dims[2];
}

export function copyVoxelRegion(
  source: { geometry: VoxelGridGeometry; data: ArrayLike<number> },
  segmentIndex: number,
): VoxelRegionClip | null {
  const dims = source.geometry.dimensions;
  let minI = Infinity, minJ = Infinity, minK = Infinity;
  let maxI = -Infinity, maxJ = -Infinity, maxK = -Infinity;
  let found = false;

  for (let k = 0; k < dims[2]; k++) {
    for (let j = 0; j < dims[1]; j++) {
      for (let i = 0; i < dims[0]; i++) {
        if (source.data[colMajor(dims, i, j, k)] === segmentIndex) {
          found = true;
          if (i < minI) minI = i;
          if (j < minJ) minJ = j;
          if (k < minK) minK = k;
          if (i > maxI) maxI = i;
          if (j > maxJ) maxJ = j;
          if (k > maxK) maxK = k;
        }
      }
    }
  }
  if (!found) return null;

  const subDims: Vec3 = [maxI - minI + 1, maxJ - minJ + 1, maxK - minK + 1];
  const subData = new Uint8Array(subDims[0] * subDims[1] * subDims[2]);
  for (let k = minK; k <= maxK; k++) {
    for (let j = minJ; j <= maxJ; j++) {
      for (let i = minI; i <= maxI; i++) {
        if (source.data[colMajor(dims, i, j, k)] === segmentIndex) {
          subData[colMajor(subDims, i - minI, j - minJ, k - minK)] = 1;
        }
      }
    }
  }

  return {
    geometry: {
      dimensions: subDims,
      spacing: [...source.geometry.spacing] as Vec3,
      origin: indexToWorld(source.geometry, [minI, minJ, minK]),
      direction: [...source.geometry.direction],
    },
    data: subData,
    sourceSegmentIndex: segmentIndex,
  };
}

export function pasteVoxelRegion(
  clip: VoxelRegionClip,
  target: { geometry: VoxelGridGeometry; data: Uint8Array | Int16Array | Uint16Array | Float32Array },
  opts: PasteOptions,
): PasteResult {
  const t: Vec3 = opts.translationWorld ?? [0, 0, 0];
  const tdims = target.geometry.dimensions;
  const cdims = clip.geometry.dimensions;

  // Detect clipping: does any painted source voxel land outside the target grid?
  let clipped = false;
  for (let k = 0; k < cdims[2] && !clipped; k++) {
    for (let j = 0; j < cdims[1] && !clipped; j++) {
      for (let i = 0; i < cdims[0] && !clipped; i++) {
        if (clip.data[colMajor(cdims, i, j, k)] !== 1) continue;
        const w = indexToWorld(clip.geometry, [i, j, k]);
        const ti = worldToIndex(target.geometry, [w[0] + t[0], w[1] + t[1], w[2] + t[2]]);
        if (!inBounds(tdims, ti[0], ti[1], ti[2])) clipped = true;
      }
    }
  }

  // Candidate target box = the clip's world AABB (8 corners + translation) → target
  // indices, expanded by 1 and clamped. Target-driven NN sampling fills densely.
  let lo: Vec3 = [Infinity, Infinity, Infinity];
  let hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let c = 0; c < 8; c++) {
    const ci: Vec3 = [
      c & 1 ? cdims[0] - 1 : 0,
      c & 2 ? cdims[1] - 1 : 0,
      c & 4 ? cdims[2] - 1 : 0,
    ];
    const w = indexToWorld(clip.geometry, ci);
    const f = worldToIndexFloat(target.geometry, [w[0] + t[0], w[1] + t[1], w[2] + t[2]]);
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], f[a]);
      hi[a] = Math.max(hi[a], f[a]);
    }
  }
  const i0 = Math.max(0, Math.floor(lo[0]) - 1), i1 = Math.min(tdims[0] - 1, Math.ceil(hi[0]) + 1);
  const j0 = Math.max(0, Math.floor(lo[1]) - 1), j1 = Math.min(tdims[1] - 1, Math.ceil(hi[1]) + 1);
  const k0 = Math.max(0, Math.floor(lo[2]) - 1), k1 = Math.min(tdims[2] - 1, Math.ceil(hi[2]) + 1);

  let written = 0;
  for (let k = k0; k <= k1; k++) {
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const w = indexToWorld(target.geometry, [i, j, k]);
        const ci = worldToIndex(clip.geometry, [w[0] - t[0], w[1] - t[1], w[2] - t[2]]);
        if (!inBounds(cdims, ci[0], ci[1], ci[2])) continue;
        if (clip.data[colMajor(cdims, ci[0], ci[1], ci[2])] !== 1) continue;

        const ti = colMajor(tdims, i, j, k);
        const write = (v: number) => {
          if (opts.writeTarget) opts.writeTarget(ti, v);
          else (target.data as { [k: number]: number })[ti] = v;
        };
        if (opts.subtract) {
          if (target.data[ti] === opts.targetSegmentIndex) {
            write(0);
            written++;
          }
        } else {
          // additive + overwrite both paint the active member at painted voxels (C6).
          write(opts.targetSegmentIndex);
          written++;
        }
      }
    }
  }

  return { written, clipped };
}
