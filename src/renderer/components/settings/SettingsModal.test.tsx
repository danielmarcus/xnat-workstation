import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFERENCES } from '@shared/types/preferences';
import SettingsModal from './SettingsModal';
import { usePreferencesStore } from '../../stores/preferencesStore';

function resetPreferencesStore(): void {
  usePreferencesStore.setState(usePreferencesStore.getInitialState(), true);
}

describe('SettingsModal', () => {
  beforeEach(() => {
    resetPreferencesStore();
  });

  it('opens, switches tabs, and closes via Escape/backdrop', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<SettingsModal open onClose={onClose} />);

    expect(screen.getByText('Preferences')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Overlay' }));
    expect(screen.getByText('Show horizontal ruler')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByLabelText('Close settings'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('edits hotkey overrides and supports clear/reset flows', async () => {
    const user = userEvent.setup();
    render(<SettingsModal open onClose={() => {}} />);

    const actionSelect = screen.getByRole('combobox') as HTMLSelectElement;
    const keyInput = screen.getByPlaceholderText('e.g. w, Escape, Space');

    await user.clear(keyInput);
    await user.type(keyInput, 'Spacebar');
    await user.click(screen.getByRole('checkbox', { name: 'CTRL' }));
    await user.click(screen.getByRole('button', { name: 'Set Override' }));

    const selectedAction = actionSelect.value;
    const override = usePreferencesStore.getState().preferences.hotkeys.overrides[selectedAction];
    expect(override?.[0]?.key).toBe(' ');
    expect(override?.[0]?.modifiers?.ctrl).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Clear Selected' }));
    expect(usePreferencesStore.getState().preferences.hotkeys.overrides[selectedAction]).toBeUndefined();

    await user.click(screen.getByRole('button', { name: 'Set Override' }));
    expect(usePreferencesStore.getState().preferences.hotkeys.overrides[selectedAction]).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Reset Hotkeys' }));
    expect(usePreferencesStore.getState().preferences.hotkeys.overrides).toEqual({});
  });

  it('handles override rows with missing first binding safely', async () => {
    const user = userEvent.setup();
    usePreferencesStore.setState({
      ...usePreferencesStore.getState(),
      preferences: {
        ...usePreferencesStore.getState().preferences,
        hotkeys: {
          overrides: {
            ...(usePreferencesStore.getState().preferences.hotkeys.overrides as any),
            'custom.missingBinding': [],
          } as any,
        },
      },
    });

    render(<SettingsModal open onClose={() => {}} />);

    await user.selectOptions(screen.getByRole('combobox'), 'custom.missingBinding');
    const keyInput = screen.getByPlaceholderText('e.g. w, Escape, Space') as HTMLInputElement;
    expect(keyInput.value).toBe('');

    const [ctrl, shift, alt, meta] = screen.getAllByRole('checkbox', {
      name: /CTRL|SHIFT|ALT|META/,
    }) as HTMLInputElement[];
    expect(ctrl.checked).toBe(false);
    expect(shift.checked).toBe(false);
    expect(alt.checked).toBe(false);
    expect(meta.checked).toBe(false);

    // "Edit" should not throw even when bindings array is empty.
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('custom.missingBinding');
  });

  it('updates overlay, annotation, interpolation preferences and reset-all', async () => {
    const user = userEvent.setup();
    render(<SettingsModal open onClose={() => {}} />);

    await user.click(screen.getByRole('button', { name: 'Overlay' }));
    await user.click(screen.getByRole('checkbox', { name: 'Show viewport context overlay' }));
    await user.click(screen.getByRole('checkbox', { name: 'Show horizontal ruler' }));
    await user.click(screen.getByRole('checkbox', { name: 'Show A/P and L/R indicators' }));
    await user.click(screen.getByRole('checkbox', { name: 'Orientation control' }));

    let prefs = usePreferencesStore.getState().preferences;
    expect(prefs.overlay.showViewportContextOverlay).toBe(false);
    expect(prefs.overlay.showHorizontalRuler).toBe(false);
    expect(prefs.overlay.showOrientationMarkers).toBe(false);
    expect(prefs.overlay.corners.topLeft).not.toContain('orientationSelector');

    await user.click(screen.getByRole('button', { name: 'Annotation' }));
    const annotationSliders = screen.getAllByRole('slider');
    fireEvent.change(annotationSliders[0], { target: { value: '12' } });
    fireEvent.change(annotationSliders[1], { target: { value: '4' } });
    fireEvent.change(annotationSliders[2], { target: { value: '0.8' } });
    await user.click(screen.getByRole('checkbox', { name: 'Default display mask outlines' }));
    await user.click(screen.getByRole('checkbox', { name: 'Automatically display annotations' }));

    const colorInput = screen.getByPlaceholderText('#DC3232, #32C832, #3264DC');
    await user.clear(colorInput);
    await user.type(colorInput, '#123abc, bad, #123ABC, 445566');
    await user.click(screen.getByRole('button', { name: 'Apply Sequence' }));

    prefs = usePreferencesStore.getState().preferences;
    expect(prefs.annotation.defaultBrushSize).toBe(12);
    expect(prefs.annotation.defaultContourThickness).toBe(4);
    expect(prefs.annotation.defaultSegmentOpacity).toBeCloseTo(0.8);
    expect(prefs.annotation.defaultMaskOutlines).toBe(false);
    expect(prefs.annotation.autoDisplayAnnotations).toBe(false);
    expect(prefs.annotation.defaultColorSequence).toEqual(['#123ABC', '#445566']);

    await user.click(screen.getByRole('button', { name: 'Interpolation' }));
    const enabledToggle = screen.getByRole('checkbox', { name: 'Enable between-slice interpolation' });
    await user.click(enabledToggle);
    await user.click(enabledToggle);
    await user.selectOptions(screen.getByRole('combobox'), 'linear');
    const interpolationSlider = screen.getByRole('slider');
    fireEvent.change(interpolationSlider, { target: { value: '0.85' } });

    prefs = usePreferencesStore.getState().preferences;
    expect(prefs.interpolation.enabled).toBe(true);
    expect(prefs.interpolation.algorithm).toBe('linear');
    expect(prefs.interpolation.linearThreshold).toBeCloseTo(0.85);

    await user.click(screen.getByRole('button', { name: 'Reset All Preferences' }));
    prefs = usePreferencesStore.getState().preferences;
    expect(prefs.overlay.showViewportContextOverlay).toBe(DEFAULT_PREFERENCES.overlay.showViewportContextOverlay);
    expect(prefs.annotation.defaultBrushSize).toBe(DEFAULT_PREFERENCES.annotation.defaultBrushSize);
    expect(prefs.annotation.defaultColorSequence).toEqual(DEFAULT_PREFERENCES.annotation.defaultColorSequence);
    expect(prefs.interpolation).toEqual(DEFAULT_PREFERENCES.interpolation);
  });

  it('returns null when closed', () => {
    render(<SettingsModal open={false} onClose={() => {}} />);
    expect(screen.queryByText('Preferences')).not.toBeInTheDocument();
  });
});
