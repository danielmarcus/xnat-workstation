import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestLeaveDecision, useLeavePromptStore } from './leavePromptStore';

const entries = [{ containerId: 'c1', label: 'Tumor' }];

beforeEach(() => useLeavePromptStore.setState({ request: null, busy: false, error: null }));

/**
 * The bridge between an async load and a modal decision (proposal §4.2). The load asks
 * "may I proceed?" and awaits; the dialog owns the save-and-retry loop, so the caller
 * never has to re-open it after a failed upload.
 */
describe('requestLeaveDecision', () => {
  it('opens the dialog with the entries and stays pending until the user chooses', async () => {
    const p = requestLeaveDecision({ entries, leavingLabel: 'scan 4', save: vi.fn() });
    expect(useLeavePromptStore.getState().request).toMatchObject({ entries, leavingLabel: 'scan 4' });
    let settled = false;
    void p.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    useLeavePromptStore.getState().choose('cancel');
    expect(await p).toBe('cancel');
  });

  it('cancel closes the dialog and refuses the load', async () => {
    const save = vi.fn();
    const p = requestLeaveDecision({ entries, save });
    useLeavePromptStore.getState().choose('cancel');
    expect(await p).toBe('cancel');
    expect(save).not.toHaveBeenCalled();
    expect(useLeavePromptStore.getState().request).toBeNull();
  });

  it('discard proceeds without saving', async () => {
    const save = vi.fn();
    const p = requestLeaveDecision({ entries, save });
    useLeavePromptStore.getState().choose('discard');
    expect(await p).toBe('discard');
    expect(save).not.toHaveBeenCalled();
    expect(useLeavePromptStore.getState().request).toBeNull();
  });

  it('save runs the save, then proceeds', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const p = requestLeaveDecision({ entries, save });
    useLeavePromptStore.getState().choose('save');
    expect(await p).toBe('save');
    expect(save).toHaveBeenCalledWith(['c1']);
    expect(useLeavePromptStore.getState().request).toBeNull();
  });

  it('a failed save keeps the dialog open with the error — the load must not proceed', async () => {
    const save = vi.fn().mockRejectedValue(new Error('Upload failed'));
    const p = requestLeaveDecision({ entries, save });
    useLeavePromptStore.getState().choose('save');
    await vi.waitFor(() => expect(useLeavePromptStore.getState().error).toMatch(/Upload failed/));
    expect(useLeavePromptStore.getState().request).not.toBeNull();
    expect(useLeavePromptStore.getState().busy).toBe(false);
    // ...and a retry that succeeds resolves the same promise.
    save.mockResolvedValue(undefined);
    useLeavePromptStore.getState().choose('save');
    expect(await p).toBe('save');
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('ignores a second choice while a save is in flight', async () => {
    let release: () => void = () => {};
    const save = vi.fn(() => new Promise<void>((r) => { release = r; }));
    const p = requestLeaveDecision({ entries, save });
    useLeavePromptStore.getState().choose('save');
    await vi.waitFor(() => expect(useLeavePromptStore.getState().busy).toBe(true));
    useLeavePromptStore.getState().choose('discard'); // must not slip past the in-flight save
    release();
    expect(await p).toBe('save');
    expect(save).toHaveBeenCalledTimes(1);
  });
});
