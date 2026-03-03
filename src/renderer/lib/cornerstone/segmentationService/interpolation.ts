/**
 * Pure interpolation helpers used by segmentationService.
 * Kept separate from Cornerstone state so this logic is easy to test in isolation.
 */

export function hasSegmentPixelsOnSlice(
  scalarData: ArrayLike<number>,
  segmentIndex: number,
): boolean {
  for (let i = 0; i < scalarData.length; i++) {
    if (Number(scalarData[i]) === segmentIndex) return true;
  }
  return false;
}

/**
 * 1-D squared-Euclidean distance transform (Felzenszwalb–Huttenlocher).
 * Operates in-place on `f` which contains 0 for mask pixels and +Inf for
 * non-mask pixels. On output `f[i]` = squared Euclidean distance to the
 * nearest mask pixel along this 1-D scanline.
 */
function edt1d(f: Float64Array, n: number): void {
  const v = new Int32Array(n); // locations of parabolas in lower envelope
  const z = new Float64Array(n + 1); // boundaries between parabolas
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;

  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }

  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    f[q] = dq * dq + f[v[k]];
  }
}

/**
 * Exact 2-D Euclidean distance transform using separable 1-D transforms.
 */
function euclideanDistanceToMask(
  mask: Uint8Array,
  width: number,
  height: number,
): Float32Array {
  const INF = 1e20;
  const size = width * height;

  const grid = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    grid[i] = mask[i] ? 0 : INF;
  }

  const col = new Float64Array(height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) col[y] = grid[y * width + x];
    edt1d(col, height);
    for (let y = 0; y < height; y++) grid[y * width + x] = col[y];
  }

  const row = new Float64Array(width);
  for (let y = 0; y < height; y++) {
    const off = y * width;
    for (let x = 0; x < width; x++) row[x] = grid[off + x];
    edt1d(row, width);
    for (let x = 0; x < width; x++) grid[off + x] = row[x];
  }

  const result = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    result[i] = Math.sqrt(grid[i]);
  }
  return result;
}

function buildSignedDistanceForSegment(
  scalarData: ArrayLike<number>,
  width: number,
  height: number,
  segmentIndex: number,
): Float32Array {
  const size = width * height;
  const inside = new Uint8Array(size);
  const outside = new Uint8Array(size);

  for (let i = 0; i < size; i++) {
    const isInside = Number(scalarData[i]) === segmentIndex;
    inside[i] = isInside ? 1 : 0;
    outside[i] = isInside ? 0 : 1;
  }

  const distToInside = euclideanDistanceToMask(inside, width, height);
  const distToOutside = euclideanDistanceToMask(outside, width, height);
  const signed = new Float32Array(size);

  for (let i = 0; i < size; i++) {
    signed[i] = inside[i] ? -distToOutside[i] : distToInside[i];
  }

  return signed;
}

function buildInsideDistanceField(
  scalarData: ArrayLike<number>,
  width: number,
  height: number,
  segmentIndex: number,
): Float32Array {
  const size = width * height;
  const outside = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    outside[i] = Number(scalarData[i]) === segmentIndex ? 0 : 1;
  }
  return euclideanDistanceToMask(outside, width, height);
}

export function interpolateMorphological(
  sliceA: ArrayLike<number>,
  sliceB: ArrayLike<number>,
  alpha: number,
  width: number,
  height: number,
  segIdx: number,
): Uint8Array {
  const size = width * height;
  const insideDistA = buildInsideDistanceField(sliceA, width, height, segIdx);
  const insideDistB = buildInsideDistanceField(sliceB, width, height, segIdx);
  const result = new Uint8Array(size);
  for (let p = 0; p < size; p++) {
    const blended = (1 - alpha) * insideDistA[p] + alpha * insideDistB[p];
    if (blended > 0) {
      result[p] = segIdx;
    }
  }
  return result;
}

export function interpolateNearestSlice(
  sliceA: ArrayLike<number>,
  sliceB: ArrayLike<number>,
  alpha: number,
  width: number,
  height: number,
  segIdx: number,
): Uint8Array {
  const size = width * height;
  const source = alpha < 0.5 ? sliceA : sliceB;
  const result = new Uint8Array(size);
  for (let p = 0; p < size; p++) {
    if (Number(source[p]) === segIdx) {
      result[p] = segIdx;
    }
  }
  return result;
}

export function interpolateLinearBlend(
  sliceA: ArrayLike<number>,
  sliceB: ArrayLike<number>,
  alpha: number,
  width: number,
  height: number,
  segIdx: number,
  threshold: number,
): Uint8Array {
  const size = width * height;
  const result = new Uint8Array(size);
  for (let p = 0; p < size; p++) {
    const valA = Number(sliceA[p]) === segIdx ? 1 : 0;
    const valB = Number(sliceB[p]) === segIdx ? 1 : 0;
    const blend = (1 - alpha) * valA + alpha * valB;
    if (blend >= threshold) {
      result[p] = segIdx;
    }
  }
  return result;
}

export function interpolateSDF(
  sliceA: ArrayLike<number>,
  sliceB: ArrayLike<number>,
  alpha: number,
  width: number,
  height: number,
  segIdx: number,
): Uint8Array {
  const size = width * height;
  const signedA = buildSignedDistanceForSegment(sliceA, width, height, segIdx);
  const signedB = buildSignedDistanceForSegment(sliceB, width, height, segIdx);
  const result = new Uint8Array(size);
  for (let p = 0; p < size; p++) {
    const dist = (1 - alpha) * signedA[p] + alpha * signedB[p];
    if (dist <= 0) {
      result[p] = segIdx;
    }
  }
  return result;
}
