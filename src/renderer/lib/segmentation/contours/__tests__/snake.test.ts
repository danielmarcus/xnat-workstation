/**
 * Snake Refine (branch 6, F1; #200–201, #89): each variant moves a segment's boundary
 * toward a known edge from the start it is meant for, and the neighbour rules hold.
 */
import { describe, expect, it } from 'vitest';
import { computeGVF, edgeMap, snakeRefine } from '../snake';
import type { MaskPlane } from '../../maskOps/plane';

const W = 64, H = 64, R = 15;
const disc = (r: number, cx = 32, cy = 32) => Uint8Array.from({ length: W * H }, (_, i) => (Math.hypot((i % W) - cx, Math.floor(i / W) - cy) <= r ? 1 : 0));
const truth = disc(R);
const image = Float32Array.from(truth, (v) => (v ? 100 : 0));
const plane = (data: Uint8Array): MaskPlane => ({ width: W, height: H, data });
const area = (d: Uint8Array) => d.reduce((s, v) => s + v, 0);
const dice = (a: Uint8Array, b: Uint8Array) => {
  let inter = 0;
  for (let i = 0; i < a.length; i++) inter += a[i] & b[i];
  return (2 * inter) / (area(a) + area(b));
};

describe('snakeRefine', () => {
  it('edge: a mask 2 px outside its edge is pulled onto it', () => {
    const start = disc(R + 2);
    const out = snakeRefine(plane(start), image, { variant: 'edge' });
    expect(dice(out.data, truth)).toBeGreaterThan(dice(start, truth) + 0.03);
  });

  it('gvf: reaches an edge 7 px away, where the plain edge force has nothing to follow', () => {
    const start = disc(R + 7);
    const edge = snakeRefine(plane(start), image, { variant: 'edge', iterations: 40 });
    const gvf = snakeRefine(plane(start), image, { variant: 'gvf', iterations: 40, gvfIterations: 80 });
    expect(dice(gvf.data, truth)).toBeGreaterThan(dice(edge.data, truth) + 0.05);
    expect(dice(gvf.data, truth)).toBeGreaterThan(0.85);
  });

  it('balloon: a small seed inflates out to the boundary and stops there', () => {
    const start = disc(5);
    const out = snakeRefine(plane(start), image, { variant: 'balloon', balloon: 0.6, iterations: 40 });
    expect(dice(out.data, truth)).toBeGreaterThan(0.8);
    expect(area(out.data)).toBeLessThan(area(truth) * 1.15);
  });

  it('morph: deflation shrinks a mask beyond the edge\'s reach toward it; without it nothing moves', () => {
    const start = disc(R + 5);
    const o = { variant: 'morph' as const, iterations: 8, preSmoothSigma: 0.5 };
    const deflate = snakeRefine(plane(start), image, { ...o, balloon: -1 });
    const still = snakeRefine(plane(start), image, { ...o, balloon: 0 });
    expect(dice(deflate.data, truth)).toBeGreaterThan(dice(still.data, truth) + 0.03);
  });

  it('morph: the area guard stops a step that would shrink the mask by more than 30 %', () => {
    // No edge to stop deflation: each step erodes a layer, until the step that would take
    // away more than 30 % of what is left — the mask is not eroded away.
    const start = disc(10);
    const blank = new Float32Array(W * H);
    const out = snakeRefine(plane(start), blank, { variant: 'morph', balloon: -1, iterations: 8 });
    expect(area(out.data)).toBeLessThan(area(start));
    expect(area(out.data)).toBeGreaterThanOrEqual(30);
  });
});

describe('neighbours (#201), locks and ROI', () => {
  const start = disc(11);
  // Another segment holds the ring 12–15 px out on the right half.
  const others = Uint8Array.from({ length: W * H }, (_, i) => {
    const x = i % W, y = Math.floor(i / W), r = Math.hypot(x - 32, y - 32);
    return x > 32 && r > 11.5 && r <= 15 ? 1 : 0;
  });
  const grow = (ctx: Parameters<typeof snakeRefine>[3]) => snakeRefine(plane(start), image, { variant: 'balloon', balloon: 0.6, iterations: 40 }, ctx);
  const taken = (d: Uint8Array, owner: Uint8Array) => d.reduce((s, v, i) => s + (v && owner[i] ? 1 : 0), 0);

  it('by default the neighbour keeps every pixel', () => {
    expect(taken(grow({ others }).data, others)).toBe(0);
  });

  it('with replacement allowed, only pixels touching the original boundary change hands', () => {
    const out = grow({ others, allowReplace: true }).data;
    expect(taken(out, others)).toBeGreaterThan(0);
    // Every pixel taken from the neighbour is 4-adjacent to the original segment.
    const touches = (i: number) => [1, -1, W, -W].some((d) => start[i + d] === 1);
    for (let i = 0; i < out.length; i++) if (out[i] && others[i]) expect(touches(i)).toBe(true);
  });

  it('protected (locked) pixels are never taken, even when replacement is allowed', () => {
    expect(taken(grow({ protect: others, allowReplace: true }).data, others)).toBe(0);
  });

  it('outside the ROI nothing changes', () => {
    const roi = Uint8Array.from({ length: W * H }, (_, i) => (i % W < 32 ? 1 : 0));
    const out = grow({ roi }).data;
    for (let i = 0; i < out.length; i++) if (!roi[i]) expect(out[i]).toBe(start[i]);
  });
});

describe('fields', () => {
  it('the edge map peaks on the boundary', () => {
    const e = edgeMap(image, W, H, 1);
    expect(e[32 * W + 47]).toBeGreaterThan(0.5); // on the edge (x = 47, r = 15)
    expect(e[32 * W + 32]).toBeLessThan(0.05);   // the centre
  });

  it('GVF carries the edge force into the flat region outside', () => {
    const e = edgeMap(image, W, H, 1);
    const { u } = computeGVF(e, W, H, 0.2, 80);
    // 7 px right of the edge the flow points back toward it (negative x).
    expect(u[32 * W + 54]).toBeLessThan(0);
  });
});
