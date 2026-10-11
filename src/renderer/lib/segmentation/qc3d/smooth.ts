/**
 * Taubin λ|μ smoothing (Taubin 1995, "A signal processing approach to fair surface design")
 * for the 3D QC surfaces (SegWorks #240): alternating a shrinking Laplacian step (λ > 0) and
 * an inflating one (μ < −λ) removes the voxel staircase without the shrinkage plain
 * Laplacian smoothing causes. Moves vertices only; the triangles are shared, not copied.
 */
import type { Mesh } from './mesh';

export function taubinSmooth(m: Mesh, o: { iterations: number; lambda?: number; mu?: number }): Mesh {
  const lambda = o.lambda ?? 0.5;
  const mu = o.mu ?? -0.53;
  const nv = m.positions.length / 3;
  // Vertex adjacency (CSR) from the triangle edges.
  const sets: Array<Set<number>> = Array.from({ length: nv }, () => new Set());
  for (let t = 0; t < m.indices.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = m.indices[t + e], b = m.indices[t + ((e + 1) % 3)];
      sets[a].add(b);
      sets[b].add(a);
    }
  }
  const start = new Int32Array(nv + 1);
  for (let v = 0; v < nv; v++) start[v + 1] = start[v] + sets[v].size;
  const nb = new Int32Array(start[nv]);
  for (let v = 0; v < nv; v++) { let k = start[v]; for (const w of sets[v]) nb[k++] = w; }

  let cur = Float32Array.from(m.positions);
  let nxt = new Float32Array(cur.length);
  const step = (f: number) => {
    for (let v = 0; v < nv; v++) {
      const n = start[v + 1] - start[v];
      for (let d = 0; d < 3; d++) {
        const x = cur[v * 3 + d];
        if (!n) { nxt[v * 3 + d] = x; continue; }
        let s = 0;
        for (let k = start[v]; k < start[v + 1]; k++) s += cur[nb[k] * 3 + d];
        nxt[v * 3 + d] = x + f * (s / n - x);
      }
    }
    [cur, nxt] = [nxt, cur];
  };
  for (let i = 0; i < o.iterations; i++) { step(lambda); step(mu); }
  return { positions: cur, indices: m.indices };
}
