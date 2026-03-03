import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSegmentationManagerStore } from './segmentationManagerStore';
import { useSegmentationStore } from './segmentationStore';

function resetStores(): void {
  useSegmentationStore.setState(useSegmentationStore.getInitialState(), true);
  useSegmentationManagerStore.setState(useSegmentationManagerStore.getInitialState(), true);
}

describe('useSegmentationStore', () => {
  beforeEach(() => {
    resetStores();
  });

  it('syncs segmentations and prunes stale dicom type entries', () => {
    useSegmentationStore.getState().setDicomType('seg-1', 'SEG');
    useSegmentationStore.getState().setDicomType('seg-2', 'RTSTRUCT');

    useSegmentationStore.getState()._sync([
      { segmentationId: 'seg-1', label: 'Liver', segments: [], isActive: true },
    ]);

    const state = useSegmentationStore.getState();
    expect(state.segmentations).toHaveLength(1);
    expect(state.segmentations[0]?.segmentationId).toBe('seg-1');
    expect(state.dicomTypeBySegmentationId).toEqual({ 'seg-1': 'SEG' });
  });

  it('applies toggle and set actions deterministically', () => {
    useSegmentationStore.getState().toggleOutline();
    expect(useSegmentationStore.getState().renderOutline).toBe(false);
    useSegmentationStore.getState().setRenderOutline(true);
    expect(useSegmentationStore.getState().renderOutline).toBe(true);

    useSegmentationStore.getState().togglePanel();
    expect(useSegmentationStore.getState().showPanel).toBe(true);
    useSegmentationStore.getState().setAutoSaveEnabled(false);
    expect(useSegmentationStore.getState().autoSaveEnabled).toBe(false);

    useSegmentationStore.getState().setShowViewportContextOverlay(false);
    expect(useSegmentationStore.getState().showViewportContextOverlay).toBe(false);

    useSegmentationStore.getState().setShowViewportContextOverlay(true);
    expect(useSegmentationStore.getState().showViewportContextOverlay).toBe(true);
  });

  it('sets auto-save timestamps only on saved status', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);

    useSegmentationStore.getState()._setAutoSaveStatus('saving');
    expect(useSegmentationStore.getState().lastAutoSaveTime).toBeNull();

    useSegmentationStore.getState()._setAutoSaveStatus('saved');
    expect(useSegmentationStore.getState().lastAutoSaveTime).toBe(1700000000000);

    nowSpy.mockRestore();
  });

  it('markClean clears unsaved state and syncs manager dirty flags', async () => {
    useSegmentationManagerStore.getState().markDirty('seg-1');
    useSegmentationStore.getState()._markDirty();

    expect(useSegmentationStore.getState().hasUnsavedChanges).toBe(true);
    expect(useSegmentationManagerStore.getState().hasDirtySegmentations()).toBe(true);

    useSegmentationStore.getState()._markClean();
    expect(useSegmentationStore.getState().hasUnsavedChanges).toBe(false);

    for (let i = 0; i < 20; i += 1) {
      if (!useSegmentationManagerStore.getState().hasDirtySegmentations()) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(useSegmentationManagerStore.getState().hasDirtySegmentations()).toBe(false);
  });
});
