/**
 * Binary energy minimisation by graph cut (branch 5, G1) — Kolmogorov & Zabih, "What energy
 * functions can be minimized via graph cuts?", PAMI 2004.
 *
 *   E(x) = Σ_p U_p(x_p) + Σ_(p,q) V_pq(x_p, x_q),  x ∈ {0, 1}
 *
 * with every pairwise term submodular: V(0,1) + V(1,0) ≥ V(0,0) + V(1,1). Binary Graph Cut
 * builds one directly; α-expansion builds one per move. Convention: x = 0 is the source side,
 * x = 1 the sink side.
 */
import { MaxFlowGraph } from './maxflow';

export class BinaryEnergy {
  private readonly graph: MaxFlowGraph;
  private constant = 0;

  constructor(nodeCount: number, maxPairs: number) {
    this.graph = new MaxFlowGraph(nodeCount, maxPairs);
  }

  /** U_p(0) = e0, U_p(1) = e1. */
  addUnary(p: number, e0: number, e1: number): void {
    // x_p = 1 (sink side) cuts source → p; x_p = 0 cuts p → sink.
    this.graph.addTerminal(p, e1, e0);
  }

  /** V(0,0) = a, V(0,1) = b, V(1,0) = c, V(1,1) = d — must be submodular. */
  addPairwise(p: number, q: number, a: number, b: number, c: number, d: number): void {
    // V = a + (c − a)·x_p + (d − c)·x_q + (b + c − a − d)·(1 − x_p)·x_q
    const w = b + c - a - d;
    if (w < -1e-9) throw new Error('BinaryEnergy: pairwise term is not submodular');
    this.constant += a;
    this.addUnary(p, 0, c - a);
    this.addUnary(q, 0, d - c);
    this.graph.addEdge(p, q, Math.max(0, w), 0);
  }

  /** Minimise; returns the minimum energy and each node's label. */
  minimize(): { energy: number; labels: Uint8Array } {
    const flow = this.graph.maxflow();
    const labels = new Uint8Array(this.graph.nodeCount);
    for (let p = 0; p < labels.length; p++) labels[p] = this.graph.inSink(p) ? 1 : 0;
    return { energy: flow + this.constant, labels };
  }
}
