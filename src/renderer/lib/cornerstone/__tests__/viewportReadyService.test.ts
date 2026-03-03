import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { viewportReadyService } from '../viewportReadyService';

describe('viewportReadyService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    viewportReadyService.removePanel('panel-a');
    viewportReadyService.removePanel('panel-b');
    viewportReadyService.removePanel('panel-c');
    viewportReadyService.removePanel('panel-d');
    viewportReadyService.removePanel('panel-e');
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('bumps epochs and rejects stale waiters', async () => {
    expect(viewportReadyService.getEpoch('panel-a')).toBe(0);
    const epoch1 = viewportReadyService.bumpEpoch('panel-a');
    expect(epoch1).toBe(1);

    const staleWait = viewportReadyService.whenReady('panel-a', 1, 10_000);
    const epoch2 = viewportReadyService.bumpEpoch('panel-a');
    expect(epoch2).toBe(2);

    await expect(staleWait).rejects.toThrow('Stale epoch for panel-a');
  });

  it('resolves immediately for already-ready epochs and rejects immediate stale requests', async () => {
    const epoch = viewportReadyService.bumpEpoch('panel-b');
    viewportReadyService.markReady('panel-b', epoch);

    await expect(viewportReadyService.whenReady('panel-b', epoch)).resolves.toBeUndefined();
    await expect(viewportReadyService.whenReady('panel-b', epoch - 1)).rejects.toThrow(
      'Stale epoch for panel-b',
    );
  });

  it('times out pending waiters with clear timeout error', async () => {
    const epoch = viewportReadyService.bumpEpoch('panel-c');
    const pending = viewportReadyService.whenReady('panel-c', epoch, 500);

    vi.advanceTimersByTime(500);
    await expect(pending).rejects.toThrow('Timeout waiting for panel-c epoch 1 after 500ms');
  });

  it('resolves matching waiters when markReady is called for that epoch', async () => {
    const epoch = viewportReadyService.bumpEpoch('panel-d');
    const p1 = viewportReadyService.whenReady('panel-d', epoch, 10_000);
    const p2 = viewportReadyService.whenReady('panel-d', epoch, 10_000);

    viewportReadyService.markReady('panel-d', epoch);

    await expect(Promise.all([p1, p2])).resolves.toEqual([undefined, undefined]);
  });

  it('rejects all pending waiters when the panel is removed', async () => {
    const epoch = viewportReadyService.bumpEpoch('panel-e');
    const pending = viewportReadyService.whenReady('panel-e', epoch, 10_000);

    viewportReadyService.removePanel('panel-e');

    await expect(pending).rejects.toThrow('Panel panel-e removed');
  });
});
