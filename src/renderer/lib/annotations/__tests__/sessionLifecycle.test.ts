import { describe, expect, it } from 'vitest';
import { decideSessionLifecycle, sessionsWithUnsaved, type LoadedContainerRef } from '../sessionLifecycle';

/**
 * Lifecycle track L1 — the pure A13 decision: what happens to each loaded container
 * when the viewer moves between sessions (or navigates scans within one). Verified
 * in isolation; the App/segmentationManager integration (L2) consumes it.
 */
const c = (containerId: string, sessionId: string, dirty = false): LoadedContainerRef => ({ containerId, sessionId, dirty });

describe('decideSessionLifecycle', () => {
  it('same session (scan-navigate within a session) keeps every container (panel preserved)', () => {
    const decisions = decideSessionLifecycle({
      fromSessionId: 'S1',
      toSessionId: 'S1',
      containers: [c('a', 'S1'), c('b', 'S1', true)],
    });
    expect(decisions.every((d) => d.disposition === 'keep')).toBe(true);
  });

  it('session switch: new-session containers kept; OTHER-session clean unloaded; OTHER-session dirty retained', () => {
    const decisions = decideSessionLifecycle({
      fromSessionId: 'S1',
      toSessionId: 'S2',
      containers: [
        c('newA', 'S2'), // belongs to the session being switched TO
        c('oldClean', 'S1', false), // other session, clean → unload
        c('oldDirty', 'S1', true), // other session, dirty → retain (don't lose unsaved work)
      ],
    });
    const by = Object.fromEntries(decisions.map((d) => [d.containerId, d.disposition]));
    expect(by.newA).toBe('keep');
    expect(by.oldClean).toBe('unload');
    expect(by.oldDirty).toBe('retain-unsaved');
  });

  it('first load (no prior session) keeps the new session and unloads/retains nothing spurious', () => {
    const decisions = decideSessionLifecycle({
      fromSessionId: null,
      toSessionId: 'S1',
      containers: [c('a', 'S1')],
    });
    expect(decisions).toEqual([{ containerId: 'a', disposition: 'keep' }]);
  });

  it('sessionsWithUnsaved lists the distinct sessions whose dirty containers are retained', () => {
    const containers = [c('a', 'S1', true), c('b', 'S1', true), c('c', 'S3', true), c('d', 'S2', false)];
    expect(sessionsWithUnsaved(containers, 'S2').sort()).toEqual(['S1', 'S3']);
    // dirty containers of the ACTIVE session aren't "other-session retained" → excluded
    expect(sessionsWithUnsaved([c('x', 'S2', true)], 'S2')).toEqual([]);
  });
});
