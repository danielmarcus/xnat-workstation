import { describe, expect, it } from 'vitest';
import { levelForWidth, LEVEL_MIN_WIDTHS } from './useToolbarCollapse';

describe('levelForWidth', () => {
  it('returns the least-collapsed level the width can afford', () => {
    expect(levelForWidth(1700)).toBe(0);
    expect(levelForWidth(1555)).toBe(0);
    expect(levelForWidth(1554)).toBe(1);
    expect(levelForWidth(1356)).toBe(1);
    expect(levelForWidth(1262)).toBe(2);
    expect(levelForWidth(1172)).toBe(3);
    expect(levelForWidth(1171)).toBe(4);
    expect(levelForWidth(600)).toBe(4);
  });

  it('treats an unmeasured width as full, not maximally collapsed', () => {
    // 0 means "no layout yet" (first paint / jsdom), not "very narrow"; collapsing on it
    // would flash a fully-collapsed toolbar before the first real measurement.
    expect(levelForWidth(0)).toBe(0);
    expect(levelForWidth(-1)).toBe(0);
    expect(levelForWidth(Number.NaN)).toBe(0);
  });

  it('is monotonic — this is what makes flicker impossible', () => {
    // A narrower toolbar may never be LESS collapsed than a wider one. The old
    // measure-and-react loop violated this (it expanded, then collapsed, while the
    // window only grew) because it measured a value its own decision changed.
    let prev = levelForWidth(2000);
    for (let w = 2000; w >= 1; w -= 1) {
      const level = levelForWidth(w);
      expect(level, `level decreased from ${prev} to ${level} at ${w}px`).toBeGreaterThanOrEqual(prev);
      prev = level;
    }
  });

  it('thresholds are ordered widest-first so the first match wins', () => {
    const widths = LEVEL_MIN_WIDTHS.map((t) => t.minWidth);
    expect(widths).toEqual([...widths].sort((a, b) => b - a));
    expect(LEVEL_MIN_WIDTHS.map((t) => t.level)).toEqual([0, 1, 2, 3]);
  });
});
