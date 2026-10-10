/** Slice-track runs (branch 1 S6): occupied slices collapse into inclusive runs. */
import { describe, expect, it } from 'vitest';
import { toRuns } from '../sliceTrack';

describe('toRuns', () => {
  it('collapses consecutive slices and keeps gaps', () => {
    expect(toRuns([2, 3, 4, 7, 9, 10])).toEqual([[2, 4], [7, 7], [9, 10]]);
    expect(toRuns([])).toEqual([]);
  });
});
