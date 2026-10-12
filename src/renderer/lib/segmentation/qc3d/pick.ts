/**
 * Picking a component in the 3D QC view (SegWorks #234): the nearest mesh a ray hits
 * (Möller–Trumbore), with a bounding-box test first so a miss costs little.
 */
export interface PickTarget {
  key: string;
  positions: Float32Array;
  indices: Uint32Array;
}

export function pickNearest(targets: PickTarget[], origin: number[], dir: number[]): { key: string; t: number } | null {
  let best: { key: string; t: number } | null = null;
  for (const m of targets) {
    if (!rayHitsBox(m.positions, origin, dir)) continue;
    const P = m.positions, I = m.indices;
    for (let k = 0; k < I.length; k += 3) {
      const t = rayTriangle(P, I[k] * 3, I[k + 1] * 3, I[k + 2] * 3, origin, dir);
      if (t !== null && t > 0 && (!best || t < best.t)) best = { key: m.key, t };
    }
  }
  return best;
}

function rayTriangle(P: Float32Array, a: number, b: number, c: number, o: number[], d: number[]): number | null {
  const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]];
  const e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
  const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
  const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  const s = [o[0] - P[a], o[1] - P[a + 1], o[2] - P[a + 2]];
  const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) * inv;
  if (u < 0 || u > 1) return null;
  const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
  const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) * inv;
  if (v < 0 || u + v > 1) return null;
  return (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv;
}

function rayHitsBox(P: Float32Array, o: number[], d: number[]): boolean {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < P.length; v += 3) for (let a = 0; a < 3; a++) {
    if (P[v + a] < lo[a]) lo[a] = P[v + a];
    if (P[v + a] > hi[a]) hi[a] = P[v + a];
  }
  let tmin = -Infinity, tmax = Infinity;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-12) {
      if (o[a] < lo[a] || o[a] > hi[a]) return false;
      continue;
    }
    const t1 = (lo[a] - o[a]) / d[a], t2 = (hi[a] - o[a]) / d[a];
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
  }
  return tmax >= Math.max(0, tmin);
}
