/** Smart Brush (branch 4): paints the tissue under the brush and not across a boundary. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SMART_BRUSH, smartBrushStroke, strokeDabs } from '../smartBrush';

const W = 40;
const H = 40;
// Left half 100 HU, right half 400 HU.
const image = Float32Array.from({ length: W * H }, (_, i) => ((i % W) < 20 ? 100 : 400));

describe('smartBrushStroke', () => {
  it('a stroke along the boundary paints only the side it started on', () => {
    const m = smartBrushStroke(image, W, H, [[17, 5], [17, 35]], { ...DEFAULT_SMART_BRUSH, radiusPx: 6 });
    let left = 0, right = 0;
    for (let i = 0; i < m.length; i++) if (m[i]) ((i % W) < 20 ? left++ : right++);
    expect(left).toBeGreaterThan(100);
    expect(right).toBe(0);
  });

  it('with a wide tolerance it behaves like an ordinary round brush', () => {
    const m = smartBrushStroke(image, W, H, [[17, 20]], { ...DEFAULT_SMART_BRUSH, radiusPx: 5, tolerance: 1000 });
    const n = m.reduce((s, v) => s + v, 0);
    expect(n).toBeGreaterThan(70); // ≈ π·5²
    expect(n).toBeLessThan(90);
  });

  it('dabs are spaced along the drag, endpoints included', () => {
    const d = strokeDabs([[0, 0], [10, 0]], 2);
    expect(d[0]).toEqual([0, 0]);
    expect(d[d.length - 1]).toEqual([10, 0]);
    expect(d).toHaveLength(6);
  });
});
