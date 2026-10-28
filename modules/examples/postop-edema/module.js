// Post-op edema — a SegWorks add-on re-authored against Workstation's module API 1.0.
//
// SegWorks' version (segworks_autoseg_postop_edema.js, v2.0.610) drew a zone on the image, read
// pixels from OHIF and wrote OHIF's labelmap itself. Here the host does all of that — the ROI
// limit is the zone, the box is the image, and the result is a mask the host previews — so
// what remains is the algorithm, per slice (x fastest, rows of nx):
//
//   1. On the slice on screen (the anchor): the zone (the ROI limit) and a background ring
//      around it; a 5×5 Gaussian; intensities normalised on zone + ring (z-scores, ±4); a Sobel
//      gradient; k-means → GMM seeds over [intensity, gradient]; region growing from the seeds
//      inside the zone within intensity bands from the zone's quantiles, below a gradient
//      limit; closing, the largest island, optional clean-up. Edema is the bright class
//      (FLAIR-high); the cavity is the dark region the edema encloses, kept only when sized
//      like one.
//   2. Outward, slice by slice (up to "Slices each way"): the same bands, grown inside a
//      corridor around the previous slice's edema, kept while the region stays continuous
//      (overlap, area ratio, drift).
//
// Result: label 1 = Edema, 2 = Cavity (the manifest's newMembers, in order).
//
// Two defects of the original are fixed: the seed step was called without the gradient map
// (the zone mask was passed in its place, and the target class in the zone's), and it returned
// an undefined variable — so the original's Analyze threw before any preview. And its cavity
// was the zone's darkest class grown in a quantile band, which on a zone of edema and normal
// brain picks normal brain; the original describes the cavity as the "lower-signal inner
// component", so here it is that: the dark hole inside the edema.

export async function run(input, api) {
  const { dims, image, params, roi, currentSlice } = input;
  const [cols, rows, nz] = dims;
  const n = rows * cols;
  if (!roi) throw new Error('Draw an ROI limit around the post-op region first');
  if (currentSlice < 0 || currentSlice >= nz) throw new Error('The slice on screen is outside the chosen range');

  const zone = new Uint8Array(n);
  for (let y = Math.max(0, roi.y0); y <= Math.min(rows - 1, roi.y1); y++) {
    for (let x = Math.max(0, roi.x0); x <= Math.min(cols - 1, roi.x1); x++) zone[y * cols + x] = 1;
  }
  const zoneArea = count(zone);
  if (zoneArea < 20) throw new Error('The ROI limit is too small');
  const slice = (z) => image.subarray(z * n, (z + 1) * n);
  const dimsOf = { rows, cols, n };

  // 1. The anchor slice.
  const a = analyzeAnchor(slice(currentSlice), zone, dimsOf, params);
  api.log(`Anchor slice ${currentSlice + 1}: edema ${a.edemaArea} px${a.cavityPresent ? `, cavity ${a.cavityArea} px` : ', no stable cavity'}`);
  api.log(`Bands (z-scores): edema ${a.stats.edemaLo.toFixed(2)}…${a.stats.edemaHi.toFixed(2)}, cavity ≤ ${a.stats.cavityHi.toFixed(2)}, gradient ≤ ${a.stats.gradLimit.toFixed(2)}`);
  if (!a.edemaArea) throw new Error('No edema found in the ROI limit on this slice');

  const mask = new Uint8Array(image.length);
  const write = (z, edema, cavity) => {
    const off = z * n;
    for (let i = 0; i < n; i++) {
      if (params.cavity && a.cavityPresent && cavity[i]) mask[off + i] = 2;
      else if (edema[i]) mask[off + i] = 1;
    }
  };
  write(currentSlice, a.edema, a.cavity);

  // 2. Outward.
  const reach = Math.max(0, Math.round(params.reach));
  let done = 0;
  const total = 2 * reach || 1;
  for (const dir of [-1, 1]) {
    let prev = a.edema;
    for (let step = 1; step <= reach; step++) {
      if (api.cancelled()) return { mask: new Uint8Array(image.length) };
      const z = currentSlice + dir * step;
      if (z < 0 || z >= nz) break;
      const corridor = dilate(prev, rows, cols, step < 6 ? 6 : 4);
      const next = thresholdInsideCorridor(slice(z), corridor, dimsOf, a.stats, params.polish);
      if (!count(next.edema) || !continuityOk(prev, next.edema, rows, cols)) { api.log(`Stopped ${dir < 0 ? 'below' : 'above'} at slice ${z + 1}: the region is not continuous`); break; }
      write(z, next.edema, next.cavity);
      prev = next.edema;
      api.progress(++done / total);
    }
  }
  api.progress(1);
  return { mask };
}

function analyzeAnchor(px, zoneMask, { rows, cols, n }, params) {
  const bgRing = ringFromMask(zoneMask, rows, cols, 2, 7);
  const denoised = denoise5x5(px, rows, cols);
  const normPx = normalizeLocal(denoised, zoneMask, bgRing);
  const gradPx = sobelGradient(normPx, rows, cols);

  const zoneVals = collectVals(normPx, zoneMask);
  const bgVals = collectVals(normPx, bgRing);
  const mu = mean(zoneVals), sd = stdev(zoneVals, mu);
  const q35 = q(zoneVals, 0.35), q50 = q(zoneVals, 0.50), q65 = q(zoneVals, 0.65), q80 = q(zoneVals, 0.80);
  const bgMu = mean(bgVals), bgSd = stdev(bgVals, bgMu);
  const edemaSeeds = seedMaskFromCluster(normPx, gradPx, zoneMask, 'midhigh');
  const gradLimit = q(collectVals(gradPx, zoneMask), 0.75) || 1.5;
  const stats = {
    gradLimit,
    edemaLo: Math.max(q50 - 0.15, mu - 0.10 * sd, bgMu + 0.05 * bgSd),
    edemaHi: Math.max(q80 + 0.35, q65 + 0.25),
    cavityHi: Math.min(q35 + 0.10, q50 - 0.05),
  };
  const zoneArea = count(zoneMask);

  let edema = constrainedRegionGrow(edemaSeeds, normPx, gradPx, zoneMask, rows, cols, stats.edemaLo, stats.edemaHi, gradLimit);
  edema = largestConnected(closeMask(edema, rows, cols, 1), rows, cols, zoneMask);
  if (count(edema) < Math.max(10, zoneArea * 0.02)) {
    const fallback = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (zoneMask[i] && normPx[i] >= q50) fallback[i] = 1;
    edema = constrainedRegionGrow(fallback, normPx, gradPx, zoneMask, rows, cols, q50 - 0.20, stats.edemaHi, gradLimit * 1.1);
    edema = largestConnected(closeMask(edema, rows, cols, 1), rows, cols, zoneMask);
  }
  if (params.polish) edema = minimalPolish(edema, rows, cols, zoneMask);
  let cavity = innerCavity(edema, normPx, zoneMask, rows, cols, stats.cavityHi);

  // The cavity is optional: kept only when reasonably sized and inside (or by) the edema's box.
  const edemaBox = bboxFromMask(edema, rows, cols);
  const cavBox = bboxFromMask(cavity, rows, cols);
  let cavityPresent = false;
  if (cavBox && edemaBox) {
    const cx = (cavBox.x1 + cavBox.x2) / 2, cy = (cavBox.y1 + cavBox.y2) / 2;
    const inside = cx >= edemaBox.x1 - 4 && cx <= edemaBox.x2 + 4 && cy >= edemaBox.y1 - 4 && cy <= edemaBox.y2 + 4;
    cavityPresent = cavBox.area >= Math.max(8, zoneArea * 0.01) && cavBox.area <= Math.max(50, zoneArea * 0.45) && inside;
  }
  if (!cavityPresent) cavity = new Uint8Array(n);
  return { edema, cavity, cavityPresent, edemaArea: count(edema), cavityArea: count(cavity), stats };
}

function thresholdInsideCorridor(px, allow, { rows, cols, n }, stats, polish) {
  const bgRing = ringFromMask(allow, rows, cols, 1, 4);
  const normPx = normalizeLocal(denoise5x5(px, rows, cols), allow, bgRing);
  const gradPx = sobelGradient(normPx, rows, cols);
  const gradLimit = Math.max(stats.gradLimit || 1.2, q(collectVals(gradPx, allow), 0.80) || 1.2);
  const edemaSeed = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (allow[i] && normPx[i] >= stats.edemaLo) edemaSeed[i] = 1;
  let edema = constrainedRegionGrow(edemaSeed, normPx, gradPx, allow, rows, cols, stats.edemaLo, stats.edemaHi, gradLimit);
  edema = largestConnected(closeMask(edema, rows, cols, 1), rows, cols, allow);
  if (polish) edema = minimalPolish(edema, rows, cols, allow);
  return { edema, cavity: innerCavity(edema, normPx, allow, rows, cols, stats.cavityHi) };
}

/**
 * The cavity: the largest dark region the edema encloses — pixels not in the edema, not
 * reachable from the zone's edge without crossing it, below the cavity band's top.
 */
function innerCavity(edema, normPx, allow, rows, cols, hi) {
  const n = rows * cols, outside = new Uint8Array(n), queue = new Int32Array(n);
  let t = 0;
  for (let i = 0; i < n; i++) {
    if (edema[i]) continue;
    const y = (i / cols) | 0, x = i - y * cols;
    const edge = !allow[i] || x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
    if (edge) { outside[i] = 1; queue[t++] = i; }
  }
  for (let h = 0; h < t; h++) {
    for (const ni of neighbours(queue[h], rows, cols, n)) if (!outside[ni] && !edema[ni]) { outside[ni] = 1; queue[t++] = ni; }
  }
  const holes = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (!edema[i] && !outside[i] && normPx[i] <= hi) holes[i] = 1;
  return largestConnected(holes, rows, cols, allow);
}

function continuityOk(prev, next, rows, cols) {
  const cp = centroid(prev, rows, cols), cn = centroid(next, rows, cols);
  const ratio = cp && cp.n ? (cn ? cn.n : 0) / cp.n : 0;
  const drift = cp && cn ? Math.hypot(cp.x - cn.x, cp.y - cn.y) : Infinity;
  return overlap(prev, next) >= 0.30 && ratio >= 0.35 && ratio <= 2.2 && drift <= 26;
}

// ─── Statistics ──────────────────────────────────────────────────────────────

function count(m) { let c = 0; for (let i = 0; i < m.length; i++) if (m[i]) c++; return c; }
function q(arr, p) {
  if (!arr.length) return 0;
  const a = Float64Array.from(arr).sort();
  return a[Math.max(0, Math.min(a.length - 1, Math.floor((a.length - 1) * p)))];
}
function mean(arr) { if (!arr.length) return 0; let s = 0; for (const v of arr) s += v; return s / arr.length; }
function stdev(arr, mu) { if (!arr.length) return 0; let s = 0; for (const v of arr) s += (v - mu) ** 2; return Math.sqrt(s / arr.length); }
function collectVals(px, mask) { const out = []; for (let i = 0; i < mask.length; i++) if (mask[i]) out.push(px[i]); return out; }

function normalizeLocal(px, zoneMask, bgMask) {
  const vals = [];
  for (let i = 0; i < px.length; i++) if (zoneMask[i] || bgMask[i]) vals.push(px[i]);
  const mu = mean(vals), sd = Math.max(1e-6, stdev(vals, mu));
  const out = new Float32Array(px.length);
  for (let i = 0; i < px.length; i++) out[i] = Math.max(-4, Math.min(4, (px[i] - mu) / sd));
  return out;
}

// ─── Filters ─────────────────────────────────────────────────────────────────

const GAUSS5 = [1, 4, 6, 4, 1, 4, 16, 24, 16, 4, 6, 24, 36, 24, 6, 4, 16, 24, 16, 4, 1, 4, 6, 4, 1];
function denoise5x5(px, rows, cols) {
  const out = new Float32Array(px.length);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    let s = 0;
    for (let dy = -2; dy <= 2; dy++) {
      const off = Math.max(0, Math.min(rows - 1, y + dy)) * cols;
      for (let dx = -2; dx <= 2; dx++) s += px[off + Math.max(0, Math.min(cols - 1, x + dx))] * GAUSS5[(dy + 2) * 5 + dx + 2];
    }
    out[y * cols + x] = s / 256;
  }
  return out;
}

function sobelGradient(px, rows, cols) {
  const out = new Float32Array(px.length);
  for (let y = 1; y < rows - 1; y++) for (let x = 1; x < cols - 1; x++) {
    const i = y * cols + x;
    const tl = px[i - cols - 1], tc = px[i - cols], tr = px[i - cols + 1], ml = px[i - 1], mr = px[i + 1];
    const bl = px[i + cols - 1], bc = px[i + cols], br = px[i + cols + 1];
    out[i] = Math.hypot(-tl + tr - 2 * ml + 2 * mr - bl + br, tl + 2 * tc + tr - bl - 2 * bc - br);
  }
  return out;
}

// ─── Seeds: k-means, refined by a diagonal GMM, over [intensity, 0.35 · gradient / max] ──

function seedMaskFromCluster(normPx, gradPx, zoneMask, targetMode) {
  const features = [], idxs = [];
  let gradMax = 1e-6;
  for (let i = 0; i < normPx.length; i++) if (zoneMask[i]) gradMax = Math.max(gradMax, gradPx[i]);
  for (let i = 0; i < normPx.length; i++) {
    if (!zoneMask[i]) continue;
    features.push({ i: normPx[i], g: 0.35 * (gradPx[i] / gradMax) });
    idxs.push(i);
  }
  const out = new Uint8Array(normPx.length);
  if (!features.length) return out;
  const gm = gmm2d(features, kmeans2d(features, 3), 10);
  const order = gm.means.map((m, idx) => ({ idx, i: m.i, g: m.g })).sort((a, b) => a.i - b.i || a.g - b.g);
  const low = order[0].idx, mid = order[1]?.idx ?? low, high = order[2]?.idx ?? mid;
  for (let j = 0; j < idxs.length; j++) {
    const lab = gm.labels[j], g = features[j].g;
    const keep = targetMode === 'low' ? lab === low && g <= 1.35 : targetMode === 'high' ? lab === high && g <= 1.65 : (lab === mid || lab === high) && g <= 1.55;
    if (keep && gm.respMax[j] >= 0.52) out[idxs[j]] = 1;
  }
  return out;
}

function kmeans2d(features, k) {
  const valsI = features.map((f) => f.i), valsG = features.map((f) => f.g);
  const centers = [];
  for (let c = 1; c <= k; c++) centers.push({ i: q(valsI, c / (k + 1)), g: q(valsG, c / (k + 1)) });
  for (let it = 0; it < 10; it++) {
    const sumI = new Float64Array(k), sumG = new Float64Array(k), cnt = new Int32Array(k);
    for (const f of features) {
      let bi = 0, bd = Infinity;
      for (let c = 0; c < k; c++) { const d = (f.i - centers[c].i) ** 2 + (f.g - centers[c].g) ** 2; if (d < bd) { bd = d; bi = c; } }
      sumI[bi] += f.i; sumG[bi] += f.g; cnt[bi]++;
    }
    for (let c = 0; c < k; c++) if (cnt[c]) centers[c] = { i: sumI[c] / cnt[c], g: sumG[c] / cnt[c] };
  }
  return centers;
}

function gmm2d(features, init, maxIter) {
  const k = init.length, N = features.length;
  const mI = mean(features.map((f) => f.i)), mG = mean(features.map((f) => f.g));
  const sdI = Math.max(0.15, stdev(features.map((f) => f.i), mI)), sdG = Math.max(0.10, stdev(features.map((f) => f.g), mG));
  const means = init.map((c) => ({ i: c.i, g: c.g }));
  const vars = init.map(() => ({ i: Math.max(0.03, sdI * sdI), g: Math.max(0.02, sdG * sdG) }));
  const weights = new Float64Array(k).fill(1 / k);
  const labels = new Int16Array(N), resp = new Float64Array(N * k);
  for (let it = 0; it < maxIter; it++) {
    for (let j = 0; j < N; j++) {
      const f = features[j];
      let denom = 0;
      for (let c = 0; c < k; c++) {
        const vi = Math.max(0.005, vars[c].i), vg = Math.max(0.005, vars[c].g);
        const pdf = Math.exp(-0.5 * ((f.i - means[c].i) ** 2 / vi + (f.g - means[c].g) ** 2 / vg)) / (2 * Math.PI * Math.sqrt(vi * vg));
        const r = Math.max(1e-12, weights[c] * pdf);
        resp[j * k + c] = r; denom += r;
      }
      let bi = 0, br = -1;
      for (let c = 0; c < k; c++) { const r = resp[j * k + c] / denom; resp[j * k + c] = r; if (r > br) { br = r; bi = c; } }
      labels[j] = bi;
    }
    for (let c = 0; c < k; c++) {
      let sR = 0, sI = 0, sG = 0;
      for (let j = 0; j < N; j++) { const r = resp[j * k + c]; sR += r; sI += r * features[j].i; sG += r * features[j].g; }
      const mi = sR > 1e-8 ? sI / sR : means[c].i, mg = sR > 1e-8 ? sG / sR : means[c].g;
      let vI = 0, vG = 0;
      for (let j = 0; j < N; j++) { const r = resp[j * k + c]; vI += r * (features[j].i - mi) ** 2; vG += r * (features[j].g - mg) ** 2; }
      means[c] = { i: mi, g: mg };
      vars[c] = { i: Math.max(0.005, sR > 1e-8 ? vI / sR : vars[c].i), g: Math.max(0.005, sR > 1e-8 ? vG / sR : vars[c].g) };
      weights[c] = Math.max(1e-6, sR / N);
    }
    let ws = 0; for (let c = 0; c < k; c++) ws += weights[c];
    for (let c = 0; c < k; c++) weights[c] /= ws;
  }
  const respMax = new Float32Array(N);
  for (let j = 0; j < N; j++) respMax[j] = resp[j * k + labels[j]];
  return { means, labels, respMax };
}

// ─── Growing and morphology (4-connected; squares for dilate / erode) ───────

function neighbours(ci, rows, cols, n) {
  const y = (ci / cols) | 0, x = ci - y * cols;
  return [x > 0 ? ci - 1 : -1, x < cols - 1 ? ci + 1 : -1, y > 0 ? ci - cols : -1, y < rows - 1 ? ci + cols : -1].filter((v) => v >= 0 && v < n);
}

function constrainedRegionGrow(seed, normPx, gradPx, allow, rows, cols, lo, hi, gradLimit) {
  const n = rows * cols, out = new Uint8Array(n), seen = new Uint8Array(n), queue = new Int32Array(n);
  let h = 0, t = 0;
  for (let i = 0; i < n; i++) if (seed[i] && allow[i]) { queue[t++] = i; seen[i] = 1; out[i] = 1; }
  while (h < t) {
    for (const ni of neighbours(queue[h++], rows, cols, n)) {
      if (seen[ni] || !allow[ni]) continue;
      seen[ni] = 1;
      if (normPx[ni] >= lo && normPx[ni] <= hi && gradPx[ni] <= gradLimit) { out[ni] = 1; queue[t++] = ni; }
    }
  }
  return out;
}

function largestConnected(mask, rows, cols, allow) {
  const n = rows * cols, seen = new Uint8Array(n), queue = new Int32Array(n);
  let best = null;
  for (let i = 0; i < n; i++) {
    if (!mask[i] || seen[i] || (allow && !allow[i])) continue;
    let h = 0, t = 0;
    queue[t++] = i; seen[i] = 1;
    while (h < t) {
      for (const ni of neighbours(queue[h++], rows, cols, n)) {
        if (seen[ni] || !mask[ni] || (allow && !allow[ni])) continue;
        seen[ni] = 1; queue[t++] = ni;
      }
    }
    if (!best || t > best.length) best = queue.slice(0, t);
  }
  const out = new Uint8Array(n);
  if (best) for (const i of best) out[i] = 1;
  return out;
}

function dilate(mask, rows, cols, r) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    let on = 0;
    for (let yy = Math.max(0, y - r); yy <= Math.min(rows - 1, y + r) && !on; yy++) {
      for (let xx = Math.max(0, x - r); xx <= Math.min(cols - 1, x + r); xx++) if (mask[yy * cols + xx]) { on = 1; break; }
    }
    out[y * cols + x] = on;
  }
  return out;
}

function erode(mask, rows, cols, r) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    let on = y - r >= 0 && y + r < rows && x - r >= 0 && x + r < cols ? 1 : 0;
    for (let yy = y - r; yy <= y + r && on; yy++) for (let xx = x - r; xx <= x + r; xx++) if (!mask[yy * cols + xx]) { on = 0; break; }
    out[y * cols + x] = on;
  }
  return out;
}

function closeMask(mask, rows, cols, r) { return erode(dilate(mask, rows, cols, r), rows, cols, r); }

function minimalPolish(mask, rows, cols, allow) {
  const closed = closeMask(mask, rows, cols, 1);
  let opened = dilate(erode(closed, rows, cols, 1), rows, cols, 1);
  for (let i = 0; i < opened.length; i++) if (!allow[i]) opened[i] = 0;
  opened = largestConnected(opened, rows, cols, allow);
  const a0 = count(closed), a1 = count(opened);
  if (!a0) return opened;
  return a1 >= Math.max(8, a0 * 0.60) ? opened : largestConnected(closed, rows, cols, allow);
}

function ringFromMask(mask, rows, cols, innerR, outerR) {
  const outer = dilate(mask, rows, cols, outerR), inner = dilate(mask, rows, cols, innerR);
  return Uint8Array.from(outer, (v, i) => (v && !inner[i] ? 1 : 0));
}

function bboxFromMask(mask, rows, cols) {
  let x1 = cols, y1 = rows, x2 = -1, y2 = -1, area = 0;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (!mask[y * cols + x]) continue;
    area++;
    x1 = Math.min(x1, x); x2 = Math.max(x2, x); y1 = Math.min(y1, y); y2 = Math.max(y2, y);
  }
  return x2 < 0 ? null : { x1, y1, x2, y2, area };
}

function overlap(a, b) {
  let inter = 0, uni = 0;
  for (let i = 0; i < a.length; i++) { if (a[i] && b[i]) inter++; if (a[i] || b[i]) uni++; }
  return uni ? inter / uni : 0;
}

function centroid(mask, rows, cols) {
  let sx = 0, sy = 0, c = 0;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (mask[y * cols + x]) { sx += x; sy += y; c++; }
  return c ? { x: sx / c, y: sy / c, n: c } : null;
}
