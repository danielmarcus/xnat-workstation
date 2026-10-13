/**
 * Fast GrowCut (SegWorks #101–115; branch 5, G1) — L. Zhu et al., "An effective interactive
 * medical image segmentation method using Fast GrowCut", MICCAI IMIC workshop 2014.
 *
 * GrowCut's cellular automaton converges to a shortest-path labelling: every voxel takes the
 * class of the seed it is closest to, where a path costs the sum of intensity steps |I_p − I_q|
 * along it. Fast GrowCut computes that directly with Dijkstra from all seeds at once — one
 * pass, no iterations to cap or converge. (SegWorks shipped the original automaton, swept in
 * place, so its result depended on scan order; it also let ±x / ±y neighbours wrap across row
 * and slice ends.)
 *
 * The intensity gate (#110) is part of the growth: a voxel outside [lo, hi] is never entered,
 * so a class cannot leak through it.
 */
import { forEachNeighbour6, voxelCount, type Dims } from './volume';

export interface FastGrowCutOptions {
  /** Voxels outside this intensity range are not labelled and do not conduct (#110). */
  gate?: { lo: number; hi: number } | null;
  onProgress?: (fraction: number) => void;
}

/** A binary min-heap of node ids keyed by distance, with decrease-key. */
class IndexedHeap {
  private readonly heap: Int32Array;
  private readonly pos: Int32Array;
  private size = 0;
  constructor(n: number, private readonly key: Float64Array) {
    this.heap = new Int32Array(n);
    this.pos = new Int32Array(n).fill(-1);
  }
  get length() { return this.size; }
  push(i: number): void {
    if (this.pos[i] >= 0) { this.up(this.pos[i]); return; }
    this.heap[this.size] = i; this.pos[i] = this.size; this.up(this.size++);
  }
  pop(): number {
    const top = this.heap[0];
    this.pos[top] = -2; // settled
    const last = this.heap[--this.size];
    if (this.size > 0) { this.heap[0] = last; this.pos[last] = 0; this.down(0); }
    return top;
  }
  settled(i: number) { return this.pos[i] === -2; }
  private up(k: number) {
    const { heap, pos, key } = this;
    const i = heap[k];
    while (k > 0) {
      const pk = (k - 1) >> 1, p = heap[pk];
      if (key[p] <= key[i]) break;
      heap[k] = p; pos[p] = k; k = pk;
    }
    heap[k] = i; pos[i] = k;
  }
  private down(k: number) {
    const { heap, pos, key } = this;
    const i = heap[k];
    for (;;) {
      let c = 2 * k + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && key[heap[c + 1]] < key[heap[c]]) c++;
      if (key[heap[c]] >= key[i]) break;
      heap[k] = heap[c]; pos[heap[c]] = k; k = c;
    }
    heap[k] = i; pos[i] = k;
  }
}

/**
 * Label every voxel reachable from a seed with the class of its nearest seed (0 = unreached).
 * `seeds` holds a class per voxel (0 = none).
 */
export function fastGrowCut(image: ArrayLike<number>, d: Dims, seeds: Uint8Array, o: FastGrowCutOptions = {}): Uint8Array {
  const n = voxelCount(d);
  const labels = new Uint8Array(n);
  const dist = new Float64Array(n).fill(Infinity);
  const heap = new IndexedHeap(n, dist);
  const gate = o.gate ?? null;
  const open = (i: number) => !gate || (image[i] >= gate.lo && image[i] <= gate.hi);
  for (let i = 0; i < n; i++) {
    if (seeds[i] && open(i)) { labels[i] = seeds[i]; dist[i] = 0; heap.push(i); }
  }
  let done = 0;
  const every = Math.max(1, Math.floor(n / 50));
  while (heap.length) {
    const p = heap.pop();
    if (o.onProgress && ++done % every === 0) o.onProgress(done / n);
    const dp = dist[p], lp = labels[p], ip = image[p];
    forEachNeighbour6(d, p, (q) => {
      if (heap.settled(q) || !open(q)) return;
      const nd = dp + Math.abs(image[q] - ip);
      if (nd < dist[q]) { dist[q] = nd; labels[q] = lp; heap.push(q); }
    });
  }
  return labels;
}
