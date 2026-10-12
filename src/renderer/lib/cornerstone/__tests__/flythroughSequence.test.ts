/** Flythrough visiting order (branch 2 R4). */
import { describe, expect, it } from 'vitest';
import { flythroughSequence } from '../flythroughService';

describe('flythroughSequence', () => {
  it('forward / backward from the bounds', () => {
    expect(flythroughSequence(3, 6, 'forward', 'bounds', 0)).toEqual([3, 4, 5, 6]);
    expect(flythroughSequence(3, 6, 'backward', 'bounds', 0)).toEqual([6, 5, 4, 3]);
  });
  it('from the current slice, clamped into the bounds', () => {
    expect(flythroughSequence(3, 6, 'forward', 'current', 5)).toEqual([5, 6]);
    expect(flythroughSequence(3, 6, 'backward', 'current', 5)).toEqual([5, 4, 3]);
    expect(flythroughSequence(3, 6, 'forward', 'current', 99)).toEqual([6]);
  });
});
