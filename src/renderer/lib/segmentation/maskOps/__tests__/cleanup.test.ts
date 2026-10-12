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
  it('removes an isolated pixel and fills a one-pixel notch', () => {
    const p = plane([
      '#.......',
      '........',
      '..####..',
      '..#.##..',
      '..####..',
      '..####..',
    ]);
    const out = smoothEdges(p);
    expect(out.data[0]).toBe(0);
    expect(out.data[3 + 3 * 8]).toBe(1);
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
