import { describe, expect, it } from 'vitest';
import { buildRulerSpec, formatLengthMm, pickNiceMm } from './rulerSpec';

describe('pickNiceMm', () => {
  it('rounds up to a 1/2/5 × 10ⁿ value', () => {
    expect(pickNiceMm(0.7)).toBe(1);
    expect(pickNiceMm(1.5)).toBe(2);
    expect(pickNiceMm(3)).toBe(5);
    expect(pickNiceMm(8)).toBe(10);
    expect(pickNiceMm(41)).toBe(50);
    expect(pickNiceMm(120)).toBe(200);
  });
  it('guards bad input', () => {
    expect(pickNiceMm(0)).toBe(0);
    expect(pickNiceMm(-5)).toBe(0);
  });
});

describe('formatLengthMm', () => {
  it('uses mm under 100 and cm at/above 100', () => {
    expect(formatLengthMm(5)).toBe('5.0 mm');
    expect(formatLengthMm(20)).toBe('20 mm');
    expect(formatLengthMm(50)).toBe('50 mm');
    expect(formatLengthMm(100)).toBe('10 cm');
    expect(formatLengthMm(150)).toBe('15 cm');
  });
});

describe('buildRulerSpec', () => {
  it('produces a nice round bar within the available space', () => {
    // 0.5 mm/px, target 160px ⇒ ~80mm raw ⇒ nice 100mm ⇒ 200px ≤ max 280 ⇒ "10 cm".
    const spec = buildRulerSpec(0.5, 280, 160);
    expect(spec).not.toBeNull();
    expect(spec!.label).toBe('10 cm');
    expect(spec!.lengthPx).toBeCloseTo(200, 5);
    expect(spec!.tickCount).toBeGreaterThan(0);
  });

  it('shrinks the bar when the nice length would overflow maxLengthPx', () => {
    // 2 mm/px, target 160 ⇒ 320mm raw ⇒ nice 500mm ⇒ 250px ≤ 280 ⇒ keeps; but a
    // tighter max forces a smaller nice value.
    const spec = buildRulerSpec(2, 120, 160);
    expect(spec).not.toBeNull();
    expect(spec!.lengthPx).toBeLessThanOrEqual(120);
  });

  it('returns null for an invalid scale or no room', () => {
    expect(buildRulerSpec(0, 280, 160)).toBeNull();
    expect(buildRulerSpec(0.5, 20, 160)).toBeNull();
  });
});
