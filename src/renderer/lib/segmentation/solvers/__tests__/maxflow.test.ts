/** Boykov–Kolmogorov max-flow and binary energy minimisation (branch 5, G1), against brute force. */
import { describe, expect, it } from 'vitest';
import { MaxFlowGraph } from '../maxflow';
import { BinaryEnergy } from '../energy';

/** Deterministic PRNG so failures reproduce. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Minimum s–t cut by enumerating every assignment (n ≤ 12). */
function bruteMinCut(n: number, edges: Array<[number, number, number, number]>, src: number[], snk: number[]): number {
  let best = Infinity;
  for (let mask = 0; mask < 1 << n; mask++) {
    // bit set = sink side
    let cut = 0;
    for (let i = 0; i < n; i++) cut += (mask >> i) & 1 ? src[i] : snk[i];
    for (const [i, j, c, r] of edges) {
      const si = (mask >> i) & 1, sj = (mask >> j) & 1;
      if (!si && sj) cut += c; // i source side, j sink side
      if (si && !sj) cut += r;
    }
    best = Math.min(best, cut);
  }
  return best;
}

describe('MaxFlowGraph (Boykov–Kolmogorov)', () => {
  it('equals the brute-force minimum cut on 300 random graphs, and its cut has that capacity', () => {
    const r = rng(7);
    for (let t = 0; t < 300; t++) {
      const n = 2 + Math.floor(r() * 9);
      const edges: Array<[number, number, number, number]> = [];
      const m = Math.floor(r() * n * 3);
      for (let k = 0; k < m; k++) {
        const i = Math.floor(r() * n), j = Math.floor(r() * n);
        if (i === j) continue;
        edges.push([i, j, Math.round(r() * 10), Math.round(r() * 10)]);
      }
      const src = Array.from({ length: n }, () => (r() < 0.4 ? Math.round(r() * 12) : 0));
      const snk = Array.from({ length: n }, () => (r() < 0.4 ? Math.round(r() * 12) : 0));
      const g = new MaxFlowGraph(n, edges.length);
      for (const [i, j, c, rc] of edges) g.addEdge(i, j, c, rc);
      for (let i = 0; i < n; i++) g.addTerminal(i, src[i], snk[i]);
      const flow = g.maxflow();
      const expected = bruteMinCut(n, edges, src, snk);
      expect(flow, `graph ${t}`).toBeCloseTo(expected, 9);
      // The cut the solver reports must have exactly that capacity.
      let cut = 0;
      for (let i = 0; i < n; i++) cut += g.inSink(i) ? src[i] : snk[i];
      for (const [i, j, c, rc] of edges) {
        if (!g.inSink(i) && g.inSink(j)) cut += c;
        if (g.inSink(i) && !g.inSink(j)) cut += rc;
      }
      expect(cut, `cut of graph ${t}`).toBeCloseTo(expected, 9);
    }
  });

  it('a long chain (deeper than any call stack would allow recursively) solves', () => {
    const n = 200_000;
    const g = new MaxFlowGraph(n, n - 1);
    for (let i = 0; i + 1 < n; i++) g.addEdge(i, i + 1, 5, 5);
    g.addTerminal(0, 3, 0);
    g.addTerminal(n - 1, 0, 3);
    expect(g.maxflow()).toBe(3);
  });

  it('refuses more edges than it was sized for', () => {
    const g = new MaxFlowGraph(2, 1);
    g.addEdge(0, 1, 1, 1);
    expect(() => g.addEdge(1, 0, 1, 1)).toThrow();
  });
});

describe('BinaryEnergy', () => {
  it('reaches the brute-force minimum of 300 random submodular energies (unary terms of either sign)', () => {
    const r = rng(11);
    for (let t = 0; t < 300; t++) {
      const n = 2 + Math.floor(r() * 8);
      const unary = Array.from({ length: n }, () => [r() * 20 - 10, r() * 20 - 10] as const);
      const pairs: Array<[number, number, number, number, number, number]> = [];
      for (let k = 0; k < n * 2; k++) {
        const p = Math.floor(r() * n), q = Math.floor(r() * n);
        if (p === q) continue;
        const a = r() * 5, d = r() * 5, b = r() * 5;
        const c = a + d - b + r() * 5; // b + c ≥ a + d
        pairs.push([p, q, a, b, c, d]);
      }
      const energy = (x: number[]) =>
        unary.reduce((s, u, p) => s + u[x[p]], 0) + pairs.reduce((s, [p, q, a, b, c, d]) => s + [[a, b], [c, d]][x[p]][x[q]], 0);
      let best = Infinity;
      for (let mask = 0; mask < 1 << n; mask++) best = Math.min(best, energy(Array.from({ length: n }, (_, i) => (mask >> i) & 1)));
      const e = new BinaryEnergy(n, pairs.length);
      unary.forEach(([e0, e1], p) => e.addUnary(p, e0, e1));
      for (const [p, q, a, b, c, d] of pairs) e.addPairwise(p, q, a, b, c, d);
      const res = e.minimize();
      expect(res.energy, `energy ${t}`).toBeCloseTo(best, 6);
      expect(energy([...res.labels]), `labels ${t}`).toBeCloseTo(best, 6);
    }
  });

  it('refuses a pairwise term that is not submodular', () => {
    const e = new BinaryEnergy(2, 1);
    expect(() => e.addPairwise(0, 1, 5, 0, 0, 5)).toThrow(/submodular/);
  });
});
