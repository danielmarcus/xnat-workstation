import { describe, expect, it } from 'vitest';
import { levelForWidth, attributesForLevel, MAX_LEVEL } from './useToolbarCollapse';

// Representative of a real calibration: each level removes content, so widths decrease.
const WIDTHS = [1545, 1346, 1252, 1162, 988];

describe('levelForWidth', () => {
  it('picks the least-collapsed level that fits the measured widths', () => {
    expect(levelForWidth(1700, WIDTHS)).toBe(0);
    expect(levelForWidth(1545, WIDTHS)).toBe(0);
    expect(levelForWidth(1544, WIDTHS)).toBe(1);
    expect(levelForWidth(1346, WIDTHS)).toBe(1);
    expect(levelForWidth(1252, WIDTHS)).toBe(2);
    expect(levelForWidth(1162, WIDTHS)).toBe(3);
    expect(levelForWidth(1000, WIDTHS)).toBe(4);
    expect(levelForWidth(500, WIDTHS)).toBe(MAX_LEVEL);
  });

  it('treats an unmeasured width as full, not maximally collapsed', () => {
    // 0 means "no layout yet" (first paint / jsdom), not "very narrow"; collapsing on it
    // would flash a fully-collapsed toolbar before the first measurement.
    expect(levelForWidth(0, WIDTHS)).toBe(0);
    expect(levelForWidth(-1, WIDTHS)).toBe(0);
    expect(levelForWidth(Number.NaN, WIDTHS)).toBe(0);
  });

  it('stays at full before calibration has produced any widths', () => {
    expect(levelForWidth(1200, [])).toBe(0);
  });

  it('is monotonic — this is what makes flicker impossible', () => {
    // A narrower toolbar may never be LESS collapsed than a wider one. The old
    // measure-and-react loop violated this (it expanded, then collapsed, while the
    // window only grew) because it measured a value its own decision changed.
    let prev = levelForWidth(2000, WIDTHS);
    for (let w = 2000; w >= 1; w -= 1) {
      const level = levelForWidth(w, WIDTHS);
      expect(level, `level decreased from ${prev} to ${level} at ${w}px`).toBeGreaterThanOrEqual(prev);
      prev = level;
    }
  });

  it('adapts when calibration reports different widths', () => {
    // Adding a toolbar item makes every level wider; the same window width should then
    // resolve to a MORE collapsed level, with no code change.
    const wider = WIDTHS.map((w) => w + 200);
    expect(levelForWidth(1400, WIDTHS)).toBe(1);
    expect(levelForWidth(1400, wider)).toBe(3);
  });
});

describe('attributesForLevel', () => {
  it('collapses groups cumulatively, least-essential first', () => {
    expect(attributesForLevel(0)).toEqual({ textCollapsed: false, collapsedGroups: '' });
    expect(attributesForLevel(1)).toEqual({ textCollapsed: true, collapsedGroups: '' });
    expect(attributesForLevel(2)).toEqual({ textCollapsed: true, collapsedGroups: 'cine' });
    expect(attributesForLevel(3)).toEqual({ textCollapsed: true, collapsedGroups: 'cine transform' });
    expect(attributesForLevel(4)).toEqual({ textCollapsed: true, collapsedGroups: 'cine transform navigation' });
  });
});
