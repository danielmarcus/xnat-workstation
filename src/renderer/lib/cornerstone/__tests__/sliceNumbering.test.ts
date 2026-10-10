/**
 * Grid slice ↔ displayed slice (branch 1 S3): the map is linear through where the
 * viewport is now, forward or reversed.
 */
import { describe, expect, it } from 'vitest';
import { linearNumbering } from '../sliceNumbering';

describe('linearNumbering', () => {
  it('forward: display tracks the grid', () => {
    const n = linearNumbering(7, 7, 1);
    expect(n.toDisplay(9)).toBe(9);
    expect(n.toGrid(3)).toBe(3);
  });
  it('reversed: a 16-slice stack shown head-to-foot over a foot-to-head grid', () => {
    // The overlay showed "8 / 16" (index 7) while the grid slice was 8.
    const n = linearNumbering(7, 8, -1);
    expect(n.toDisplay(8)).toBe(7);
    expect(n.toDisplay(0)).toBe(15);
    expect(n.toDisplay(15)).toBe(0);
    expect(n.toGrid(n.toDisplay(11))).toBe(11);
  });
});
