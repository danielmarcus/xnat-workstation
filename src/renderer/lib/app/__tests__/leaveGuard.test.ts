import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  viewportIdsForContainer: vi.fn((_id: string): string[] => []),
  flushContainerSave: vi.fn(async (_id: string) => {}),
  getContainerSaveState: vi.fn((_id: string) => ({ dirty: false, inFlight: false })),
  removeSegmentation: vi.fn(),
}));

vi.mock('../../cornerstone/unifiedSegService', () => ({
  viewportIdsForContainer: (id: string) => m.viewportIdsForContainer(id),
}));
vi.mock('../../cornerstone/segmentationService', () => ({
  segmentationService: {
    flushContainerSave: (id: string) => m.flushContainerSave(id),
    getContainerSaveState: (id: string) => m.getContainerSaveState(id),
  },
}));
vi.mock('../../segmentation/segmentationManagerSingleton', () => ({
  segmentationManager: { removeSegmentation: (id: string) => m.removeSegmentation(id) },
}));
vi.mock('../../../stores/viewerStore', () => ({
  useViewerStore: { getState: () => ({ xnatContext: { sessionId: 'S1' }, sessionId: 'S1' }) },
}));

import { guardLoad, attachedContainers } from '../leaveGuard';
import { useSegmentationStore } from '../../../stores/segmentationStore';
import { useSegmentationManagerStore } from '../../../stores/segmentationManagerStore';
import { useLeavePromptStore } from '../../../stores/leavePromptStore';

function seed(segs: Array<{ id: string; label?: string; sessionId?: string; dirty?: boolean; on?: string[] }>) {
  useSegmentationStore.setState({
    segmentations: segs.map((s) => ({ segmentationId: s.id, label: s.label ?? s.id, segments: [] })) as never,
    xnatOriginMap: Object.fromEntries(
      segs.filter((s) => s.sessionId).map((s) => [s.id, { scanId: '3001', sourceScanId: '4', projectId: 'P', sessionId: s.sessionId }]),
    ) as never,
  });
  useSegmentationManagerStore.setState({
    dirtySegIds: Object.fromEntries(segs.filter((s) => s.dirty).map((s) => [s.id, true])),
  });
  m.viewportIdsForContainer.mockImplementation((id) => segs.find((s) => s.id === id)?.on ?? []);
}

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockClear());
  m.getContainerSaveState.mockImplementation(() => ({ dirty: false, inFlight: false }));
  useLeavePromptStore.setState({ request: null, busy: false, error: null });
});

/**
 * The seam between the pure decision (decideOrphans) and live state. Bugs in this
 * codebase have repeatedly lived here rather than in either side alone.
 */
describe('attachedContainers', () => {
  it('reads dirty, session and attachment for each loaded container', () => {
    seed([{ id: 'c1', label: 'Tumor', sessionId: 'S2', dirty: true, on: ['panel_0'] }]);
    expect(attachedContainers()).toEqual([
      { containerId: 'c1', label: 'Tumor', sessionId: 'S2', dirty: true, viewportIds: ['panel_0'] },
    ]);
  });

  it('attributes a never-saved container (no XNAT origin) to the session on screen', () => {
    seed([{ id: 'local', dirty: true, on: ['panel_0'] }]);
    expect(attachedContainers()[0].sessionId).toBe('S1');
  });

  it('treats an unreadable attachment as "still shown" rather than raising a prompt', () => {
    seed([{ id: 'c1', dirty: true, on: ['panel_0'] }]);
    m.viewportIdsForContainer.mockImplementation(() => { throw new Error('cornerstone'); });
    expect(attachedContainers()[0].viewportIds).not.toEqual([]);
  });
});

describe('guardLoad', () => {
  const load = { viewportId: 'panel_0', toSessionId: 'S1', fromSessionId: 'S1' };

  it('proceeds without a prompt when nothing is orphaned', async () => {
    seed([{ id: 'c1', dirty: true, on: ['panel_0', 'panel_1'] }]);
    expect(await guardLoad(load)).toBe('proceed');
    expect(useLeavePromptStore.getState().request).toBeNull();
    expect(m.removeSegmentation).not.toHaveBeenCalled();
  });

  it('unloads a clean orphan silently — no prompt', async () => {
    seed([{ id: 'c1', dirty: false, on: ['panel_0'] }]);
    expect(await guardLoad(load)).toBe('proceed');
    expect(m.removeSegmentation).toHaveBeenCalledWith('c1');
  });

  it('prompts with the container LABEL for a dirty orphan', async () => {
    seed([{ id: 'c1', label: 'Tumor', dirty: true, on: ['panel_0'] }]);
    const p = guardLoad(load, 'scan #4');
    await vi.waitFor(() => expect(useLeavePromptStore.getState().request).not.toBeNull());
    expect(useLeavePromptStore.getState().request).toMatchObject({
      entries: [{ containerId: 'c1', label: 'Tumor' }],
      leavingLabel: 'scan #4',
    });
    useLeavePromptStore.getState().choose('discard');
    await p;
  });

  it('cancel aborts the load and unloads nothing', async () => {
    seed([{ id: 'c1', dirty: true, on: ['panel_0'] }]);
    const p = guardLoad(load);
    await vi.waitFor(() => expect(useLeavePromptStore.getState().request).not.toBeNull());
    useLeavePromptStore.getState().choose('cancel');
    expect(await p).toBe('cancel');
    expect(m.removeSegmentation).not.toHaveBeenCalled();
  });

  it('discard unloads the orphan and proceeds', async () => {
    seed([{ id: 'c1', dirty: true, on: ['panel_0'] }]);
    const p = guardLoad(load);
    await vi.waitFor(() => expect(useLeavePromptStore.getState().request).not.toBeNull());
    useLeavePromptStore.getState().choose('discard');
    expect(await p).toBe('proceed');
    expect(m.removeSegmentation).toHaveBeenCalledWith('c1');
    expect(m.flushContainerSave).not.toHaveBeenCalled();
  });

  it('save flushes, then unloads and proceeds', async () => {
    seed([{ id: 'c1', dirty: true, on: ['panel_0'] }]);
    const p = guardLoad(load);
    await vi.waitFor(() => expect(useLeavePromptStore.getState().request).not.toBeNull());
    useLeavePromptStore.getState().choose('save');
    expect(await p).toBe('proceed');
    expect(m.flushContainerSave).toHaveBeenCalledWith('c1');
    expect(m.removeSegmentation).toHaveBeenCalledWith('c1');
  });

  it('a save that leaves the container dirty is a FAILED save — the load must not proceed', async () => {
    // flushContainerSave resolves either way: the save queue swallows the failure and
    // re-marks the container dirty. Reading the promise alone would let the load walk
    // over work that was never persisted.
    seed([{ id: 'c1', dirty: true, on: ['panel_0'] }]);
    m.getContainerSaveState.mockImplementation(() => ({ dirty: true, inFlight: false }));
    const p = guardLoad(load);
    await vi.waitFor(() => expect(useLeavePromptStore.getState().request).not.toBeNull());
    useLeavePromptStore.getState().choose('save');
    await vi.waitFor(() => expect(useLeavePromptStore.getState().error).toBeTruthy());
    expect(useLeavePromptStore.getState().request).not.toBeNull(); // still open
    expect(m.removeSegmentation).not.toHaveBeenCalled();
    useLeavePromptStore.getState().choose('discard');
    await p;
  });

  it('a session switch prompts for dirty work on ANY viewport, not just the one loaded into', async () => {
    seed([{ id: 'c1', label: 'Held', sessionId: 'S1', dirty: true, on: ['panel_1'] }]);
    const p = guardLoad({ viewportId: 'panel_0', toSessionId: 'S2', fromSessionId: 'S1' });
    await vi.waitFor(() => expect(useLeavePromptStore.getState().request).not.toBeNull());
    expect(useLeavePromptStore.getState().request?.entries[0].label).toBe('Held');
    useLeavePromptStore.getState().choose('discard');
    await p;
  });
});
