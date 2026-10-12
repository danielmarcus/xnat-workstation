import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HotkeyMap } from '@shared/types/hotkeys';
import { dispatchKey, makeDivTarget, makeInputTarget } from '../../../test/hotkeys/keyboard';
import { HOTKEY_ACTIONS, TEST_HOTKEY_MAP } from '../../../test/hotkeys/hotkeyFixtures';

const viewerState = {
  mprActive: false,
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
  mprViewports: {} as Record<string, { totalSlices: number; sliceIndex: number }>,
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

const viewportServiceMock = {
  zoomBy: vi.fn(),
  scrollToIndex: vi.fn(),
};

// Brush size has ONE entry point (Phase-6 cutover): unifiedToolService.setBrushSize
// clamps, writes the unified tool group, and writes segmentationStore.
const unifiedToolServiceMock = {
  setBrushSize: vi.fn(),
};

const segmentationServiceMock = {
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
  vi.doMock('../../cornerstone/viewportService', () => ({ viewportService: viewportServiceMock }));
  vi.doMock('../../cornerstone/segmentationService', () => ({ segmentationService: segmentationServiceMock }));
  vi.doMock('../../cornerstone/unifiedToolService', () => ({ unifiedToolService: unifiedToolServiceMock }));

  ({ hotkeyService } = await import('../hotkeyService'));
  // The dynamic import pulls the Cornerstone service graph; 10s is not enough headroom
  // when the suite runs in parallel with other heavy files.
}, 60_000);

function resetState(): void {
  viewerState.mprActive = false;
  viewerState.activeViewportId = 'panel_0';
  viewerState.layoutConfig = { rows: 2, cols: 2, panelCount: 4 };
  viewerState.viewports.panel_0 = { totalImages: 10, imageIndex: 2, requestedImageIndex: null };
  viewerState.panelOrientationMap = {};
  viewerState.mprViewports = {};
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

  it('ignores non-Tab hotkeys in text entry and contentEditable elements', () => {
    hotkeyService.setHotkeyMap({
      [HOTKEY_ACTIONS.togglePanel]: [{ key: 'a' }],
      [HOTKEY_ACTIONS.cycleViewport]: [{ key: 'Tab' }],
    });
    hotkeyService.install();

    dispatchKey({ key: 'a', target: makeInputTarget('INPUT') });
    dispatchKey({ key: 'a', target: makeInputTarget('TEXTAREA') });
    dispatchKey({ key: 'a', target: makeDivTarget({ contentEditable: true }) });

    expect(segmentationState.togglePanel).not.toHaveBeenCalled();
    expect(viewerState.setActiveViewport).not.toHaveBeenCalled();

    dispatchKey({ key: 'Tab', target: makeInputTarget('INPUT') });
    expect(viewerState.setActiveViewport).toHaveBeenCalled();
  });

  it('a focused slider, checkbox or dropdown in the chrome does not swallow the shortcuts', () => {
    // Only text entry holds the keyboard (keepFocusInViewports). Treating every <input> /
    // <select> as a field swallowed every shortcut after a toolbox slider was dragged.
    hotkeyService.setHotkeyMap({ [HOTKEY_ACTIONS.togglePanel]: [{ key: 'a' }] });
    hotkeyService.install();

    const range = makeInputTarget('INPUT') as HTMLInputElement;
    range.type = 'range';
    const checkbox = makeInputTarget('INPUT') as HTMLInputElement;
    checkbox.type = 'checkbox';
    dispatchKey({ key: 'a', target: range });
    dispatchKey({ key: 'a', target: checkbox });
    dispatchKey({ key: 'a', target: makeInputTarget('SELECT') });

    expect(segmentationState.togglePanel).toHaveBeenCalledTimes(3);
  });

  it('form controls inside a modal dialog keep their keys', () => {
    hotkeyService.setHotkeyMap({ [HOTKEY_ACTIONS.togglePanel]: [{ key: 'a' }] });
    hotkeyService.install();

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    const select = document.createElement('select');
    dialog.append(checkbox, select);
    dispatchKey({ key: 'a', target: checkbox });
    dispatchKey({ key: 'a', target: select });

    expect(segmentationState.togglePanel).not.toHaveBeenCalled();
  });

  it('installs/removes one keydown and one keyup listener and avoids double-registration', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    hotkeyService.install();
    hotkeyService.install();

    // keyup exists for key layers' hold-to-compare (SegWorks parity D12).
    expect(addSpy).toHaveBeenCalledTimes(2);
    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function), { capture: true });
    expect(addSpy).toHaveBeenCalledWith('keyup', expect.any(Function), { capture: true });

    hotkeyService.uninstall();
    hotkeyService.uninstall();

    expect(removeSpy).toHaveBeenCalledTimes(2);
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function), { capture: true });
    expect(removeSpy).toHaveBeenCalledWith('keyup', expect.any(Function), { capture: true });
  });

  it('a key layer takes keys ahead of the global map, newest first, until removed', () => {
    hotkeyService.setHotkeyMap({ 'viewport.zoomOut': [{ key: '-' }] });
    hotkeyService.install();
    const seen: string[] = [];
    const removeOuter = hotkeyService.pushKeyLayer({ onKeyDown: (e) => { seen.push(`outer:${e.key}`); return e.key === 'Enter'; } });
    const removeInner = hotkeyService.pushKeyLayer({ onKeyDown: (e) => { seen.push(`inner:${e.key}`); return e.key === 'Escape'; } });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(seen).toEqual(['inner:Escape']); // consumed by the newest layer

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(seen).toEqual(['inner:Escape', 'inner:Enter', 'outer:Enter']); // declined, then taken

    removeInner();
    removeOuter();
    seen.length = 0;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(seen).toEqual([]);
    hotkeyService.uninstall();
  });

  it('key layers receive keyup and never see keys typed into a field', () => {
    hotkeyService.install();
    const ups: string[] = [];
    const downs: string[] = [];
    const remove = hotkeyService.pushKeyLayer({
      onKeyDown: (e) => { downs.push(e.key); return true; },
      onKeyUp: (e) => { ups.push(e.key); return true; },
    });
    window.dispatchEvent(new KeyboardEvent('keyup', { key: '\\', bubbles: true }));
    expect(ups).toEqual(['\\']);

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: '\\', bubbles: true }));
    expect(downs).toEqual([]);
    expect(ups).toEqual(['\\']);
    input.remove();
    remove();
    hotkeyService.uninstall();
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
    // '=' then '[' → +2 and −2 off the store's 5 (the mocked single entry point
    // doesn't write the store back, so both read the same base).
    expect(unifiedToolServiceMock.setBrushSize.mock.calls.map((c) => c[0])).toEqual([7, 3]);
    expect(viewerState.applyWLPreset).toHaveBeenCalledTimes(1);
  });

  it('handles stack slice navigation via viewportService', () => {
    hotkeyService.setHotkeyMap({
      'slice.prev': [{ key: 'ArrowUp' }],
      'slice.last': [{ key: 'End' }],
    });
    hotkeyService.install();

    viewerState.viewports.panel_0 = { totalImages: 10, imageIndex: 0, requestedImageIndex: null };
    dispatchKey({ key: 'ArrowUp' });
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
});
