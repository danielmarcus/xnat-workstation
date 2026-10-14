/** Snake refine as a Cleanup operation (branch 6 F6; #200–201): the catalog entry's wiring. */
import { describe, expect, it } from 'vitest';
import { CLEANUP_OPS, type ParamValues } from '../catalog';
import type { MaskPlane } from '../plane';
import type { PlaneOpContext } from '../scope';

const W = 64, H = 64;
const disc = (r: number) => Uint8Array.from({ length: W * H }, (_, i) => (Math.hypot((i % W) - 32, Math.floor(i / W) - 32) <= r ? 1 : 0));
const image = Float32Array.from(disc(15), (v) => (v ? 100 : 0));
const plane = (data: Uint8Array): MaskPlane => ({ width: W, height: H, data });
const op = CLEANUP_OPS.find((o) => o.id === 'snakeRefine')!;
const defaults = (): ParamValues => Object.fromEntries(op.params.map((p) => [p.key, p.default]));
const ctx = (extra: Partial<PlaneOpContext> = {}): PlaneOpContext => ({
  member: { containerId: 'C', segmentIndex: 1 }, slice: 0, spacing: { x: 1, y: 1 } as PlaneOpContext['spacing'], image, ...extra,
});
const result = (out: ReturnType<NonNullable<typeof op.run>>) => ('plane' in out ? out : { plane: out, claimed: undefined });
const area = (d: Uint8Array) => d.reduce((s, v) => s + v, 0);

describe('Snake refine (Cleanup)', () => {
  it('is a Clean operation that needs the image, and claims only when Neighbours = Replace', () => {
    expect(op.group).toBe('clean');
    expect(op.usesImage).toBe(true);
    expect(op.claims?.(defaults())).toBe(false);
    expect(op.claims?.({ ...defaults(), replaceNeighbours: 'replace' })).toBe(true);
  });

  it('a loose mask is pulled in onto the edge', () => {
    const out = result(op.run!(plane(disc(17)), ctx(), defaults())).plane;
    expect(Math.abs(area(out.data) - area(disc(15)))).toBeLessThan(Math.abs(area(disc(17)) - area(disc(15))) / 2);
  });

  it('the Variant parameter reaches the snake: Balloon inflates a small seed, Edge leaves it', () => {
    const seed = plane(disc(6));
    const edge = result(op.run!(seed, ctx(), { ...defaults(), variant: 'edge' })).plane;
    const balloon = result(op.run!(seed, ctx(), { ...defaults(), variant: 'balloon', balloon: 0.6, iterations: 40 })).plane;
    expect(area(balloon.data)).toBeGreaterThan(area(edge.data) * 2);
  });

  it('Replace claims exactly the neighbour pixels it takes; Keep claims nothing and takes none', () => {
    const others = Uint8Array.from({ length: W * H }, (_, i) => {
      const x = i % W, r = Math.hypot(x - 32, Math.floor(i / W) - 32);
      return x > 32 && r > 11.5 && r <= 15 ? 1 : 0;
    });
    const grow = { ...defaults(), variant: 'balloon', balloon: 0.6, iterations: 40 };
    const keep = result(op.run!(plane(disc(11)), ctx({ others }), grow));
    expect(keep.claimed).toBeUndefined();
    expect(keep.plane.data.some((v, i) => v && others[i])).toBe(false);
    const replace = result(op.run!(plane(disc(11)), ctx({ others }), { ...grow, replaceNeighbours: 'replace' }));
    expect(replace.claimed).toBeDefined();
    const taken = Uint8Array.from(replace.plane.data, (v, i) => (v && others[i] ? 1 : 0));
    expect(area(taken)).toBeGreaterThan(0);
    expect([...replace.claimed!]).toEqual([...taken]);
  });

  it('without the image it leaves the segment as it is', () => {
    const p = plane(disc(17));
    expect(result(op.run!(p, ctx({ image: undefined }), defaults())).plane).toBe(p);
  });
});

describe('every plane operation leaves an empty plane empty (O8: a Volume run skips empty slices)', () => {
  const empty = () => plane(new Uint8Array(W * H));
  const others = disc(10);
  for (const o of CLEANUP_OPS.filter((c) => c.run)) {
    const base: ParamValues = Object.fromEntries(o.params.map((p) => [p.key, p.default]));
    const variants: ParamValues[] = [base];
    for (const p of o.params) {
      if (p.kind === 'select') for (const opt of p.options) variants.push({ ...base, [p.key]: opt.value });
      else variants.push({ ...base, [p.key]: p.min }, { ...base, [p.key]: p.max });
    }
    it(o.id, () => {
      for (const params of variants) {
        const out = result(o.run!(empty(), ctx({ others, protect: new Uint8Array(W * H) }), params)).plane;
        expect(out.data.includes(1), JSON.stringify(params)).toBe(false);
      }
    });
  }
});
