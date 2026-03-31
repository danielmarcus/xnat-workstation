import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFERENCES } from '@shared/types/preferences';
import SettingsModal from './SettingsModal';
import { usePreferencesStore } from '../../stores/preferencesStore';
import type { MainDiagnosticsSnapshot } from '@shared/types/diagnostics';
import type { UpdateStatus } from '@shared/types';

function resetPreferencesStore(): void {
  usePreferencesStore.setState(usePreferencesStore.getInitialState(), true);
}

const clipboardWriteTextMock = vi.fn(async () => undefined);
const updaterGetStateMock = vi.fn<[], Promise<UpdateStatus>>();
const updaterConfigureMock = vi.fn();
const updaterCheckMock = vi.fn();
const updaterQuitAndInstallMock = vi.fn();
const updaterOnStatusMock = vi.fn();

describe('SettingsModal', () => {
  beforeEach(() => {
    resetPreferencesStore();
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        diagnostics: {
          getMainSnapshot: vi.fn(async () => ({
            ok: true,
            snapshot: {
              generatedAt: '2026-03-05T00:00:00.000Z',
              app: {
                name: 'XNAT Workstation',
                version: '0.5.2',
                isPackaged: false,
                pid: 100,
                uptimeSec: 10,
                windowCount: 1,
              },
              runtime: {
                electron: '40.2.1',
                chrome: '132.0.0',
                node: '20.0.0',
                v8: '12.0',
                platform: 'darwin',
                arch: 'arm64',
              },
              system: {
                osType: 'Darwin',
                osRelease: '24.5.0',
                osVersion: 'macOS',
                cpuModel: 'Mock CPU',
                cpuCount: 8,
                totalMemoryMB: 16384,
                freeMemoryMB: 4096,
                loadAverage: [0.1, 0.2, 0.3],
                hostnameFingerprint: 'abcdef123456',
              },
              process: {
                rssMB: 350,
                heapUsedMB: 120,
                heapTotalMB: 200,
                externalMB: 4,
                argv: ['app'],
              },
              logs: { stdout: [], stderr: [] },
            } satisfies MainDiagnosticsSnapshot,
          })),
        },
        updater: {
          getState: updaterGetStateMock,
          configure: updaterConfigureMock,
          checkForUpdates: updaterCheckMock,
          quitAndInstall: updaterQuitAndInstallMock,
          onStatus: updaterOnStatusMock,
        },
      },
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      writable: true,
      value: {
        writeText: clipboardWriteTextMock,
      },
    });
    (navigator as any).clipboard = { writeText: clipboardWriteTextMock };
    clipboardWriteTextMock.mockClear();
    updaterGetStateMock.mockReset();
    updaterConfigureMock.mockReset();
    updaterCheckMock.mockReset();
    updaterQuitAndInstallMock.mockReset();
    updaterOnStatusMock.mockReset();
    updaterGetStateMock.mockResolvedValue({
      phase: 'upToDate',
      currentVersion: '0.5.2',
      enabled: true,
      autoDownload: true,
      isPackaged: true,
      availableVersion: null,
      downloadedVersion: null,
      downloadProgressPercent: null,
      lastCheckedAt: '2026-03-05T12:00:00.000Z',
      message: 'You are running the latest version.',
      error: null,
    });
    updaterCheckMock.mockResolvedValue({
      ok: true,
      status: {
        phase: 'checking',
        currentVersion: '0.5.2',
        enabled: true,
        autoDownload: true,
        isPackaged: true,
        availableVersion: null,
        downloadedVersion: null,
        downloadProgressPercent: null,
        lastCheckedAt: '2026-03-05T12:30:00.000Z',
        message: 'Checking for updates...',
        error: null,
      } satisfies UpdateStatus,
    });
    updaterQuitAndInstallMock.mockResolvedValue({ ok: true });
    updaterOnStatusMock.mockImplementation(() => () => {});
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
    await user.selectOptions(screen.getByLabelText('Default scissors mode'), 'fill');
    await user.click(screen.getByRole('checkbox', { name: 'Enable scissors preview' }));
    fireEvent.change(screen.getByLabelText('Preview color'), { target: { value: '#44AA66' } });

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
    expect(prefs.annotation.scissors.defaultStrategy).toBe('fill');
    expect(prefs.annotation.scissors.previewEnabled).toBe(true);
    expect(prefs.annotation.scissors.previewColor).toBe('#44AA66');

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

    await user.click(screen.getByRole('button', { name: 'Updates' }));
    await user.click(screen.getByRole('checkbox', { name: 'Enable automatic update checks' }));
    await user.click(screen.getByRole('checkbox', { name: 'Download updates automatically when found' }));

    prefs = usePreferencesStore.getState().preferences;
    expect(prefs.updates.enabled).toBe(false);
    expect(prefs.updates.autoDownload).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Reset All Preferences' }));
    prefs = usePreferencesStore.getState().preferences;
    expect(prefs.overlay.showViewportContextOverlay).toBe(DEFAULT_PREFERENCES.overlay.showViewportContextOverlay);
    expect(prefs.annotation.defaultBrushSize).toBe(DEFAULT_PREFERENCES.annotation.defaultBrushSize);
    expect(prefs.annotation.defaultColorSequence).toEqual(DEFAULT_PREFERENCES.annotation.defaultColorSequence);
    expect(prefs.updates).toEqual(DEFAULT_PREFERENCES.updates);
    expect(prefs.interpolation).toEqual(DEFAULT_PREFERENCES.interpolation);
  });

  it('shows updater status and supports manual update actions', async () => {
    const user = userEvent.setup();
    updaterGetStateMock.mockResolvedValueOnce({
      phase: 'downloaded',
      currentVersion: '0.5.2',
      enabled: true,
      autoDownload: true,
      isPackaged: true,
      availableVersion: '0.5.3',
      downloadedVersion: '0.5.3',
      downloadProgressPercent: 100,
      lastCheckedAt: '2026-03-05T12:00:00.000Z',
      message: 'Update downloaded.',
      error: null,
    });

    render(<SettingsModal open onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Updates' }));

    expect(await screen.findByText('Current version')).toBeInTheDocument();
    expect(screen.getByText('Update 0.5.3 is ready to install.')).toBeInTheDocument();
    expect(updaterGetStateMock).toHaveBeenCalledTimes(1);
    expect(updaterOnStatusMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Restart and Install' }));
    expect(updaterQuitAndInstallMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Check Now' }));
    expect(updaterCheckMock).toHaveBeenCalledTimes(1);
  });

  it('returns null when closed', () => {
    render(<SettingsModal open={false} onClose={() => {}} />);
    expect(screen.queryByText('Preferences')).not.toBeInTheDocument();
  });

  it('generates and copies issue report content', async () => {
    const user = userEvent.setup();
    render(<SettingsModal open onClose={() => {}} />);

    await user.click(screen.getByRole('button', { name: 'Issue Report' }));
    expect(await screen.findByText('Copy/paste this into an email:')).toBeInTheDocument();

    const textAreas = screen.getAllByRole('textbox') as HTMLTextAreaElement[];
    const reportArea = textAreas[textAreas.length - 1];
    await waitFor(() => {
      expect(reportArea.value).toContain('XNAT Workstation Issue Report (De-identified)');
    });

    const copyButton = screen.getByRole('button', { name: 'Copy Report' });
    expect(copyButton).toBeEnabled();
    await user.click(copyButton);
    expect(await screen.findByText(/Copied|Copy failed/)).toBeInTheDocument();
  });
});
