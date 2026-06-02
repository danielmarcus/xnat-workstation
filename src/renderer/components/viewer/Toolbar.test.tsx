import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolName, WL_PRESETS } from '@shared/types/viewer';
import { BUILT_IN_PROTOCOLS } from '@shared/types/hangingProtocol';
import Toolbar from './Toolbar';
import { useViewerStore } from '../../stores/viewerStore';
import { useSegmentationStore } from '../../stores/segmentationStore';
import { usePreferencesStore } from '../../stores/preferencesStore';
import { act } from 'react';

const segmentationServiceMock = vi.hoisted(() => ({
  undo: vi.fn(),
  redo: vi.fn(),
}));

vi.mock('../../lib/cornerstone/segmentationService', () => ({
  segmentationService: segmentationServiceMock,
}));

vi.mock('./AnnotationToolDropdown', () => ({
  default: () => <div data-testid="annotation-tool-dropdown" />,
}));

function resetStores(): void {
  useViewerStore.setState(useViewerStore.getInitialState(), true);
  useSegmentationStore.setState(useSegmentationStore.getInitialState(), true);
}

describe('Toolbar', () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
  });

  it('dispatches core toolbar actions to viewer store and callbacks', async () => {
    const user = userEvent.setup();
    const setActiveTool = vi.fn();
    const resetViewport = vi.fn();
    const toggleInvert = vi.fn();
    const rotate90 = vi.fn();
    const flipH = vi.fn();
    const flipV = vi.fn();
    const toggleCine = vi.fn();
    const setCineFps = vi.fn();
    const onToggleDicomPanel = vi.fn();
    const onToggleMPR = vi.fn();

    useViewerStore.setState({
      ...useViewerStore.getState(),
      activeViewportId: 'panel_0',
      activeTool: ToolName.WindowLevel,
      cineStates: { panel_0: { isPlaying: false, fps: 15 } },
      sessionScans: [],
      setActiveTool,
      resetViewport,
      toggleInvert,
      rotate90,
      flipH,
      flipV,
      toggleCine,
      setCineFps,
    });

    render(
      <Toolbar
        hasImages
        onToggleDicomPanel={onToggleDicomPanel}
        onToggleMPR={onToggleMPR}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Pan' }));
    expect(setActiveTool).toHaveBeenCalledWith(ToolName.Pan);

    await user.click(screen.getByTitle(/^Reset viewport(\s|$)/));
    await user.click(screen.getByTitle(/^Toggle invert(\s|$)/));
    await user.click(screen.getByTitle(/^Rotate 90°(\s|$)/));
    await user.click(screen.getByTitle(/^Flip horizontal(\s|$)/));
    await user.click(screen.getByTitle(/^Flip vertical(\s|$)/));
    await user.click(screen.getByTitle('Play cine'));
    await user.click(screen.getByTestId('toolbar-mpr-cycle'));
    await user.click(screen.getByRole('button', { name: 'Tags' }));

    fireEvent.change(screen.getByTitle('15 FPS'), { target: { value: '22' } });

    expect(resetViewport).toHaveBeenCalledTimes(1);
    expect(toggleInvert).toHaveBeenCalledTimes(1);
    expect(rotate90).toHaveBeenCalledTimes(1);
    expect(flipH).toHaveBeenCalledTimes(1);
    expect(flipV).toHaveBeenCalledTimes(1);
    expect(toggleCine).toHaveBeenCalledTimes(1);
    expect(setCineFps).toHaveBeenCalledWith(22);
    expect(onToggleDicomPanel).toHaveBeenCalledTimes(1);
    // MPR toolbar button no longer routes through `onToggleMPR` — per
    // spec §3.3 it cycles the active viewport's orientation directly.
  });

  it('supports layout/protocol/preset dropdown flows', async () => {
    const user = userEvent.setup();
    const setLayout = vi.fn();
    const setCustomLayout = vi.fn();
    const applyWLPreset = vi.fn();
    const setActiveTool = vi.fn();
    const onApplyProtocol = vi.fn();

    useViewerStore.setState({
      ...useViewerStore.getState(),
      layout: '1x1',
      layoutConfig: { rows: 1, cols: 1, panelCount: 1 },
      sessionScans: [{ id: '1' } as any],
      setLayout,
      setCustomLayout,
      applyWLPreset,
      setActiveTool,
    });

    render(<Toolbar hasImages onApplyProtocol={onApplyProtocol} />);

    await user.click(screen.getByTitle('Viewport layout (1x1)'));
    await user.click(screen.getByRole('button', { name: '2 x 2' }));
    expect(setLayout).toHaveBeenCalledWith('2x2');

    await user.click(screen.getByTitle('Viewport layout (1x1)'));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'R' }), { target: { value: '3' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'C' }), { target: { value: '4' } });
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(setCustomLayout).toHaveBeenCalledWith(3, 4);

    await user.click(screen.getByTitle('Hanging protocol'));
    await user.click(screen.getByRole('button', { name: new RegExp(BUILT_IN_PROTOCOLS[0].name) }));
    expect(onApplyProtocol).toHaveBeenCalledWith(BUILT_IN_PROTOCOLS[0].id);

    await user.click(screen.getByTitle('Window/Level presets'));
    await user.click(screen.getByRole('button', { name: new RegExp(WL_PRESETS[0].name) }));
    expect(applyWLPreset).toHaveBeenCalledWith(WL_PRESETS[0]);
    expect(setActiveTool).toHaveBeenCalledWith(ToolName.WindowLevel);
  });

  it('keeps the protocol picker visible but disabled when there is no session data', async () => {
    const user = userEvent.setup();
    const onApplyProtocol = vi.fn();

    useViewerStore.setState({
      ...useViewerStore.getState(),
      sessionScans: null,
    });

    render(<Toolbar hasImages onApplyProtocol={onApplyProtocol} />);

    const protocolButton = screen.getByRole('button', { name: /protocol/i });
    expect(protocolButton).toBeDisabled();
    expect(protocolButton).toHaveAttribute('title', 'No applicable hanging protocols');

    await user.click(protocolButton);

    expect(screen.queryByRole('button', { name: new RegExp(BUILT_IN_PROTOCOLS[0].name) })).not.toBeInTheDocument();
    expect(onApplyProtocol).not.toHaveBeenCalled();
  });

  it('handles undo/redo enablement and settings modal lifecycle', async () => {
    const user = userEvent.setup();

    useSegmentationStore.setState({
      ...useSegmentationStore.getState(),
      canUndo: false,
      canRedo: false,
    });

    const view = render(<Toolbar />);
    const undoButton = screen.getByTitle(/^Undo(\s|$)/);
    const redoButton = screen.getByTitle(/^Redo(\s|$)/);
    expect(undoButton).toBeDisabled();
    expect(redoButton).toBeDisabled();

    useSegmentationStore.setState({
      ...useSegmentationStore.getState(),
      canUndo: true,
      canRedo: true,
    });
    view.rerender(<Toolbar />);

    await user.click(screen.getByTitle(/^Undo(\s|$)/));
    await user.click(screen.getByTitle(/^Redo(\s|$)/));
    expect(segmentationServiceMock.undo).toHaveBeenCalledTimes(1);
    expect(segmentationServiceMock.redo).toHaveBeenCalledTimes(1);

    expect(screen.queryByText('Preferences')).not.toBeInTheDocument();
    await user.click(screen.getByTitle('Open settings'));
    expect(screen.getByText('Preferences')).toBeInTheDocument();
    await user.click(screen.getByTitle('Close settings'));
    expect(screen.queryByText('Preferences')).not.toBeInTheDocument();
  });

  it('per-viewport MPR cycle — STACK → AXIAL → SAGITTAL → CORONAL → STACK (spec §3.3)', async () => {
    const user = userEvent.setup();
    const setPanelOrientation = vi.fn();
    useViewerStore.setState({
      ...useViewerStore.getState(),
      activeViewportId: 'panel_0',
      panelOrientationMap: { panel_0: 'STACK' },
      setPanelOrientation,
    });

    render(
      <Toolbar
        hasImages
        leftSlot={<span data-testid="left-slot-marker">left</span>}
      />,
    );

    expect(screen.getByTestId('left-slot-marker')).toBeInTheDocument();
    // STACK → active label is "MPR" (not blue); first click goes to AXIAL.
    const btn = screen.getByTestId('toolbar-mpr-cycle');
    expect(btn.dataset.activeOrientation).toBe('STACK');
    await user.click(btn);
    expect(setPanelOrientation).toHaveBeenLastCalledWith('panel_0', 'AXIAL');

    // Now simulate the orientation having advanced; cycle from CORONAL.
    useViewerStore.setState({
      ...useViewerStore.getState(),
      panelOrientationMap: { panel_0: 'CORONAL' },
    });
    await user.click(screen.getByTestId('toolbar-mpr-cycle'));
    expect(setPanelOrientation).toHaveBeenLastCalledWith('panel_0', 'STACK');
  });

  it('MPR button is "active" (blue) when the active viewport orientation ≠ STACK', () => {
    useViewerStore.setState({
      ...useViewerStore.getState(),
      activeViewportId: 'panel_0',
      panelOrientationMap: { panel_0: 'AXIAL' },
    });
    render(<Toolbar hasImages />);
    const btn = screen.getByTestId('toolbar-mpr-cycle');
    expect(btn.dataset.activeOrientation).toBe('AXIAL');
    expect(btn.className).toMatch(/bg-blue-600/);
  });

  it('supports dropdown close-on-outside-click and tags toggle active title', async () => {
    const user = userEvent.setup();
    const onToggleDicomPanel = vi.fn();
    const onApplyProtocol = vi.fn();

    useViewerStore.setState({
      ...useViewerStore.getState(),
      layout: 'custom',
      layoutConfig: { rows: 3, cols: 3, panelCount: 9 },
      sessionScans: [{ id: '1' } as any],
      currentProtocol: { id: BUILT_IN_PROTOCOLS[1].id, name: 'Current', layout: '2x2' } as any,
    });

    render(
      <Toolbar
        hasImages
        showDicomPanel
        onToggleDicomPanel={onToggleDicomPanel}
        onApplyProtocol={onApplyProtocol}
      />,
    );

    const layoutButton = screen.getByTitle('Viewport layout (Custom 3 x 3)');
    await user.click(layoutButton);
    expect(screen.getByRole('button', { name: '1 x 1' })).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('button', { name: '1 x 1' })).not.toBeInTheDocument();

    await user.click(screen.getByTitle('Hanging protocol'));
    expect(screen.getByRole('button', { name: new RegExp(BUILT_IN_PROTOCOLS[1].name) })).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('button', { name: new RegExp(BUILT_IN_PROTOCOLS[1].name) })).not.toBeInTheDocument();

    const tagsButton = screen.getByRole('button', { name: 'Tags' });
    expect(tagsButton).toHaveAttribute('title', 'Hide DICOM tags');
    await user.click(tagsButton);
    expect(onToggleDicomPanel).toHaveBeenCalledTimes(1);
  });

  // ─── MV-Phase 7.4: cheatsheet (spec §6.3) ──────────────────────────

  it('? opens the cheatsheet overlay; Escape closes it', () => {
    render(<Toolbar />);
    expect(screen.queryByTestId('cheatsheet-overlay')).toBeNull();
    fireEvent.keyDown(window, { key: '?' });
    expect(screen.queryByTestId('cheatsheet-overlay')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('cheatsheet-overlay')).toBeNull();
  });

  it('button tooltips carry the live hotkey suffix and update on remap (spec §3.11 / §6.4)', () => {
    render(<Toolbar />);
    // Default: Reset has 'R'; Pan has 'P'; Toggle invert has 'I'.
    expect(screen.getByTitle('Reset viewport (R)')).toBeInTheDocument();
    expect(screen.getByTitle('Pan (left-click drag) (P)')).toBeInTheDocument();
    expect(screen.getByTitle('Toggle invert (I)')).toBeInTheDocument();

    // Remap viewport.reset → Q via preferences; tooltip updates live.
    act(() => {
      usePreferencesStore.getState().setHotkeyOverride('viewport.reset', [{ key: 'q' }]);
    });
    expect(screen.queryByTitle('Reset viewport (R)')).toBeNull();
    expect(screen.getByTitle('Reset viewport (Q)')).toBeInTheDocument();
    act(() => usePreferencesStore.getState().resetHotkeys());
  });

  it('Shift+T toggles the DICOM Tags modal via onToggleDicomPanel (spec §10.1)', () => {
    const onToggleDicomPanel = vi.fn();
    render(<Toolbar onToggleDicomPanel={onToggleDicomPanel} />);
    fireEvent.keyDown(window, { key: 'T', shiftKey: true });
    expect(onToggleDicomPanel).toHaveBeenCalledTimes(1);
  });

  it('Shift+T is suppressed when focus is in an input (§6.7)', () => {
    const onToggleDicomPanel = vi.fn();
    render(
      <>
        <input data-testid="focusable-input-2" />
        <Toolbar onToggleDicomPanel={onToggleDicomPanel} />
      </>,
    );
    const input = screen.getByTestId('focusable-input-2');
    input.focus();
    fireEvent.keyDown(input, { key: 'T', shiftKey: true });
    expect(onToggleDicomPanel).not.toHaveBeenCalled();
  });

  it('? does NOT open the cheatsheet when focus is in an input (§6.7)', () => {
    render(
      <>
        <input data-testid="focusable-input" />
        <Toolbar />
      </>,
    );
    const input = screen.getByTestId('focusable-input');
    input.focus();
    fireEvent.keyDown(input, { key: '?' });
    expect(screen.queryByTestId('cheatsheet-overlay')).toBeNull();
  });
});
