// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

/**
 * Change 1b — the renderer half of save-first-on-close. The full window-close
 * round-trip can't run under the E2E harness (closing the window ends the test),
 * so the decision logic is pinned here: no unsaved → reply 'proceed' silently;
 * unsaved → open the dialog; Save flushes every dirty container then proceeds;
 * Quit proceeds; Cancel replies 'cancel'.
 */
const flushContainerSave = vi.fn().mockResolvedValue(undefined);
const hasDirtySegmentations = vi.fn();
vi.mock('../lib/cornerstone/segmentationService', () => ({
  segmentationService: { flushContainerSave: (id: string) => flushContainerSave(id) },
}));
vi.mock('../lib/segmentation/segmentationManagerSingleton', () => ({
  segmentationManager: { hasDirtySegmentations: () => hasDirtySegmentations() },
}));

import { useAppCloseGuard } from './useAppCloseGuard';
import { useSegmentationStore } from '../stores/segmentationStore';
import { useSegmentationManagerStore } from '../stores/segmentationManagerStore';

let closeRequestedCb: (() => void) | null = null;
const sendCloseDecision = vi.fn();

beforeEach(() => {
  closeRequestedCb = null;
  sendCloseDecision.mockClear();
  flushContainerSave.mockClear();
  hasDirtySegmentations.mockReturnValue(false);
  useSegmentationStore.setState({ segmentations: [] });
  useSegmentationManagerStore.setState({ dirtySegIds: {} });
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    app: {
      onCloseRequested: (cb: () => void) => { closeRequestedCb = cb; return () => { closeRequestedCb = null; }; },
      sendCloseDecision: (d: 'proceed' | 'cancel') => sendCloseDecision(d),
    },
  };
});

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

function seedUnsaved(ids: string[]) {
  hasDirtySegmentations.mockReturnValue(true);
  useSegmentationStore.setState({ segmentations: ids.map((id) => ({ segmentationId: id })) as never });
  useSegmentationManagerStore.setState({ dirtySegIds: Object.fromEntries(ids.map((id) => [id, true])) });
}

describe('useAppCloseGuard', () => {
  it('no unsaved annotations → replies proceed immediately, no dialog', () => {
    const { result } = renderHook(() => useAppCloseGuard());
    act(() => closeRequestedCb?.());
    expect(sendCloseDecision).toHaveBeenCalledWith('proceed');
    expect(result.current.promptOpen).toBe(false);
  });

  it('unsaved annotations → opens the dialog with the unsaved count (no decision yet)', () => {
    seedUnsaved(['seg_1', 'seg_2']);
    const { result } = renderHook(() => useAppCloseGuard());
    act(() => closeRequestedCb?.());
    expect(result.current.promptOpen).toBe(true);
    expect(result.current.unsavedCount).toBe(2);
    expect(sendCloseDecision).not.toHaveBeenCalled();
  });

  it('Save & quit flushes every dirty container, then proceeds', async () => {
    seedUnsaved(['seg_1', 'seg_2']);
    const { result } = renderHook(() => useAppCloseGuard());
    act(() => closeRequestedCb?.());
    await act(async () => { result.current.onSaveAndQuit(); });
    expect(flushContainerSave).toHaveBeenCalledWith('seg_1');
    expect(flushContainerSave).toHaveBeenCalledWith('seg_2');
    expect(sendCloseDecision).toHaveBeenLastCalledWith('proceed');
    expect(result.current.promptOpen).toBe(false);
  });

  it('Quit without saving proceeds without flushing', () => {
    seedUnsaved(['seg_1']);
    const { result } = renderHook(() => useAppCloseGuard());
    act(() => closeRequestedCb?.());
    act(() => result.current.onQuitWithoutSaving());
    expect(flushContainerSave).not.toHaveBeenCalled();
    expect(sendCloseDecision).toHaveBeenLastCalledWith('proceed');
  });

  it('Cancel replies cancel and closes the dialog', () => {
    seedUnsaved(['seg_1']);
    const { result } = renderHook(() => useAppCloseGuard());
    act(() => closeRequestedCb?.());
    act(() => result.current.onCancel());
    expect(sendCloseDecision).toHaveBeenLastCalledWith('cancel');
    expect(result.current.promptOpen).toBe(false);
  });
});
