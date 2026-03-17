import { DEFAULT_PREFERENCES } from '@shared/types/preferences';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  setHotkeyMap: vi.fn(),
  mergeOverrides: vi.fn(),
  setDefaultColorSequence: vi.fn(),
  setBrushSize: vi.fn(),
  updateStyle: vi.fn(),
  updateContourStyle: vi.fn(),
  applyScissorPreferences: vi.fn(),
  segmentationState: {
    setShowViewportContextOverlay: vi.fn(),
    setBrushSize: vi.fn(),
    setContourLineWidth: vi.fn(),
    setRenderOutline: vi.fn(),
    setAutoLoadSegOnScanClick: vi.fn(),
    setFillAlpha: vi.fn(),
  },
}));

vi.mock('../hotkeys/hotkeyService', () => ({
  hotkeyService: {
    setHotkeyMap: mocked.setHotkeyMap,
    mergeOverrides: mocked.mergeOverrides,
  },
}));

vi.mock('../cornerstone/segmentationService', () => ({
  segmentationService: {
    setDefaultColorSequence: mocked.setDefaultColorSequence,
    setBrushSize: mocked.setBrushSize,
    updateStyle: mocked.updateStyle,
    updateContourStyle: mocked.updateContourStyle,
  },
}));

vi.mock('../cornerstone/toolService', () => ({
  toolService: {
    applyScissorPreferences: mocked.applyScissorPreferences,
  },
}));

vi.mock('../../stores/segmentationStore', () => ({
  useSegmentationStore: {
    getState: () => mocked.segmentationState,
  },
}));

import { applyPreferences } from './applyPreferences';

describe('applyPreferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies clamped annotation prefs, overlay toggle, hotkeys, and valid color sequence', () => {
    const prefs = {
      ...DEFAULT_PREFERENCES,
      hotkeys: {
        overrides: {
          pan: 'Ctrl+P',
          zoom: 'Shift+Z',
        },
      },
      overlay: {
        ...DEFAULT_PREFERENCES.overlay,
        showViewportContextOverlay: false,
      },
      annotation: {
        ...DEFAULT_PREFERENCES.annotation,
        defaultBrushSize: 200,
        defaultContourThickness: 0.2,
        defaultMaskOutlines: false,
        defaultSegmentOpacity: 5,
        autoDisplayAnnotations: false,
        defaultColorSequence: ['#112233', '#abcdef', '#bad', 'oops'] as any,
      },
    };

    applyPreferences(prefs);

    expect(mocked.setHotkeyMap).toHaveBeenCalledTimes(1);
    expect(mocked.mergeOverrides).toHaveBeenCalledWith({
      pan: 'Ctrl+P',
      zoom: 'Shift+Z',
    });
    expect(mocked.setHotkeyMap.mock.invocationCallOrder[0]).toBeLessThan(
      mocked.mergeOverrides.mock.invocationCallOrder[0],
    );

    expect(mocked.segmentationState.setShowViewportContextOverlay).toHaveBeenCalledWith(false);
    expect(mocked.segmentationState.setBrushSize).toHaveBeenCalledWith(100);
    expect(mocked.segmentationState.setContourLineWidth).toHaveBeenCalledWith(1);
    expect(mocked.segmentationState.setRenderOutline).toHaveBeenCalledWith(false);
    expect(mocked.segmentationState.setAutoLoadSegOnScanClick).toHaveBeenCalledWith(false);
    expect(mocked.segmentationState.setFillAlpha).toHaveBeenCalledWith(1);

    expect(mocked.setDefaultColorSequence).toHaveBeenCalledWith([
      [17, 34, 51, 255],
      [171, 205, 239, 255],
    ]);
    expect(mocked.setBrushSize).toHaveBeenCalledWith(100);
    expect(mocked.updateStyle).toHaveBeenCalledWith(1, false);
    expect(mocked.updateContourStyle).toHaveBeenCalledWith(1);
    expect(mocked.applyScissorPreferences).toHaveBeenCalledTimes(1);
  });

  it('falls back safely to defaults when optional preference sections are missing', () => {
    applyPreferences({} as any);

    expect(mocked.mergeOverrides).toHaveBeenCalledWith({});
    expect(mocked.segmentationState.setShowViewportContextOverlay).toHaveBeenCalledWith(
      DEFAULT_PREFERENCES.overlay.showViewportContextOverlay,
    );
    expect(mocked.segmentationState.setBrushSize).toHaveBeenCalledWith(
      DEFAULT_PREFERENCES.annotation.defaultBrushSize,
    );
    expect(mocked.segmentationState.setContourLineWidth).toHaveBeenCalledWith(
      DEFAULT_PREFERENCES.annotation.defaultContourThickness,
    );
    expect(mocked.segmentationState.setRenderOutline).toHaveBeenCalledWith(
      DEFAULT_PREFERENCES.annotation.defaultMaskOutlines,
    );
    expect(mocked.segmentationState.setAutoLoadSegOnScanClick).toHaveBeenCalledWith(
      DEFAULT_PREFERENCES.annotation.autoDisplayAnnotations,
    );
    expect(mocked.segmentationState.setFillAlpha).toHaveBeenCalledWith(
      DEFAULT_PREFERENCES.annotation.defaultSegmentOpacity,
    );

    expect(mocked.updateStyle).toHaveBeenCalledWith(
      DEFAULT_PREFERENCES.annotation.defaultSegmentOpacity,
      DEFAULT_PREFERENCES.annotation.defaultMaskOutlines,
    );
    expect(mocked.updateContourStyle).toHaveBeenCalledWith(
      DEFAULT_PREFERENCES.annotation.defaultContourThickness,
    );
    expect(mocked.applyScissorPreferences).toHaveBeenCalledTimes(1);
  });
});
