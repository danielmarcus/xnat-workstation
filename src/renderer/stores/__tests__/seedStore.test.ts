/** Restore seeds is per segmentation (S10.8, #100): it must not overwrite another one's seeds. */
import { beforeEach, describe, expect, it } from 'vitest';
import { useSeedStore, type SeedStroke } from '../seedStore';

const stroke = (containerId: string, x: number): SeedStroke => ({ containerId, viewportId: 'panel_0', cls: 1, radiusMm: 2, points: [[x, 0, 0]] });

describe('seedStore Restore seeds', () => {
  beforeEach(() => useSeedStore.setState({ strokes: [], lastRun: {} }));

  it('restores the run container’s seeds and keeps every other container’s current seeds', () => {
    const s = useSeedStore.getState();
    s.addStroke(stroke('A', 1));
    s.addStroke(stroke('B', 2));
    s.snapshotForRun('A');
    s.clear('A');
    s.addStroke(stroke('B', 3)); // B is seeded on after A's run
    s.snapshotForRun('B');
    s.addStroke(stroke('B', 4));
    useSeedStore.getState().restore('A');
    const xs = (id: string) => useSeedStore.getState().strokes.filter((x) => x.containerId === id).map((x) => x.points[0][0]);
    expect(xs('A')).toEqual([1]);
    expect(xs('B'), 'B keeps its seeds').toEqual([2, 3, 4]);
    useSeedStore.getState().restore('B');
    expect(xs('B'), 'B’s own last run').toEqual([2, 3]);
    expect(xs('A')).toEqual([1]);
  });
});
