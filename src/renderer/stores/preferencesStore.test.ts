import type { HotkeyBinding } from '@shared/types/hotkeys';
import {
  DEFAULT_INTERPOLATION_PREFERENCES,
  DEFAULT_PREFERENCES,
  DEFAULT_SEGMENT_COLOR_SEQUENCE,
} from '@shared/types/preferences';
import { beforeEach, describe, expect, it } from 'vitest';
import { usePreferencesStore } from './preferencesStore';

type PersistApi = {
  clearStorage: () => void;
  getOptions: () => {
    merge: (persistedState: unknown, currentState: unknown) => unknown;
  };
};

function persistApi(): PersistApi {
  return (usePreferencesStore as unknown as { persist: PersistApi }).persist;
}

function resetStore(): void {
  persistApi().clearStorage();
  if (typeof localStorage !== 'undefined') {
    localStorage.clear();
  }
  usePreferencesStore.setState(usePreferencesStore.getInitialState(), true);
}

describe('usePreferencesStore', () => {
  beforeEach(() => {
    resetStore();
  });

  it('starts from default preferences', () => {
    const state = usePreferencesStore.getState().preferences;
    expect(state).toEqual(DEFAULT_PREFERENCES);
  });

  it('supports deterministic hotkey override transitions', () => {
    const first: HotkeyBinding[] = [{ key: 'k' }];
    const second: HotkeyBinding[] = [{ key: 'j', modifiers: { shift: true } }];

    usePreferencesStore.getState().setHotkeyOverride('tool.pan', first);
    expect(usePreferencesStore.getState().preferences.hotkeys.overrides['tool.pan']).toEqual(first);

    usePreferencesStore.getState().setHotkeyOverride('tool.pan', second);
    expect(usePreferencesStore.getState().preferences.hotkeys.overrides['tool.pan']).toEqual(second);

    usePreferencesStore.getState().clearHotkeyOverride('tool.pan');
    expect(usePreferencesStore.getState().preferences.hotkeys.overrides['tool.pan']).toBeUndefined();

    usePreferencesStore.getState().setHotkeyOverride('tool.zoom', [{ key: 'z' }]);
    usePreferencesStore.getState().setHotkeyOverride('tool.length', [{ key: 'l' }]);
    usePreferencesStore.getState().resetHotkeys();
    expect(usePreferencesStore.getState().preferences.hotkeys.overrides).toEqual({});
  });

  it('applies overlay toggles and corner field updates deterministically', () => {
    usePreferencesStore.getState().setShowViewportContextOverlay(false);
    usePreferencesStore.getState().setShowOverlayHorizontalRuler(false);
    usePreferencesStore.getState().setShowOverlayVerticalRuler(false);
    usePreferencesStore.getState().setShowOverlayOrientationMarkers(false);

    let overlay = usePreferencesStore.getState().preferences.overlay;
    expect(overlay.showViewportContextOverlay).toBe(false);
    expect(overlay.showHorizontalRuler).toBe(false);
    expect(overlay.showVerticalRuler).toBe(false);
    expect(overlay.showOrientationMarkers).toBe(false);

    usePreferencesStore.getState().setOverlayCornerField('topLeft', 'scanId', true);
    usePreferencesStore.getState().setOverlayCornerField('topLeft', 'scanId', true);
    overlay = usePreferencesStore.getState().preferences.overlay;
    expect(overlay.corners.topLeft.filter((k) => k === 'scanId')).toHaveLength(1);

    usePreferencesStore.getState().setOverlayCornerField('topLeft', 'scanId', false);
    overlay = usePreferencesStore.getState().preferences.overlay;
    expect(overlay.corners.topLeft.includes('scanId')).toBe(false);
  });

  it('clamps annotation values and sanitizes color sequence', () => {
    usePreferencesStore.getState().setAnnotationBrushSize(0);
    usePreferencesStore.getState().setAnnotationContourThickness(999);
    usePreferencesStore.getState().setAnnotationMaskOutlines(false);
    usePreferencesStore.getState().setAnnotationAutoDisplay(false);
    usePreferencesStore.getState().setAnnotationSegmentOpacity(2);
    usePreferencesStore.getState().setAnnotationColorSequence([
      ' #aa00cc ',
      'bad',
      '#AA00CC',
      '00ff00',
      '#00FF00',
    ]);

    let annotation = usePreferencesStore.getState().preferences.annotation;
    expect(annotation.defaultBrushSize).toBe(1);
    expect(annotation.defaultContourThickness).toBe(8);
    expect(annotation.defaultMaskOutlines).toBe(false);
    expect(annotation.autoDisplayAnnotations).toBe(false);
    expect(annotation.defaultSegmentOpacity).toBe(1);
    expect(annotation.defaultColorSequence).toEqual(['#AA00CC', '#00FF00']);
    expect(annotation.scissors.defaultStrategy).toBe('erase');
    expect(annotation.scissors.previewEnabled).toBe(false);
    expect(annotation.scissors.previewColor).toBe('#FFFFFF');

    usePreferencesStore.getState().setAnnotationColorSequence(['invalid']);
    annotation = usePreferencesStore.getState().preferences.annotation;
    expect(annotation.defaultColorSequence).toEqual(DEFAULT_SEGMENT_COLOR_SEQUENCE);

    usePreferencesStore.getState().setScissorDefaultStrategy('fill');
    usePreferencesStore.getState().setScissorPreviewEnabled(true);
    usePreferencesStore.getState().setScissorPreviewColor('#33AA77');

    annotation = usePreferencesStore.getState().preferences.annotation;
    expect(annotation.scissors.defaultStrategy).toBe('fill');
    expect(annotation.scissors.previewEnabled).toBe(true);
    expect(annotation.scissors.previewColor).toBe('#33AA77');

    usePreferencesStore.getState().setScissorPreviewColor('bad');
    annotation = usePreferencesStore.getState().preferences.annotation;
    expect(annotation.scissors.previewColor).toBe('#33AA77');
  });

  it('clamps interpolation values and resets all settings', () => {
    usePreferencesStore.getState().setUpdateChecksEnabled(false);
    usePreferencesStore.getState().setUpdateAutoDownloadEnabled(false);
    usePreferencesStore.getState().setInterpolationEnabled(false);
    usePreferencesStore.getState().setInterpolationAlgorithm('linear');
    usePreferencesStore.getState().setLinearThreshold(-5);

    let interpolation = usePreferencesStore.getState().preferences.interpolation;
    let updates = usePreferencesStore.getState().preferences.updates;
    expect(updates.enabled).toBe(false);
    expect(updates.autoDownload).toBe(false);
    expect(interpolation.enabled).toBe(false);
    expect(interpolation.algorithm).toBe('linear');
    expect(interpolation.linearThreshold).toBe(0);

    usePreferencesStore.getState().resetAll();

    const state = usePreferencesStore.getState().preferences;
    expect(state).toEqual(DEFAULT_PREFERENCES);
    expect(state.overlay.corners.topLeft).not.toBe(DEFAULT_PREFERENCES.overlay.corners.topLeft);
    expect(state.annotation.defaultColorSequence).not.toBe(DEFAULT_PREFERENCES.annotation.defaultColorSequence);

    interpolation = state.interpolation;
    expect(interpolation).toEqual(DEFAULT_INTERPOLATION_PREFERENCES);
  });

  it('merges persisted settings with legacy/malformed values deterministically', () => {
    const merge = persistApi().getOptions().merge;
    const currentState = usePreferencesStore.getInitialState();

    const merged = merge(
      {
        preferences: {
          overlay: {
            showRuler: false,
            corners: {
              topLeft: ['scanId', 'not-real-field'],
              bottomRight: ['zoom', 'zoom'],
            },
          },
          annotation: {
            defaultBrushSize: 999,
            defaultContourThickness: 0,
            defaultMaskOutlines: false,
            autoDisplayAnnotations: false,
            defaultSegmentOpacity: -1,
            defaultColorSequence: ['abc123', '#ABC123', 'INVALID'],
            scissors: {
              defaultStrategy: 'fill',
              previewEnabled: true,
              previewColor: '#00AAFF',
            },
          },
          updates: {
            enabled: false,
            autoDownload: false,
          },
          interpolation: {
            enabled: false,
            algorithm: 'not-a-real-algorithm',
            linearThreshold: 3,
          },
        },
      },
      currentState,
    ) as ReturnType<typeof usePreferencesStore.getState>;

    expect(merged.preferences.overlay.showHorizontalRuler).toBe(false);
    expect(merged.preferences.overlay.showVerticalRuler).toBe(false);
    expect(merged.preferences.overlay.corners.topLeft).toEqual(['scanId']);
    expect(merged.preferences.overlay.corners.bottomRight).toEqual(['zoom']);

    expect(merged.preferences.annotation.defaultBrushSize).toBe(100);
    expect(merged.preferences.annotation.defaultContourThickness).toBe(1);
    expect(merged.preferences.annotation.defaultMaskOutlines).toBe(false);
    expect(merged.preferences.annotation.autoDisplayAnnotations).toBe(false);
    expect(merged.preferences.annotation.defaultSegmentOpacity).toBe(0);
    expect(merged.preferences.annotation.defaultColorSequence).toEqual(['#ABC123']);
    expect(merged.preferences.annotation.scissors.defaultStrategy).toBe('fill');
    expect(merged.preferences.annotation.scissors.previewEnabled).toBe(true);
    expect(merged.preferences.annotation.scissors.previewColor).toBe('#00AAFF');
    expect(merged.preferences.updates.enabled).toBe(false);
    expect(merged.preferences.updates.autoDownload).toBe(false);

    expect(merged.preferences.interpolation.enabled).toBe(false);
    expect(merged.preferences.interpolation.algorithm).toBe(
      DEFAULT_INTERPOLATION_PREFERENCES.algorithm,
    );
    expect(merged.preferences.interpolation.linearThreshold).toBe(1);
  });

  it('falls back to default updater preferences when persisted values are malformed', () => {
    const merge = persistApi().getOptions().merge;
    const currentState = usePreferencesStore.getInitialState();

    const merged = merge(
      {
        preferences: {
          updates: {
            enabled: 'yes',
            autoDownload: null,
          },
        },
      },
      currentState,
    ) as ReturnType<typeof usePreferencesStore.getState>;

    expect(merged.preferences.updates).toEqual(DEFAULT_PREFERENCES.updates);
  });

  describe('multiViewport feature flag', () => {
    it('is disabled by default', () => {
      const state = usePreferencesStore.getState().preferences;
      expect(state.multiViewport.enabled).toBe(false);
    });

    it('toggles on and off via setMultiViewportEnabled', () => {
      usePreferencesStore.getState().setMultiViewportEnabled(true);
      expect(usePreferencesStore.getState().preferences.multiViewport.enabled).toBe(true);

      usePreferencesStore.getState().setMultiViewportEnabled(false);
      expect(usePreferencesStore.getState().preferences.multiViewport.enabled).toBe(false);
    });

    it('persists across merge from legacy state without the multiViewport key', () => {
      const merge = persistApi().getOptions().merge;
      const currentState = usePreferencesStore.getInitialState();

      // Legacy persisted state from before the multi-viewport rewrite has
      // no multiViewport key — must merge to the default-disabled value.
      const merged = merge(
        {
          preferences: {
            // No multiViewport key here
          },
        },
        currentState,
      ) as ReturnType<typeof usePreferencesStore.getState>;

      expect(merged.preferences.multiViewport.enabled).toBe(false);
    });

    it('preserves user-enabled value through merge', () => {
      const merge = persistApi().getOptions().merge;
      const currentState = usePreferencesStore.getInitialState();

      const merged = merge(
        {
          preferences: {
            multiViewport: { enabled: true },
          },
        },
        currentState,
      ) as ReturnType<typeof usePreferencesStore.getState>;

      expect(merged.preferences.multiViewport.enabled).toBe(true);
    });

    it('falls back to default for malformed persisted multiViewport value', () => {
      const merge = persistApi().getOptions().merge;
      const currentState = usePreferencesStore.getInitialState();

      const merged = merge(
        {
          preferences: {
            multiViewport: { enabled: 'yes' },
          },
        },
        currentState,
      ) as ReturnType<typeof usePreferencesStore.getState>;

      expect(merged.preferences.multiViewport.enabled).toBe(false);
    });

    it('resets to default on resetAll', () => {
      usePreferencesStore.getState().setMultiViewportEnabled(true);
      usePreferencesStore.getState().resetAll();
      expect(usePreferencesStore.getState().preferences.multiViewport.enabled).toBe(false);
    });
  });

  describe('multiViewport.crossSeriesRendering toggle', () => {
    it('defaults to true (A2b siblings render by default per requirement §A2b)', () => {
      const state = usePreferencesStore.getState().preferences;
      expect(state.multiViewport.crossSeriesRendering).toBe(true);
    });

    it('toggles on and off via setCrossSeriesRendering', () => {
      usePreferencesStore.getState().setCrossSeriesRendering(false);
      expect(usePreferencesStore.getState().preferences.multiViewport.crossSeriesRendering).toBe(false);

      usePreferencesStore.getState().setCrossSeriesRendering(true);
      expect(usePreferencesStore.getState().preferences.multiViewport.crossSeriesRendering).toBe(true);
    });

    it('is independent of the multiViewport.enabled flag', () => {
      usePreferencesStore.getState().setMultiViewportEnabled(true);
      usePreferencesStore.getState().setCrossSeriesRendering(false);
      expect(usePreferencesStore.getState().preferences.multiViewport.enabled).toBe(true);
      expect(usePreferencesStore.getState().preferences.multiViewport.crossSeriesRendering).toBe(false);
    });

    it('persists across merge from legacy state without the crossSeriesRendering key', () => {
      const merge = persistApi().getOptions().merge;
      const currentState = usePreferencesStore.getInitialState();

      // Persisted state from before Phase 2.2 has multiViewport.enabled but no
      // crossSeriesRendering key — must merge to the default-true value.
      const merged = merge(
        {
          preferences: {
            multiViewport: { enabled: true },
          },
        },
        currentState,
      ) as ReturnType<typeof usePreferencesStore.getState>;

      expect(merged.preferences.multiViewport.enabled).toBe(true);
      expect(merged.preferences.multiViewport.crossSeriesRendering).toBe(true);
    });

    it('preserves user-disabled value through merge', () => {
      const merge = persistApi().getOptions().merge;
      const currentState = usePreferencesStore.getInitialState();

      const merged = merge(
        {
          preferences: {
            multiViewport: { enabled: true, crossSeriesRendering: false },
          },
        },
        currentState,
      ) as ReturnType<typeof usePreferencesStore.getState>;

      expect(merged.preferences.multiViewport.crossSeriesRendering).toBe(false);
    });

    it('falls back to default-true for malformed persisted crossSeriesRendering value', () => {
      const merge = persistApi().getOptions().merge;
      const currentState = usePreferencesStore.getInitialState();

      const merged = merge(
        {
          preferences: {
            multiViewport: { enabled: true, crossSeriesRendering: 'yes' },
          },
        },
        currentState,
      ) as ReturnType<typeof usePreferencesStore.getState>;

      expect(merged.preferences.multiViewport.crossSeriesRendering).toBe(true);
    });

    it('resets to default-true on resetAll', () => {
      usePreferencesStore.getState().setCrossSeriesRendering(false);
      usePreferencesStore.getState().resetAll();
      expect(usePreferencesStore.getState().preferences.multiViewport.crossSeriesRendering).toBe(true);
    });
  });
});
