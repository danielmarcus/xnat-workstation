/**
 * Cleanup operations on binary planes (SegWorks parity, branch 1 S1).
 *
 * Planes are drawn as ASCII art ('#' = in the segment) so each expectation can be read
 * off the page. Every operation returns a NEW plane and leaves its input untouched.
 */
import { describe, expect, it } from 'vitest';
import type { MaskPlane, PlaneSpacing } from '../plane';
import { labelComponents } from '../plane';
import {
  anisotropicDiffusion,
  closeMask,
  fillHoles,
  gaussianSmooth,
  keepLargest,
  magnetBridge,
  medianSmooth,
  openMask,
  removeSpeckles,
  removeStrays,
  smoothEdges,
} from '../cleanup';

function plane(rows: string[]): MaskPlane {
  const height = rows.length;
  const width = rows[0].length;
  const data = new Uint8Array(width * height);
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === '#') data[x + y * width] = 1; }));
  return { width, height, data };
}

function art(p: MaskPlane): string[] {
  const out: string[] = [];
  for (let y = 0; y < p.height; y++) {
    let r = '';
    for (let x = 0; x < p.width; x++) r += p.data[x + y * p.width] ? '#' : '.';
    out.push(r);
  }
  return out;
}

const UNIT: PlaneSpacing = { x: 1, y: 1 };

describe('labelComponents', () => {
  it('joins diagonal neighbours at 8-connectivity and separates them at 4', () => {
    const p = plane(['#.', '.#']);
    expect(labelComponents(p.data, 2, 2, 8).count).toBe(1);
    expect(labelComponents(p.data, 2, 2, 4).count).toBe(2);
  });
});

describe('fillHoles', () => {
  it('fills an enclosed hole', () => {
    const p = plane(['.....', '.###.', '.#.#.', '.###.', '.....']);
    expect(art(fillHoles(p, UNIT))).toEqual(['.....', '.###.', '.###.', '.###.', '.....']);
  });

  it('leaves a cavity that opens to the outside', () => {
    const rows = ['.....', '.###.', '.#...', '.###.', '.....'];
    expect(art(fillHoles(plane(rows), UNIT))).toEqual(rows);
  });

  it('treats a diagonal-only gap as closed (8-connected wall, 4-connected background)', () => {
    const p = plane(['......', '.##...', '.#.#..', '..##..', '......']);
    expect(art(fillHoles(p, UNIT))).toEqual(['......', '.##...', '.###..', '..##..', '......']);
  });

  it('fills only holes at or below the maximum area', () => {
    const p = plane([
      '#########',
      '#.##....#',
      '####....#',
      '#########',
    ]);
    // 1-px hole (1 mm²) is filled; the 8-px hole (8 mm²) is not.
    expect(art(fillHoles(p, UNIT, { maxHoleAreaMm2: 2 }))).toEqual([
      '#########',
      '####....#',
      '####....#',
      '#########',
    ]);
  });

  it('does not mutate its input', () => {
    const p = plane(['###', '#.#', '###']);
    fillHoles(p, UNIT);
    expect(art(p)).toEqual(['###', '#.#', '###']);
  });
});

describe('keepLargest', () => {
  const rows = [
    '###....',
    '###..##',
    '###..##',
  ];
  it('keeps only the largest component', () => {
    expect(art(keepLargest(plane(rows)))).toEqual(['###....', '###....', '###....']);
  });
  it('can also keep components within a percentage of the largest', () => {
    // 4 px ≥ 40% of 9 px → kept.
    expect(art(keepLargest(plane(rows), { alsoKeepPct: 40 }))).toEqual(rows);
  });
});

describe('removeSpeckles', () => {
  it('removes components smaller than the minimum physical area', () => {
    const p = plane(['###...#', '###..##', '###....']);
    // 0.5 mm pixels → 0.25 mm²/px. 9 px = 2.25 mm² survives, 3 px = 0.75 mm² is removed.
    const out = removeSpeckles(p, { x: 0.5, y: 0.5 }, { minAreaMm2: 1 });
    expect(art(out)).toEqual(['###....', '###....', '###....']);
  });
});

describe('removeStrays', () => {
  const rows = [
    '###.......#',
    '###.#......',
    '###........',
  ];
  it('removes small components whose centroid is farther than the limit from the largest', () => {
    // Largest centroid x=1; near one at x=4 (3 mm), far one at x=10 (9 mm).
    expect(art(removeStrays(plane(rows), UNIT, { maxDistanceMm: 5, protectPct: 0 }))).toEqual([
      '###........',
      '###.#......',
      '###........',
    ]);
  });
  it('measures distance in mm, honouring anisotropic spacing', () => {
    // With 2 mm columns the near component is 6 mm away → removed too.
    expect(art(removeStrays(plane(rows), { x: 2, y: 1 }, { maxDistanceMm: 5, protectPct: 0 }))).toEqual([
      '###........',
      '###........',
      '###........',
    ]);
  });
  it('protects far components that are a large fraction of the largest', () => {
    const p = plane(['###......##', '###......##', '###........']);
    // 4 px ≥ 15% of 9 px → protected despite the distance.
    expect(art(removeStrays(p, UNIT, { maxDistanceMm: 5, protectPct: 15 }))).toEqual(art(p));
  });
});

describe('medianSmooth', () => {
  it('removes an isolated pixel, fills a pinhole and keeps edge middles', () => {
    const p = plane([
      '#........',
      '..#####..',
      '..#####..',
      '..##.##..',
      '..#####..',
      '..#####..',
      '.........',
    ]);
    const out = medianSmooth(p, { radius: 1 });
    expect(out.data[0]).toBe(0); // isolated pixel
    expect(out.data[4 + 3 * 9]).toBe(1); // pinhole
    expect(out.data[4 + 1 * 9]).toBe(1); // top edge middle
    expect(out.data[2 + 1 * 9]).toBe(0); // a radius-1 majority trims convex corners (4/9)
  });
});

describe('gaussianSmooth', () => {
  it('removes isolated pixels, keeps solid interiors and rounds corners', () => {
    const p = plane([
      '#..........',
      '...........',
      '..#######..',
      '..#######..',
      '..#######..',
      '..#######..',
      '..#######..',
      '..#######..',
      '..#######..',
      '...........',
    ]);
    const out = gaussianSmooth(p, { sigma: 1, threshold: 0.5 });
    expect(out.data[0]).toBe(0); // isolated pixel gone
    expect(out.data[5 + 5 * 11]).toBe(1); // centre kept
    expect(out.data[2 + 2 * 11]).toBe(0); // corner rounded off (≈0.49 of the kernel inside)
    expect(out.data[5 + 2 * 11]).toBe(1); // edge middle kept
  });
});

describe('smoothEdges', () => {
  /** A 24 px square with a 3 px notch cut into its top and a 2 px spike off its right side. */
  const jagged = () => {
    const w = 40, h = 40;
    const data = new Uint8Array(w * h);
    for (let y = 8; y < 32; y++) for (let x = 8; x < 32; x++) data[x + y * w] = 1;
    for (let y = 8; y < 13; y++) for (let x = 18; x < 21; x++) data[x + y * w] = 0;
    for (let y = 19; y < 21; y++) for (let x = 32; x < 38; x++) data[x + y * w] = 1;
    return { width: w, height: h, data };
  };
  const at = (p: MaskPlane, x: number, y: number) => p.data[x + y * p.width];

  it('fills a notch and removes a spike narrower than the radius', () => {
    const out = smoothEdges(jagged(), UNIT, { radiusMm: 3 });
    expect(at(out, 19, 11), 'notch').toBe(1);
    expect(at(out, 36, 19), 'spike').toBe(0);
    expect(at(out, 20, 20), 'body').toBe(1);
  });

  it('leaves features wider than the radius alone', () => {
    const out = smoothEdges(jagged(), UNIT, { radiusMm: 1 });
    expect(at(out, 19, 11), 'notch is 3 px wide').toBe(0);
  });

  it('keeps a large round body\'s area', () => {
    const w = 200, h = 200;
    const data = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x - 100) ** 2 + (y - 100) ** 2 < 70 * 70) data[x + y * w] = 1;
    const area = data.reduce((n, v) => n + v, 0);
    const out = smoothEdges({ width: w, height: h, data }, UNIT, { radiusMm: 5 }).data.reduce((n, v) => n + v, 0);
    expect(Math.abs(out - area) / area).toBeLessThan(0.01);
  });

  it('measures the radius in mm on anisotropic pixels', () => {
    // 3 mm is 3 px across but 1 px down: the notch (3 px wide) closes only from the side.
    const p = jagged();
    expect(at(smoothEdges(p, { x: 1, y: 3 }, { radiusMm: 3 }), 19, 9)).toBe(1);
    expect(at(smoothEdges(p, { x: 3, y: 1 }, { radiusMm: 3 }), 19, 9)).toBe(0);
  });
});

describe('openMask / closeMask', () => {
  it('opening removes a thin spur and keeps the body exactly', () => {
    const p = plane([
      '.........',
      '.#####...',
      '.######.#',
      '.#####...',
      '.#####...',
      '.#####...',
      '.........',
    ]);
    expect(art(openMask(p, { radius: 1 }))).toEqual([
      '.........',
      '.#####...',
      '.#####...',
      '.#####...',
      '.#####...',
      '.#####...',
      '.........',
    ]);
  });

  it('closing seals a narrow groove', () => {
    const p = plane([
      '.........',
      '.###.###.',
      '.###.###.',
      '.#######.',
      '.........',
    ]);
    expect(art(closeMask(p, { radius: 1 }))).toEqual([
      '.........',
      '.#######.',
      '.#######.',
      '.#######.',
      '.........',
    ]);
  });
});

describe('anisotropicDiffusion', () => {
  it('without an image it smooths a jagged boundary toward a straight one', () => {
    const p = plane([
      '..........',
      '..........',
      '.#.#.#.#..',
      '##########',
      '##########',
      '##########',
      '##########',
      '##########',
    ]);
    const out = anisotropicDiffusion(p, { iterations: 20, kappa: 30, conduction: 'exp' });
    // The isolated teeth melt away; solid rows remain.
    expect(art(out)[2]).toBe('..........');
    expect(art(out)[5]).toBe('##########');
  });

  it('an image edge stops diffusion: a tooth backed by image intensity survives', () => {
    const p = plane([
      '......',
      '..#...',
      '######',
      '######',
      '######',
    ]);
    // The image is bright exactly where the mask is, including the tooth.
    const image = new Float32Array(p.data.length);
    for (let i = 0; i < image.length; i++) image[i] = p.data[i] ? 1000 : 0;
    const out = anisotropicDiffusion(p, { iterations: 20, kappa: 10, conduction: 'quadratic', image });
    expect(out.data[2 + 1 * 6]).toBe(1);
    // …and the same tooth with no image support melts away.
    const free = anisotropicDiffusion(p, { iterations: 20, kappa: 10, conduction: 'quadratic' });
    expect(free.data[2 + 1 * 6]).toBe(0);
  });
});

describe('magnetBridge', () => {
  // S = source, T = target, separated by a 3-px background gap.
  function pair(rows: string[]) {
    const height = rows.length;
    const width = rows[0].length;
    const src = new Uint8Array(width * height);
    const dst = new Uint8Array(width * height);
    rows.forEach((r, y) => [...r].forEach((ch, x) => {
      if (ch === 'S') src[x + y * width] = 1;
      if (ch === 'T') dst[x + y * width] = 1;
    }));
    return { width, height, src, dst };
  }
  const show = (w: number, h: number, src: Uint8Array, dst: Uint8Array) => {
    const out: string[] = [];
    for (let y = 0; y < h; y++) {
      let r = '';
      for (let x = 0; x < w; x++) r += dst[x + y * w] ? 'T' : src[x + y * w] ? 'S' : '.';
      out.push(r);
    }
    return out;
  };

  it('fills the background gap between source and target with target', () => {
    const { width, height, src, dst } = pair(['SS...TT', 'SS...TT']);
    const r = magnetBridge({ width, height, source: src, target: dst, maxGapPx: 5, mode: 'fill' });
    expect(show(width, height, src, r.target)).toEqual(['SSTTTTT', 'SSTTTTT']);
  });

  it('does nothing when the gap exceeds the limit', () => {
    const { width, height, src, dst } = pair(['SS......TT']);
    const r = magnetBridge({ width, height, source: src, target: dst, maxGapPx: 2, mode: 'fill' });
    expect(show(width, height, src, r.target)).toEqual(['SS......TT']);
  });

  it('never claims pixels blocked by another member', () => {
    const { width, height, src, dst } = pair(['SS...TT']);
    const blocked = new Uint8Array(width * height);
    blocked[3] = 1;
    const r = magnetBridge({ width, height, source: src, target: dst, blocked, maxGapPx: 5, mode: 'fill' });
    expect(r.target[3]).toBe(0);
    expect(r.claimed[3]).toBe(0);
  });

  it('overwrite mode bridges through another member and reports the pixels it claimed', () => {
    const { width, height, src, dst } = pair(['SS...TT']);
    const blocked = new Uint8Array(width * height);
    blocked[3] = 1;
    const r = magnetBridge({ width, height, source: src, target: dst, blocked, maxGapPx: 5, mode: 'overwrite' });
    expect(show(width, height, src, r.target)).toEqual(['SSTTTTT']);
    expect(Array.from(r.claimed)).toEqual([0, 0, 0, 1, 0, 0, 0]);
  });

  it('a protected (locked) member is never crossed or claimed, even in overwrite mode', () => {
    const { width, height, src, dst } = pair(['SS...TT']);
    const prot = new Uint8Array(width * height);
    prot[3] = 1;
    const r = magnetBridge({ width, height, source: src, target: dst, blocked: prot, protectedMask: prot, maxGapPx: 5, mode: 'overwrite' });
    expect(r.target[3]).toBe(0);
    expect(r.claimed[3]).toBe(0);
  });

  it('never changes the source', () => {
    const { width, height, src, dst } = pair(['SS...TT']);
    const before = Array.from(src);
    magnetBridge({ width, height, source: src, target: dst, maxGapPx: 5, mode: 'overwrite' });
    expect(Array.from(src)).toEqual(before);
  });
});

describe('smoothing equals the unoptimised 2D form (O8)', () => {
  /** The previous implementations, verbatim: full-plane 2D window / kernel. */
  function convolve2d(p: MaskPlane, kernel: Float64Array, radius: number, threshold: number): Uint8Array {
    const { width: w, height: h, data } = p;
    const kw = 2 * radius + 1;
    const out = new Uint8Array(data.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let wsum = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -radius; dx <= radius; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const k = kernel[dx + radius + (dy + radius) * kw];
            wsum += k;
            if (data[xx + yy * w]) sum += k;
          }
        }
        out[x + y * w] = wsum > 0 && sum / wsum >= threshold ? 1 : 0;
      }
    }
    return out;
  }
  function gaussian2d(p: MaskPlane, sigma: number, threshold: number): Uint8Array {
    const r = Math.ceil(sigma * 3);
    const kw = 2 * r + 1;
    const kernel = new Float64Array(kw * kw);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) kernel[dx + r + (dy + r) * kw] = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
    }
    return convolve2d(p, kernel, r, threshold);
  }
  function median2d(p: MaskPlane, r: number): Uint8Array {
    const { width: w, height: h, data } = p;
    const out = new Uint8Array(data.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let set = 0;
        let total = 0;
        for (let dy = -r; dy <= r; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -r; dx <= r; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            total++;
            if (data[xx + yy * w]) set++;
          }
        }
        out[x + y * w] = set > total / 2 ? 1 : 0;
      }
    }
    return out;
  }

  /** A painted-looking mask: overlapping brush discs with jagged edges, one touching the plane edge. */
  function painted(w: number, h: number, seed: number): MaskPlane {
    let s = seed;
    const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    const data = new Uint8Array(w * h);
    const disc = (cx: number, cy: number, r: number) => {
      for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y++) {
        for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++) {
          if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) data[x + y * w] = 1;
        }
      }
    };
    let cx = w * 0.4, cy = h * 0.5;
    for (let i = 0; i < 60; i++) { cx += (rnd() - 0.5) * 12; cy += (rnd() - 0.5) * 12; disc(cx, cy, 4 + rnd() * 8); }
    disc(2, h / 3, 9); // against the edge
    for (let i = 0; i < 200; i++) data[Math.floor(rnd() * w * h)] ^= 1; // speckle and pinholes
    return { width: w, height: h, data };
  }
  const diff = (a: Uint8Array, b: Uint8Array) => a.reduce((n, v, i) => n + (v !== b[i] ? 1 : 0), 0);

  it('gaussianSmooth (separable, cropped) gives the same pixels as the 2D kernel', () => {
    for (const seed of [1, 7, 42]) {
      const p = painted(160, 128, seed);
      for (const sigma of [0.5, 1.2, 2, 3.3, 4]) {
        for (const threshold of [0.2, 0.45, 0.5, 0.8]) {
          expect(diff(gaussianSmooth(p, { sigma, threshold }).data, gaussian2d(p, sigma, threshold)), `σ=${sigma} t=${threshold} seed=${seed}`).toBe(0);
        }
      }
    }
  });

  it('fillHoles (cropped to the mask) fills the same holes as on the whole plane', () => {
    function fillHoles2d(p: MaskPlane, spacing: PlaneSpacing, maxHoleAreaMm2?: number): Uint8Array {
      const { width: w, height: h } = p;
      const bg = labelComponents(p.data, w, h, 4, 0);
      const touchesBorder = new Uint8Array(bg.count + 1);
      for (let x = 0; x < w; x++) { touchesBorder[bg.labels[x]] = 1; touchesBorder[bg.labels[x + (h - 1) * w]] = 1; }
      for (let y = 0; y < h; y++) { touchesBorder[bg.labels[y * w]] = 1; touchesBorder[bg.labels[w - 1 + y * w]] = 1; }
      const out = new Uint8Array(p.data);
      for (let i = 0; i < out.length; i++) {
        const id = bg.labels[i];
        if (id === 0 || touchesBorder[id]) continue;
        if (bg.sizes[id] * spacing.x * spacing.y <= (maxHoleAreaMm2 ?? Infinity)) out[i] = 1;
      }
      return out;
    }
    const spacing = { x: 0.8, y: 0.6 };
    for (const seed of [2, 5, 8, 13]) {
      const p = painted(160, 128, seed);
      for (const max of [undefined, 1, 5, 40]) {
        expect(diff(fillHoles(p, spacing, { maxHoleAreaMm2: max }).data, fillHoles2d(p, spacing, max)), `seed=${seed} max=${max}`).toBe(0);
      }
    }
  });

  it('medianSmooth (cropped) is unchanged', () => {
    for (const seed of [3, 9]) {
      const p = painted(160, 128, seed);
      for (const radius of [1, 2, 5]) expect(diff(medianSmooth(p, { radius }).data, median2d(p, radius))).toBe(0);
    }
  });

  /** Smooth edges as written: a direct disc vote over the whole plane, repeated until stable. */
  function smoothEdges2d(p: MaskPlane, spacing: PlaneSpacing, radiusMm: number): Uint8Array {
    const { width: w, height: h } = p;
    const rx = Math.max(1, radiusMm / spacing.x), ry = Math.max(1, radiusMm / spacing.y);
    let cur = new Uint8Array(p.data);
    let prev: Uint8Array | null = null;
    for (let pass = 0; pass < 64; pass++) {
      const next = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let set = 0, total = 0;
          for (let dy = -Math.floor(ry); dy <= Math.floor(ry); dy++) {
            const half = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry))));
            for (let dx = -half; dx <= half; dx++) {
              const xx = x + dx, yy = y + dy;
              if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
              total++;
              set += cur[xx + yy * w];
            }
          }
          next[x + y * w] = 2 * set > total ? 1 : 0;
        }
      }
      if (diff(next, cur) === 0) break;
      if (prev && diff(prev, next) === 0) return next.map((v, i) => v & cur[i]);
      prev = cur;
      cur = next;
    }
    return cur;
  }

  it('smoothEdges is stable: a second run changes nothing', () => {
    for (const seed of [3, 9, 21]) {
      const once = smoothEdges(painted(160, 128, seed), { x: 0.8, y: 0.6 }, { radiusMm: 2 });
      const twice = smoothEdges(once, { x: 0.8, y: 0.6 }, { radiusMm: 2 });
      expect(diff(twice.data, once.data), `seed=${seed}`).toBe(0);
    }
  });

  it('smoothEdges (prefix sums over the box) equals the direct disc vote', () => {
    for (const seed of [3, 9]) {
      const p = painted(120, 96, seed);
      for (const [spacing, r] of [[UNIT, 1], [UNIT, 3], [{ x: 0.8, y: 0.6 }, 2.5]] as const) {
        expect(diff(smoothEdges(p, spacing, { radiusMm: r }).data, smoothEdges2d(p, spacing, r)), `seed=${seed} r=${r}`).toBe(0);
      }
    }
  });

  it('an empty plane stays empty, and costs no window pass', () => {
    const p = { width: 512, height: 512, data: new Uint8Array(512 * 512) };
    expect(gaussianSmooth(p, { sigma: 4 }).data.includes(1)).toBe(false);
    expect(medianSmooth(p, { radius: 5 }).data.includes(1)).toBe(false);
    expect(smoothEdges(p, UNIT, { radiusMm: 5 }).data.includes(1)).toBe(false);
  });

  it('Smooth edges at its largest radius on a 512² slice with a painted organ stays interactive', () => {
    const p = painted(512, 512, 5);
    const t0 = performance.now();
    smoothEdges(p, { x: 0.7, y: 0.7 }, { radiusMm: 10 });
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it('σ = 4 on a 512² slice with a painted organ takes well under the 2D kernel\'s time', () => {
    const p = painted(512, 512, 5);
    const t0 = performance.now();
    gaussianSmooth(p, { sigma: 4 });
    const fast = performance.now() - t0;
    const t1 = performance.now();
    gaussian2d(p, 4, 0.45);
    const slow = performance.now() - t1;
    expect(fast).toBeLessThan(slow / 4);
  });
});
