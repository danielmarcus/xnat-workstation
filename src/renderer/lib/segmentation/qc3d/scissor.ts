/**
 * The 3D scissor (SegWorks #256; branch 7 Q4): a lasso drawn on the 3D view cuts through
 * the whole volume along the view direction. Under parallel projection a voxel's canvas
 * position is affine in its index — c = c0 + i·ci + j·cj + k·ck — so four projected points
 * give every voxel's, with no per-voxel camera math.
 */
import type { Dims } from './components';

export interface IndexToCanvas {
  c0: [number, number];
  ci: [number, number];
  cj: [number, number];
  ck: [number, number];
}

/** Even–odd point-in-polygon. */
export function insidePolygon(x: number, y: number, poly: ReadonlyArray<readonly [number, number]>): boolean {
  let inside = false;
  for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
    const [xa, ya] = poly[a], [xb, yb] = poly[b];
    if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside;
  }
  return inside;
}

/**
 * The member voxels the cut removes: those whose projection falls inside the lasso
 * ('inside') or outside it ('outside' — keep only what is inside). Returns a mask.
 */
export function scissorCut(
  mask: ArrayLike<number>, dims: Dims, proj: IndexToCanvas,
  lasso: ReadonlyArray<readonly [number, number]>, remove: 'inside' | 'outside',
): Uint8Array {
  const [nx, ny, nz] = dims;
  const out = new Uint8Array(nx * ny * nz);
  if (lasso.length < 3) return out;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of lasso) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const { c0, ci, cj, ck } = proj;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) {
    const bx = c0[0] + j * cj[0] + k * ck[0], by = c0[1] + j * cj[1] + k * ck[1];
    const row = nx * (j + ny * k);
    for (let i = 0; i < nx; i++) {
      if (!mask[row + i]) continue;
      const x = bx + i * ci[0], y = by + i * ci[1];
      const inBox = x >= x0 && x <= x1 && y >= y0 && y <= y1;
      const inside = inBox && insidePolygon(x, y, lasso);
      if (inside === (remove === 'inside')) out[row + i] = 1;
    }
  }
  return out;
}
