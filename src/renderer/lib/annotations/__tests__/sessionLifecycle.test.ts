import { describe, expect, it } from 'vitest';
import {
  decideOrphans,
  containersNeedingDecision,
  sessionsWithUnsaved,
  type LoadedContainerRef,
} from '../sessionLifecycle';

const c = (containerId: string, sessionId: string, dirty = false): LoadedContainerRef => ({ containerId, sessionId, dirty });

describe('decideOrphans', () => {
  const load = { viewportId: 'panel_0', toSessionId: 'S1', fromSessionId: 'S1' };

  it('keeps a container that still renders on another viewport after the load', () => {
    const d = decideOrphans({
      load,
      containers: [{ containerId: 'c1', sessionId: 'S1', dirty: true, viewportIds: ['panel_0', 'panel_1'] }],
    });
    expect(d).toEqual([{ containerId: 'c1', disposition: 'keep' }]);
  });

  it('prompts for a DIRTY container whose last viewport is being replaced', () => {
    const d = decideOrphans({
      load,
      containers: [{ containerId: 'c1', sessionId: 'S1', dirty: true, viewportIds: ['panel_0'] }],
    });
    expect(d).toEqual([{ containerId: 'c1', disposition: 'prompt' }]);
  });

  it('unloads a CLEAN container whose last viewport is being replaced — nothing to lose', () => {
    const d = decideOrphans({
      load,
      containers: [{ containerId: 'c1', sessionId: 'S1', dirty: false, viewportIds: ['panel_0'] }],
    });
    expect(d).toEqual([{ containerId: 'c1', disposition: 'unload' }]);
  });

  it('GH #75: loading into a viewport that holds nothing orphans no one', () => {
    const d = decideOrphans({
      load: { viewportId: 'panel_1', toSessionId: 'S1', fromSessionId: 'S1' },
      containers: [{ containerId: 'c1', sessionId: 'S1', dirty: true, viewportIds: ['panel_0'] }],
    });
    expect(d).toEqual([{ containerId: 'c1', disposition: 'keep' }]);
  });

  it('a session switch orphans every container of the session being left, on any viewport', () => {
    const d = decideOrphans({
      load: { viewportId: 'panel_0', toSessionId: 'S2', fromSessionId: 'S1' },
      containers: [
        { containerId: 'oldDirty', sessionId: 'S1', dirty: true, viewportIds: ['panel_1'] },
        { containerId: 'oldClean', sessionId: 'S1', dirty: false, viewportIds: ['panel_1'] },
        { containerId: 'newOne', sessionId: 'S2', dirty: true, viewportIds: ['panel_1'] },
      ],
    });
    expect(d).toEqual([
      { containerId: 'oldDirty', disposition: 'prompt' },
      { containerId: 'oldClean', disposition: 'unload' },
      { containerId: 'newOne', disposition: 'keep' },
    ]);
  });

  it('first load (no session yet) is not a switch — it orphans nothing', () => {
    const d = decideOrphans({
      load: { viewportId: 'panel_0', toSessionId: 'S1', fromSessionId: null },
      containers: [{ containerId: 'local', sessionId: '', dirty: true, viewportIds: ['panel_1'] }],
    });
    expect(d).toEqual([{ containerId: 'local', disposition: 'keep' }]);
  });

  it('a container attached to no viewport is already invisible — it is not "leaving"', () => {
    const d = decideOrphans({
      load,
      containers: [{ containerId: 'detached', sessionId: 'S1', dirty: true, viewportIds: [] }],
    });
    expect(d).toEqual([{ containerId: 'detached', disposition: 'keep' }]);
  });

  it('containersNeedingDecision lists only the prompts', () => {
    const decisions = decideOrphans({
      load,
      containers: [
        { containerId: 'c1', sessionId: 'S1', dirty: true, viewportIds: ['panel_0'] },
        { containerId: 'c2', sessionId: 'S1', dirty: false, viewportIds: ['panel_0'] },
        { containerId: 'c3', sessionId: 'S1', dirty: true, viewportIds: ['panel_1'] },
      ],
    });
    expect(containersNeedingDecision(decisions)).toEqual(['c1']);
  });
});

describe('decideOrphans — an overlay load replaces nothing', () => {
  it('a derived scan loading as an overlay (viewportId null) orphans no one', () => {
    const d = decideOrphans({
      load: { viewportId: null, toSessionId: 'S1', fromSessionId: 'S1' },
      containers: [{ containerId: 'c1', sessionId: 'S1', dirty: true, viewportIds: ['panel_0'] }],
    });
    expect(d).toEqual([{ containerId: 'c1', disposition: 'keep' }]);
  });

  it('...but a session switch still orphans, overlay or not', () => {
    const d = decideOrphans({
      load: { viewportId: null, toSessionId: 'S2', fromSessionId: 'S1' },
      containers: [{ containerId: 'c1', sessionId: 'S1', dirty: true, viewportIds: ['panel_0'] }],
    });
    expect(d).toEqual([{ containerId: 'c1', disposition: 'prompt' }]);
  });
});
