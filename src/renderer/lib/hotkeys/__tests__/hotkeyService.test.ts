import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HotkeyMap } from '@shared/types/hotkeys';
import { dispatchKey, makeDivTarget, makeInputTarget } from '../../../test/hotkeys/keyboard';
import { HOTKEY_ACTIONS, TEST_HOTKEY_MAP } from '../../../test/hotkeys/hotkeyFixtures';

const viewerState = {
  activeViewportId: 'panel_0',
  layoutConfig: { rows: 2, cols: 2, panelCount: 4 },
  viewports: {
    panel_0: {
      totalImages: 10,
      imageIndex: 2,
      requestedImageIndex: null as number | null,
    },
  } as Record<string, { totalImages: number; imageIndex: number; requestedImageIndex: number | null }>,
  panelOrientationMap: {} as Record<string, 'STACK' | 'AXIAL' | 'SAGITTAL' | 'CORONAL'>,
  setActiveTool: vi.fn(),
  setLayout: vi.fn(),
  resetViewport: vi.fn(),
  toggleInvert: vi.fn(),
  rotate90: vi.fn(),
  flipH: vi.fn(),
  flipV: vi.fn(),
  toggleCine: vi.fn(),
  setActiveViewport: vi.fn(),
  applyWLPreset: vi.fn(),
  setPanelOrientation: vi.fn((panelId: string, next: 'STACK' | 'AXIAL' | 'SAGITTAL' | 'CORONAL') => {
    viewerState.panelOrientationMap[panelId] = next;
  }),
  _requestImageIndex: vi.fn((panelId: string, index: number) => {
    const panel = viewerState.viewports[panelId];
    if (panel) panel.requestedImageIndex = index;
  }),
};

const segmentationState = {
  showPanel: false,
  brushSize: 5,
  togglePanel: vi.fn(() => {
    segmentationState.showPanel = !segmentationState.showPanel;
  }),
  setBrushSize: vi.fn((size: number) => {
    segmentationState.brushSize = size;
  }),
};

const annotationState = {
  togglePanel: vi.fn(),
};

const viewportServiceMock = {
  zoomBy: vi.fn(),
  scrollToIndex: vi.fn(),
};

const segmentationServiceMock = {
  setBrushSize: vi.fn(),
  undo: vi.fn(),
  redo: vi.fn(),
  copySelectedContourAnnotation: vi.fn(() => true),
  pasteCopiedContourAnnotationToActiveSlice: vi.fn(() => true),
  deleteSelectedContourComponents: vi.fn(),
};

let hotkeyService: (typeof import('../hotkeyService'))['hotkeyService'];

beforeAll(async () => {
  vi.doMock('../../../stores/viewerStore', () => ({
    useViewerStore: {
      getState: () => viewerState,
    },
  }));
  vi.doMock('../../../stores/segmentationStore', () => ({
    useSegmentationStore: {
      getState: () => segmentationState,
    },
  }));
  vi.doMock('../../../stores/annotationStore', () => ({
    useAnnotationStore: {
      getState: () => annotationState,
    },
  }));
  vi.doMock('../../cornerstone/viewportService', () => ({ viewportService: viewportServiceMock }));
  vi.doMock('../../cornerstone/segmentationService', () => ({ segmentationService: segmentationServiceMock }));

  ({ hotkeyService } = await import('../hotkeyService'));
});

function resetState(): void {
  viewerState.activeViewportId = 'panel_0';
  viewerState.layoutConfig = { rows: 2, cols: 2, panelCount: 4 };
  viewerState.viewports.panel_0 = { totalImages: 10, imageIndex: 2, requestedImageIndex: null };
  viewerState.panelOrientationMap = {};
  segmentationState.showPanel = false;
  segmentationState.brushSize = 5;
  hotkeyService.setHotkeyMap({});
  hotkeyService.uninstall();
  vi.clearAllMocks();
}

describe('hotkeyService', () => {
  beforeEach(() => {
    resetState();
  });

  afterEach(() => {
    hotkeyService.uninstall();
    document.body.innerHTML = '';
  });

  it('normalizes modified letter keys and special keys deterministically', () => {
    hotkeyService.setHotkeyMap(TEST_HOTKEY_MAP);
    hotkeyService.install();

    dispatchKey({ key: 'k', ctrl: true, shift: true });
    expect(viewportServiceMock.zoomBy).toHaveBeenCalledWith('panel_0', 1.2);

    dispatchKey({ key: 'ArrowDown' });
    expect(viewerState._requestImageIndex).toHaveBeenCalledWith('panel_0', 3, 10);
    expect(viewportServiceMock.scrollToIndex).toHaveBeenCalledWith('panel_0', 3);

    dispatchKey({ key: 'PageDown' });
    expect(viewportServiceMock.scrollToIndex).toHaveBeenCalledWith('panel_0', 4);
  });

  it('ignores non-Tab hotkeys in form controls and contentEditable elements', () => {
    hotkeyService.setHotkeyMap({
      [HOTKEY_ACTIONS.toggleAnnotations]: [{ key: 'a' }],
      [HOTKEY_ACTIONS.cycleViewport]: [{ key: 'Tab' }],
    });
    hotkeyService.install();

    dispatchKey({ key: 'a', target: makeInputTarget('INPUT') });
    dispatchKey({ key: 'a', target: makeInputTarget('TEXTAREA') });
    dispatchKey({ key: 'a', target: makeInputTarget('SELECT') });
    dispatchKey({ key: 'a', target: makeDivTarget({ contentEditable: true }) });

    expect(annotationState.togglePanel).not.toHaveBeenCalled();
    expect(viewerState.setActiveViewport).not.toHaveBeenCalled();

    dispatchKey({ key: 'Tab', target: makeInputTarget('INPUT') });
    expect(viewerState.setActiveViewport).toHaveBeenCalled();
  });

  it('installs/removes a single global listener and avoids double-registration', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    hotkeyService.install();
    hotkeyService.install();

    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function), { capture: true });

    hotkeyService.uninstall();
    hotkeyService.uninstall();

    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function), { capture: true });
  });

  it('dispatches mapped actions and prevents default when handled', () => {
    hotkeyService.setHotkeyMap({
      'viewport.zoomOut': [{ key: '-' }],
    });
    hotkeyService.install();

    const event = dispatchKey({ key: '-' });

    expect(viewportServiceMock.zoomBy).toHaveBeenCalledWith('panel_0', 1 / 1.2);
    expect(event.defaultPrevented).toBe(true);
  });

  it('merges overrides and supports restoring defaults via setHotkeyMap', () => {
    const defaults: HotkeyMap = {
      'viewport.zoomIn': [{ key: 'x' }],
    };

    hotkeyService.setHotkeyMap(defaults);
    hotkeyService.mergeOverrides({
      'viewport.zoomIn': [{ key: 'y' }],
    });
    hotkeyService.install();

    dispatchKey({ key: 'x' });
    expect(viewportServiceMock.zoomBy).not.toHaveBeenCalled();

    dispatchKey({ key: 'y' });
    expect(viewportServiceMock.zoomBy).toHaveBeenCalledWith('panel_0', 1.2);

    viewportServiceMock.zoomBy.mockClear();
    hotkeyService.setHotkeyMap(defaults);

    dispatchKey({ key: 'x' });
    expect(viewportServiceMock.zoomBy).toHaveBeenCalledWith('panel_0', 1.2);

    viewportServiceMock.zoomBy.mockClear();
    dispatchKey({ key: 'y' });
    expect(viewportServiceMock.zoomBy).not.toHaveBeenCalled();
  });

  it('dispatches tool/layout/viewport/edit/brush/panel/preset actions', () => {
    hotkeyService.setHotkeyMap({
      'tool.pan': [{ key: '1' }],
      'layout.2x2': [{ key: '2' }],
      'viewport.reset': [{ key: '3' }],
      'viewport.toggleInvert': [{ key: '4' }],
      'viewport.rotate90': [{ key: '5' }],
      'viewport.flipH': [{ key: '6' }],
      'viewport.flipV': [{ key: '7' }],
      'viewport.toggleCine': [{ key: '8' }],
      'panel.toggleSegmentation': [{ key: '9' }],
      'edit.undo': [{ key: 'u' }],
      'edit.redo': [{ key: 'r' }],
      'edit.copy': [{ key: 'c', modifiers: { ctrl: true } }],
      'edit.paste': [{ key: 'v', modifiers: { ctrl: true } }],
      'edit.delete': [{ key: 'Delete' }],
      'brush.increase': [{ key: '=' }],
      'brush.decrease': [{ key: '[' }],
      'preset.wl.0': [{ key: '0' }],
    });
    hotkeyService.install();

    dispatchKey({ key: '1' });
    dispatchKey({ key: '2' });
    dispatchKey({ key: '3' });
    dispatchKey({ key: '4' });
    dispatchKey({ key: '5' });
    dispatchKey({ key: '6' });
    dispatchKey({ key: '7' });
    dispatchKey({ key: '8' });
    dispatchKey({ key: '9' });
    dispatchKey({ key: 'u' });
    dispatchKey({ key: 'r' });
    dispatchKey({ key: 'c', ctrl: true });
    dispatchKey({ key: 'v', ctrl: true });
    dispatchKey({ key: 'Delete' });
    dispatchKey({ key: '=' });
    dispatchKey({ key: '[' });
    dispatchKey({ key: '0' });

    expect(viewerState.setActiveTool).toHaveBeenCalled();
    expect(viewerState.setLayout).toHaveBeenCalledWith('2x2');
    expect(viewerState.resetViewport).toHaveBeenCalledTimes(1);
    expect(viewerState.toggleInvert).toHaveBeenCalledTimes(1);
    expect(viewerState.rotate90).toHaveBeenCalledTimes(1);
    expect(viewerState.flipH).toHaveBeenCalledTimes(1);
    expect(viewerState.flipV).toHaveBeenCalledTimes(1);
    expect(viewerState.toggleCine).toHaveBeenCalledTimes(1);
    expect(segmentationState.togglePanel).toHaveBeenCalledTimes(1);
    expect(segmentationServiceMock.undo).toHaveBeenCalledTimes(1);
    expect(segmentationServiceMock.redo).toHaveBeenCalledTimes(1);
    expect(segmentationServiceMock.copySelectedContourAnnotation).toHaveBeenCalledTimes(1);
    expect(segmentationServiceMock.pasteCopiedContourAnnotationToActiveSlice).toHaveBeenCalledTimes(1);
    expect(segmentationServiceMock.deleteSelectedContourComponents).toHaveBeenCalledTimes(1);
    expect(segmentationServiceMock.setBrushSize).toHaveBeenCalled();
    expect(segmentationState.setBrushSize).toHaveBeenCalled();
    expect(viewerState.applyWLPreset).toHaveBeenCalledTimes(1);
  });

  it('handles stack slice navigation through viewportService.scrollToIndex (Phase 6.4: MPR is just a layout, slice nav unified)', () => {
    hotkeyService.setHotkeyMap({
      'slice.prev': [{ key: 'ArrowUp' }],
      'slice.next': [{ key: 'ArrowDown' }],
      'slice.first': [{ key: 'Home' }],
      'slice.last': [{ key: 'End' }],
      'slice.nextPage': [{ key: 'PageDown' }],
    });
    hotkeyService.install();

    viewerState.viewports.panel_0 = { totalImages: 10, imageIndex: 0, requestedImageIndex: null };
    dispatchKey({ key: 'ArrowUp' });
    // Already at slice 0; no scroll. (delta=-1, clamped to 0, no-op.)
    expect(viewportServiceMock.scrollToIndex).not.toHaveBeenCalled();

    dispatchKey({ key: 'End' });
    expect(viewportServiceMock.scrollToIndex).toHaveBeenCalledWith('panel_0', 9);
  });

  it('does not prevent default for unmapped/unknown actions', () => {
    hotkeyService.setHotkeyMap({
      ['unknown.action' as any]: [{ key: 'q' }],
    } as HotkeyMap);
    hotkeyService.install();

    const event = dispatchKey({ key: 'q' });
    expect(event.defaultPrevented).toBe(false);
  });

  // ─── Spec §6.2 — new action bindings ─────────────────────────

  it('viewport.cycleMpr cycles STACK → AXIAL via setPanelOrientation', () => {
    hotkeyService.setHotkeyMap({
      'viewport.cycleMpr': [{ key: 'm' }],
    });
    hotkeyService.install();
    dispatchKey({ key: 'm' });
    expect(viewerState.setPanelOrientation).toHaveBeenCalledWith('panel_0', 'AXIAL');
  });

  it('viewport.cycleMpr from CORONAL wraps back to STACK', () => {
    viewerState.panelOrientationMap['panel_0'] = 'CORONAL';
    hotkeyService.setHotkeyMap({
      'viewport.cycleMpr': [{ key: 'm' }],
    });
    hotkeyService.install();
    dispatchKey({ key: 'm' });
    expect(viewerState.setPanelOrientation).toHaveBeenCalledWith('panel_0', 'STACK');
  });

  it.each([
    ['save.activeContainer', 's', { ctrl: true }, 'xnat-hotkey:save-active'],
    ['save.all',             's', { ctrl: true, shift: true }, 'xnat-hotkey:save-all'],
    ['panel.toggleTags',     't', { shift: true }, 'xnat-hotkey:toggle-tags'],
    ['app.openSettings',     ',', { ctrl: true }, 'xnat-hotkey:open-settings'],
    ['app.showCheatsheet',   '?', {},             'xnat-hotkey:show-cheatsheet'],
  ])('%s dispatches the matching window CustomEvent', (action, key, mods, eventName) => {
    hotkeyService.setHotkeyMap({
      [action as any]: [{ key, modifiers: mods }],
    } as HotkeyMap);
    hotkeyService.install();
    const received: string[] = [];
    const listener = (e: Event) => { received.push(e.type); };
    window.addEventListener(eventName, listener);
    dispatchKey({ key, ...mods } as any);
    window.removeEventListener(eventName, listener);
    expect(received).toEqual([eventName]);
  });
});
