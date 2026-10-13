/**
 * Boykov–Kolmogorov max-flow / min-cut (SegWorks parity branch 5, G1; docs/segworks-parity.md
 * §11) — the solver behind Graph Cut (#116) and α-expansion (#124).
 *
 * Y. Boykov, V. Kolmogorov, "An experimental comparison of min-cut/max-flow algorithms for
 * energy minimization in vision", PAMI 2004: two search trees grown from the terminals, paths
 * augmented where they meet, orphans re-adopted instead of the trees being rebuilt. It is the
 * standard for image grids (few long paths, many short ones). Iterative throughout — SegWorks'
 * Dinic recursed once per path step and overflowed the stack on large regions.
 *
 * Storage is typed arrays sized up front: arcs are added in pairs (an arc and its reverse,
 * `a ^ 1`), terminal capacities are one signed residual per node (> 0 to the source, < 0 to
 * the sink).
 */

const NONE = -1;
const TERMINAL = -2;
const ORPHAN = -3;
const INF_D = 0x3fffffff;

export class MaxFlowGraph {
  readonly nodeCount: number;
  private arcCount = 0;
  private flow = 0;
  // Nodes
  private readonly first: Int32Array;
  private readonly parent: Int32Array;
  private readonly trCap: Float64Array;
  private readonly isSink: Uint8Array;
  private readonly ts: Int32Array;
  private readonly dist: Int32Array;
  // Arcs
  private readonly head: Int32Array;
  private readonly nextArc: Int32Array;
  private readonly rCap: Float64Array;

  /** `maxEdges` counts edges (each one an arc pair). */
  constructor(nodeCount: number, maxEdges: number) {
    this.nodeCount = nodeCount;
    this.first = new Int32Array(nodeCount).fill(NONE);
    this.parent = new Int32Array(nodeCount).fill(NONE);
    this.trCap = new Float64Array(nodeCount);
    this.isSink = new Uint8Array(nodeCount);
    this.ts = new Int32Array(nodeCount);
    this.dist = new Int32Array(nodeCount);
    this.head = new Int32Array(2 * maxEdges);
    this.nextArc = new Int32Array(2 * maxEdges);
    this.rCap = new Float64Array(2 * maxEdges);
  }

  /** Edge i → j with capacity `cap`, and j → i with `revCap`. */
  addEdge(i: number, j: number, cap: number, revCap: number): void {
    const a = this.arcCount;
    if (a + 2 > this.head.length) throw new Error('MaxFlowGraph: more edges than allocated');
    this.arcCount += 2;
    this.head[a] = j; this.nextArc[a] = this.first[i]; this.first[i] = a; this.rCap[a] = cap;
    this.head[a + 1] = i; this.nextArc[a + 1] = this.first[j]; this.first[j] = a + 1; this.rCap[a + 1] = revCap;
  }

  /**
   * Terminal edges: source → i (`sourceCap`, paid when i ends on the sink side) and
   * i → sink (`sinkCap`, paid when i ends on the source side).
   */
  addTerminal(i: number, sourceCap: number, sinkCap: number): void {
    const delta = this.trCap[i];
    if (delta > 0) sourceCap += delta;
    else sinkCap -= delta;
    this.flow += Math.min(sourceCap, sinkCap);
    this.trCap[i] = sourceCap - sinkCap;
  }

  /** Whether node i is on the sink side of the minimum cut (call after maxflow()). */
  inSink(i: number): boolean {
    return this.parent[i] !== NONE && this.isSink[i] === 1;
  }

  maxflow(): number {
    const n = this.nodeCount;
    const { first, parent, trCap, isSink, ts, dist, head, nextArc, rCap } = this;
    // Active nodes: a FIFO of node ids with an in-queue flag.
    const queue = new Int32Array(n + 1);
    const queued = new Uint8Array(n);
    let qHead = 0, qTail = 0, qSize = 0;
    const activate = (i: number) => {
      if (queued[i]) return;
      queued[i] = 1;
      queue[qTail] = i; qTail = (qTail + 1) % queue.length; qSize++;
    };
    const nextActive = (): number => {
      while (qSize > 0) {
        const i = queue[qHead]; qHead = (qHead + 1) % queue.length; qSize--;
        queued[i] = 0;
        if (parent[i] !== NONE) return i;
      }
      return NONE;
    };
    let orphans: number[] = [];
    let time = 0;

    for (let i = 0; i < n; i++) {
      if (trCap[i] > 0) { isSink[i] = 0; parent[i] = TERMINAL; activate(i); ts[i] = 0; dist[i] = 1; }
      else if (trCap[i] < 0) { isSink[i] = 1; parent[i] = TERMINAL; activate(i); ts[i] = 0; dist[i] = 1; }
      else parent[i] = NONE;
    }

    for (;;) {
      const i = nextActive();
      if (i === NONE) break;
      // Grow the tree of i until it touches the other tree.
      let meetArc = NONE;
      let srcNode = NONE, sinkNode = NONE;
      if (!isSink[i]) {
        for (let a = first[i]; a !== NONE; a = nextArc[a]) {
          if (!(rCap[a] > 0)) continue;
          const j = head[a];
          if (parent[j] === NONE) {
            isSink[j] = 0; parent[j] = a ^ 1; ts[j] = ts[i]; dist[j] = dist[i] + 1; activate(j);
          } else if (isSink[j]) { meetArc = a; srcNode = i; sinkNode = j; break; }
          else if (ts[j] <= ts[i] && dist[j] > dist[i]) { parent[j] = a ^ 1; ts[j] = ts[i]; dist[j] = dist[i] + 1; }
        }
      } else {
        for (let a = first[i]; a !== NONE; a = nextArc[a]) {
          if (!(rCap[a ^ 1] > 0)) continue;
          const j = head[a];
          if (parent[j] === NONE) {
            isSink[j] = 1; parent[j] = a ^ 1; ts[j] = ts[i]; dist[j] = dist[i] + 1; activate(j);
          } else if (!isSink[j]) { meetArc = a ^ 1; srcNode = j; sinkNode = i; break; }
          else if (ts[j] <= ts[i] && dist[j] > dist[i]) { parent[j] = a ^ 1; ts[j] = ts[i]; dist[j] = dist[i] + 1; }
        }
      }
      if (meetArc === NONE) continue;

      time++;
      // ── Augment along source root … srcNode → sinkNode … sink root ──
      let b = rCap[meetArc];
      for (let k = srcNode; ; ) {
        const pa = parent[k];
        if (pa === TERMINAL) { b = Math.min(b, trCap[k]); break; }
        b = Math.min(b, rCap[pa ^ 1]); k = head[pa];
      }
      for (let k = sinkNode; ; ) {
        const pa = parent[k];
        if (pa === TERMINAL) { b = Math.min(b, -trCap[k]); break; }
        b = Math.min(b, rCap[pa]); k = head[pa];
      }
      rCap[meetArc] -= b; rCap[meetArc ^ 1] += b;
      for (let k = srcNode; ; ) {
        const pa = parent[k];
        if (pa === TERMINAL) {
          trCap[k] -= b;
          if (!(trCap[k] > 0)) { trCap[k] = 0; parent[k] = ORPHAN; orphans.push(k); }
          break;
        }
        rCap[pa ^ 1] -= b; rCap[pa] += b;
        const up = head[pa];
        if (!(rCap[pa ^ 1] > 0)) { rCap[pa ^ 1] = 0; parent[k] = ORPHAN; orphans.push(k); }
        k = up;
      }
      for (let k = sinkNode; ; ) {
        const pa = parent[k];
        if (pa === TERMINAL) {
          trCap[k] += b;
          if (!(trCap[k] < 0)) { trCap[k] = 0; parent[k] = ORPHAN; orphans.push(k); }
          break;
        }
        rCap[pa] -= b; rCap[pa ^ 1] += b;
        const up = head[pa];
        if (!(rCap[pa] > 0)) { rCap[pa] = 0; parent[k] = ORPHAN; orphans.push(k); }
        k = up;
      }
      this.flow += b;

      // ── Adopt orphans ──
      while (orphans.length) {
        const batch = orphans;
        orphans = [];
        for (let oi = 0; oi < batch.length; oi++) {
          const o = batch[oi];
          if (parent[o] !== ORPHAN) continue;
          const sinkTree = isSink[o];
          let bestArc = NONE, bestD = INF_D;
          for (let a0 = first[o]; a0 !== NONE; a0 = nextArc[a0]) {
            const residual = sinkTree ? rCap[a0] : rCap[a0 ^ 1];
            if (!(residual > 0)) continue;
            const j = head[a0];
            if (isSink[j] !== sinkTree || parent[j] === NONE) continue;
            // Distance from j to its terminal, if j's path still reaches one.
            let d = 0;
            for (let k = j; ; ) {
              if (ts[k] === time) { d += dist[k]; break; }
              const a = parent[k];
              d++;
              if (a === TERMINAL) { ts[k] = time; dist[k] = 1; break; }
              if (a === ORPHAN) { d = INF_D; break; }
              k = head[a];
            }
            if (d < INF_D) {
              if (d < bestD) { bestArc = a0; bestD = d; }
              for (let k = j; ts[k] !== time; k = head[parent[k]]) { ts[k] = time; dist[k] = d; d--; }
            }
          }
          if (bestArc !== NONE) {
            parent[o] = bestArc; ts[o] = time; dist[o] = bestD + 1;
            continue;
          }
          // No new parent: o leaves its tree; its children become orphans.
          parent[o] = NONE;
          for (let a0 = first[o]; a0 !== NONE; a0 = nextArc[a0]) {
            const j = head[a0];
            if (isSink[j] !== sinkTree || parent[j] === NONE) continue;
            const residual = sinkTree ? rCap[a0] : rCap[a0 ^ 1];
            if (residual > 0) activate(j);
            const pj = parent[j];
            if (pj !== TERMINAL && pj !== ORPHAN && head[pj] === o) { parent[j] = ORPHAN; orphans.push(j); }
          }
        }
      }
      // i may still grow further.
      if (parent[i] !== NONE) activate(i);
    }
    return this.flow;
  }
}
