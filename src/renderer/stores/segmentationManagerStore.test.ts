import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSegmentationManagerStore } from './segmentationManagerStore';

function resetStore(): void {
  useSegmentationManagerStore.setState(useSegmentationManagerStore.getInitialState(), true);
}

describe('useSegmentationManagerStore', () => {
  beforeEach(() => {
    resetStore();
  });

  it('preserves desired overlays when source scan is unchanged and clears when changed', () => {
    useSegmentationManagerStore.getState().setPanelSourceScan('panel_0', '10', 1);
    useSegmentationManagerStore.getState().setDesiredOverlays('panel_0', ['segA']);

    useSegmentationManagerStore.getState().setPanelSourceScan('panel_0', '10', 2);
    expect(useSegmentationManagerStore.getState().panelState.panel_0?.desiredOverlayIds).toEqual(['segA']);

    useSegmentationManagerStore.getState().setPanelSourceScan('panel_0', '11', 3);
    expect(useSegmentationManagerStore.getState().panelState.panel_0?.desiredOverlayIds).toEqual([]);
  });

  it('initializes panel defaults in setDesiredOverlays when panel is missing', () => {
    useSegmentationManagerStore.getState().setDesiredOverlays('panel_9', ['segX', 'segY']);

    expect(useSegmentationManagerStore.getState().panelState.panel_9).toEqual({
      sourceScanId: null,
      epoch: 0,
      desiredOverlayIds: ['segX', 'segY'],
    });
  });

  it('merges presentation patches without clobbering other segment indices', () => {
    useSegmentationManagerStore.getState().setPresentation('segA', 1, {
      color: [1, 2, 3, 4],
      visible: true,
    });
    useSegmentationManagerStore.getState().setPresentation('segA', 2, {
      locked: true,
    });
    useSegmentationManagerStore.getState().setPresentation('segA', 1, {
      locked: false,
    });

    const presentation = useSegmentationManagerStore.getState().presentation.segA;
    expect(presentation?.color[1]).toEqual([1, 2, 3, 4]);
    expect(presentation?.visibility[1]).toBe(true);
    expect(presentation?.locked[1]).toBe(false);
    expect(presentation?.locked[2]).toBe(true);
  });

  it('tracks dirty lifecycle and records manual save timestamp', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1710000000000);

    useSegmentationManagerStore.getState().markDirty('segA');
    expect(useSegmentationManagerStore.getState().hasDirtySegmentations()).toBe(true);

    useSegmentationManagerStore.getState().recordManualSave('segA');
    expect(useSegmentationManagerStore.getState().hasDirtySegmentations()).toBe(false);
    expect(useSegmentationManagerStore.getState().lastManualSaveAt.segA).toBe(1710000000000);

    nowSpy.mockRestore();
  });

  it('clears panel-specific state and fully resets', () => {
    useSegmentationManagerStore.getState().setPanelSourceScan('panel_1', '10', 1);
    useSegmentationManagerStore.getState().setActiveSegmentationForPanel('panel_1', 'segA');
    useSegmentationManagerStore.getState().setActiveSegmentIndexForPanel('panel_1', 4);

    useSegmentationManagerStore.getState().clearPanel('panel_1');
    expect(useSegmentationManagerStore.getState().panelState.panel_1).toBeUndefined();
    expect(useSegmentationManagerStore.getState().activeSegmentationIdByPanel.panel_1).toBeUndefined();
    expect(useSegmentationManagerStore.getState().activeSegmentIndexByPanel.panel_1).toBeUndefined();

    useSegmentationManagerStore.getState().markDirty('segA');
    expect(useSegmentationManagerStore.getState().dirtySegIds.segA).toBe(true);

    useSegmentationManagerStore.getState().reset();
    const state = useSegmentationManagerStore.getState();
    expect(state.panelState).toEqual({});
    expect(state.dirtySegIds).toEqual({});
    expect(state.loadStatus).toEqual({});
  });
});
