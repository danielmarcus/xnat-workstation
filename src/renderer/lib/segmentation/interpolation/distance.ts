/**
 * Distance transforms for shape-based interpolation (SegWorks parity branch 3 I1).
 *
 * Distances are in PIXELS of the plane. `exactEDT` is the separable squared-Euclidean
 * transform of Felzenszwalb & Huttenlocher (2012) — exact, O(n). `chamferDT` is the 3-4
 * chamfer approximation (Borgefors 1986) — faster, within ~8% of Euclidean.
 */

const INF = 1e20;

function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Euclidean distance from every pixel to the nearest pixel where `seed` is set. */
export function exactEDT(seed: ArrayLike<number>, width: number, height: number): Float32Array {
  const n = width * height;
  const g = new Float64Array(n);
  const m = Math.max(width, height);
  const f = new Float64Array(m);
  const d = new Float64Array(m);
  const v = new Int32Array(m);
  const z = new Float64Array(m + 1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = seed[x + y * width] ? 0 : INF;
    edt1d(f, width, d, v, z);
    for (let x = 0; x < width; x++) g[x + y * width] = d[x];
  }
  const out = new Float32Array(n);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = g[x + y * width];
    edt1d(f, height, d, v, z);
    for (let y = 0; y < height; y++) out[x + y * width] = Math.sqrt(d[y]);
  }
  return out;
}

/** 3-4 chamfer distance (in pixels) to the nearest set pixel. */
export function chamferDT(seed: ArrayLike<number>, width: number, height: number): Float32Array {
  const n = width * height;
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = seed[i] ? 0 : INF;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? INF : d[x + y * width]);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = x + y * width;
      d[i] = Math.min(d[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = x + y * width;
      d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
    }
  }
  for (let i = 0; i < n; i++) d[i] /= 3;
  return d;
}

export type DistanceMethod = 'exact' | 'chamfer';

/**
 * Signed distance: negative inside the mask (distance to the nearest outside pixel),
 * positive outside (distance to the nearest inside pixel). An empty mask is +∞-like
 * everywhere, so blending toward it shrinks the other shape to nothing.
 */
export function signedDistance(mask: ArrayLike<number>, width: number, height: number, method: DistanceMethod = 'exact'): Float32Array {
  const n = width * height;
  const inv = new Uint8Array(n);
  let any = false;
  for (let i = 0; i < n; i++) {
    inv[i] = mask[i] ? 0 : 1;
    if (mask[i]) any = true;
  }
  const dt = method === 'exact' ? exactEDT : chamferDT;
  const sdf = new Float32Array(n);
  if (!any) {
    sdf.fill(Math.max(width, height) * 2);
    return sdf;
  }
  const toInside = dt(mask, width, height);
  const toOutside = dt(inv, width, height);
  for (let i = 0; i < n; i++) sdf[i] = mask[i] ? -toOutside[i] : toInside[i];
  return sdf;
}
