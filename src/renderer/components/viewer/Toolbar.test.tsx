import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolName, WL_PRESETS } from '@shared/types/viewer';
import { BUILT_IN_PROTOCOLS } from '@shared/types/hangingProtocol';
import Toolbar from './Toolbar';
import { useViewerStore } from '../../stores/viewerStore';
import { useSegmentationStore } from '../../stores/segmentationStore';

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
      mprActive: false,
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

    await user.click(screen.getByTitle('Reset viewport'));
    await user.click(screen.getByTitle('Toggle invert'));
    await user.click(screen.getByTitle('Rotate 90°'));
    await user.click(screen.getByTitle('Flip horizontal'));
    await user.click(screen.getByTitle('Flip vertical'));
    await user.click(screen.getByTitle('Play cine'));
    await user.click(screen.getByRole('button', { name: 'MPR' }));
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
    expect(onToggleMPR).toHaveBeenCalledTimes(1);
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

  it('handles undo/redo enablement and settings modal lifecycle', async () => {
    const user = userEvent.setup();

    useSegmentationStore.setState({
      ...useSegmentationStore.getState(),
      canUndo: false,
      canRedo: false,
    });

    const view = render(<Toolbar />);
    const undoButton = screen.getByTitle('Undo (Ctrl+Z)');
    const redoButton = screen.getByTitle('Redo (Ctrl+Shift+Z)');
    expect(undoButton).toBeDisabled();
    expect(redoButton).toBeDisabled();

    useSegmentationStore.setState({
      ...useSegmentationStore.getState(),
      canUndo: true,
      canRedo: true,
    });
    view.rerender(<Toolbar />);

    await user.click(screen.getByTitle('Undo (Ctrl+Z)'));
    await user.click(screen.getByTitle('Redo (Ctrl+Shift+Z)'));
    expect(segmentationServiceMock.undo).toHaveBeenCalledTimes(1);
    expect(segmentationServiceMock.redo).toHaveBeenCalledTimes(1);

    expect(screen.queryByText('Preferences')).not.toBeInTheDocument();
    await user.click(screen.getByTitle('Open settings'));
    expect(screen.getByText('Preferences')).toBeInTheDocument();
    await user.click(screen.getByTitle('Close settings'));
    expect(screen.queryByText('Preferences')).not.toBeInTheDocument();
  });

  it('renders mpr hints and disabled controls in MPR mode, including left slot', async () => {
    const user = userEvent.setup();
    const onToggleMPR = vi.fn();
    useViewerStore.setState({
      ...useViewerStore.getState(),
      mprActive: true,
      activeViewportId: 'panel_0',
      cineStates: { panel_0: { isPlaying: true, fps: 25 } },
    });

    render(
      <Toolbar
        hasImages={false}
        onToggleMPR={onToggleMPR}
        leftSlot={<span data-testid="left-slot-marker">left</span>}
      />,
    );

    expect(screen.getByTestId('left-slot-marker')).toBeInTheDocument();
    expect(screen.getByText(/Crosshairs: left-click/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pan' })).not.toBeInTheDocument();
    expect(screen.queryByTitle('15 FPS')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'MPR' })).toHaveAttribute('title', 'Exit MPR mode');

    await user.click(screen.getByRole('button', { name: 'MPR' }));
    expect(onToggleMPR).toHaveBeenCalledTimes(1);
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
});
