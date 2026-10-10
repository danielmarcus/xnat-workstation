/**
 * Random Walker segmentation (Grady 2006, "Random walks for image segmentation", IEEE TPAMI
 * 28(11)) — SegWorks parity #63–71, branch 4.
 *
 * Pixels are nodes of an 8-connected graph; an edge's weight is exp(−β·z²), z the intensity
 * difference standardised by the ROI's standard deviation (so β is unitless), with diagonals
 * scaled by 1/√2 to keep the metric Euclidean. Foreground seeds are fixed at 1, background
 * seeds at 0; the probability that a walker from each unseeded pixel reaches a foreground
 * seed first solves the combinatorial Dirichlet problem L_U x = −B x_M, here by
 * Jacobi-preconditioned conjugate gradient. The solve stops early once thresholding at 0.5
 * stops changing (label-flip termination). Pixels above 0.5 are foreground.
 *
 * Pure: works on a plane of intensities with seed masks; the caller crops to an ROI.
 */

export interface RandomWalkerInput {
  width: number;
  height: number;
  image: ArrayLike<number>;
  /** 1 = foreground seed. */
  fg: ArrayLike<number>;
  /** 1 = background seed. */
  bg: ArrayLike<number>;
  /** Edge sensitivity (unitless; Grady's β). Higher = edges block more. */
  beta: number;
  maxIterations?: number;
}

export interface RandomWalkerResult {
  /** Foreground probability per pixel (seeds included: 1 / 0). */
  probability: Float32Array;
  mask: Uint8Array;
  iterations: number;
}

const NB: Array<[number, number, number]> = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT1_2], [-1, 1, Math.SQRT1_2], [1, -1, Math.SQRT1_2], [-1, -1, Math.SQRT1_2],
];

export function randomWalker(inp: RandomWalkerInput): RandomWalkerResult {
  const { width: w, height: h, image, fg, bg } = inp;
  const n = w * h;
  // Standardise intensities so β means the same thing in any ROI.
  let sum = 0, sumSq = 0;
  for (let i = 0; i < n; i++) { sum += image[i]; sumSq += image[i] * image[i]; }
  const mean = sum / n;
  const sigma = Math.sqrt(Math.max(1e-9, sumSq / n - mean * mean)) || 1;
  const weight = (a: number, b: number, scale: number) => {
    const z = (image[a] - image[b]) / sigma;
    return Math.exp(-inp.beta * z * z) * scale;
  };

  // Index the unseeded nodes.
  const seeded = new Int8Array(n); // 1 fg, -1 bg, 0 free
  for (let i = 0; i < n; i++) seeded[i] = fg[i] ? 1 : bg[i] ? -1 : 0;
  const map = new Int32Array(n).fill(-1);
  const nodes: number[] = [];
  for (let i = 0; i < n; i++) if (!seeded[i]) { map[i] = nodes.length; nodes.push(i); }
  const m = nodes.length;

  // Sparse Laplacian over free nodes (CSR without the diagonal), the diagonal, and the RHS.
  const diag = new Float64Array(m);
  const rhs = new Float64Array(m);
  const rowStart = new Int32Array(m + 1);
  const cols: number[] = [];
  const vals: number[] = [];
  for (let u = 0; u < m; u++) {
    rowStart[u] = cols.length;
    const p = nodes[u];
    const x = p % w;
    const y = (p - x) / w;
    for (const [dx, dy, scale] of NB) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const q = nx + ny * w;
      const wt = weight(p, q, scale);
      diag[u] += wt;
      if (seeded[q] === 1) rhs[u] += wt; // fixed at probability 1
      else if (!seeded[q]) { cols.push(map[q]); vals.push(wt); }
    }
  }
  rowStart[m] = cols.length;
  const mul = (v: Float64Array, out: Float64Array) => {
    for (let u = 0; u < m; u++) {
      let s = diag[u] * v[u];
      for (let k = rowStart[u]; k < rowStart[u + 1]; k++) s -= vals[k] * v[cols[k]];
      out[u] = s;
    }
  };

  // Jacobi-preconditioned CG on L x = rhs.
  const x = new Float64Array(m).fill(0.5);
  const r = new Float64Array(m);
  const z = new Float64Array(m);
  const d = new Float64Array(m);
  const q = new Float64Array(m);
  mul(x, q);
  for (let u = 0; u < m; u++) { r[u] = rhs[u] - q[u]; z[u] = r[u] / (diag[u] || 1); d[u] = z[u]; }
  let rz = 0;
  for (let u = 0; u < m; u++) rz += r[u] * z[u];
  const maxIt = inp.maxIterations ?? Math.max(200, 4 * Math.ceil(Math.sqrt(m)) * 10);
  let it = 0;
  let lastLabels: Uint8Array | null = null;
  for (; it < maxIt && m > 0; it++) {
    mul(d, q);
    let dq = 0;
    for (let u = 0; u < m; u++) dq += d[u] * q[u];
    if (dq <= 0) break;
    const a = rz / dq;
    let rr = 0;
    for (let u = 0; u < m; u++) { x[u] += a * d[u]; r[u] -= a * q[u]; rr += r[u] * r[u]; }
    if (rr < 1e-12) break;
    for (let u = 0; u < m; u++) z[u] = r[u] / (diag[u] || 1);
    let rzNew = 0;
    for (let u = 0; u < m; u++) rzNew += r[u] * z[u];
    const bta = rzNew / rz;
    rz = rzNew;
    for (let u = 0; u < m; u++) d[u] = z[u] + bta * d[u];
    // Label-flip termination: every 10 iterations, stop once < 0.1% of labels change.
    if (it % 10 === 9) {
      const labels = Uint8Array.from(x, (v) => (v > 0.5 ? 1 : 0));
      if (lastLabels) {
        let flips = 0;
        for (let u = 0; u < m; u++) if (labels[u] !== lastLabels[u]) flips++;
        if (flips <= m * 0.001) break;
      }
      lastLabels = labels;
    }
  }

  const probability = new Float32Array(n);
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    // The exact solution lies in [0, 1] (maximum principle); stopping CG early on label
    // flips can leave tiny excursions, so clamp.
    const raw = seeded[i] === 1 ? 1 : seeded[i] === -1 ? 0 : x[map[i]];
    const v = raw < 0 ? 0 : raw > 1 ? 1 : raw;
    probability[i] = v;
    if (v > 0.5) mask[i] = 1;
  }
  return { probability, mask, iterations: it };
}
