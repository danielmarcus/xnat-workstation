/** O8 (#97): jobs on different workers overlap; the bar shows the latest, then the one it covered. */
import { beforeEach, describe, expect, it } from 'vitest';
import { useComputeStore } from '../computeStore';

describe('computeStore', () => {
  beforeEach(() => useComputeStore.setState({ job: null, jobs: [] }));

  it('shows the latest job; when it ends, the one still running is shown again with its progress', () => {
    const s = () => useComputeStore.getState();
    const solve = s().start('Fast GrowCut', 'panel_0');
    s().progress(0.3, solve);
    const clean = s().start('Fill holes', 'panel_0', undefined, 'cleanup');
    expect(s().job?.label).toBe('Fill holes');
    s().progress(0.6, solve);
    expect(s().job?.fraction).toBe(0);
    s().end(clean);
    expect(s().job).toMatchObject({ label: 'Fast GrowCut', fraction: 0.6 });
    s().end(solve);
    expect(s().job).toBeNull();
    s().end(solve); // a late end is harmless
    expect(s().jobs).toEqual([]);
  });
});
