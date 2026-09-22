import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContextToolbox from '../ContextToolbox';

/** Rebuild Phase 3, R3.6 — context toolbox (frozen mockup §4). */
function setup(over: Partial<React.ComponentProps<typeof ContextToolbox>> = {}) {
  const onSelectTool = vi.fn();
  render(
    <ContextToolbox kind="SEG" activeMemberName="Segment 2" activeToolId="brush" onSelectTool={onSelectTool} {...over} />,
  );
  return { onSelectTool };
}

describe('ContextToolbox', () => {
  it('adapts the tool set to the active kind', () => {
    const { rerender } = render(<ContextToolbox kind="RTSTRUCT" activeMemberName="GTV" activeToolId={null} onSelectTool={vi.fn()} />);
    expect(screen.getByText('Structure tools')).toBeTruthy();
    expect(screen.getByLabelText('Freehand')).toBeTruthy();
    expect(screen.queryByLabelText('Brush')).toBeNull(); // seg-only tool absent

    rerender(<ContextToolbox kind="SEG" activeMemberName="Seg 1" activeToolId={null} onSelectTool={vi.fn()} />);
    expect(screen.getByText('Segmentation tools')).toBeTruthy();
    expect(screen.getByLabelText('Brush')).toBeTruthy();
  });

  it('highlights the active tool (aria-pressed) and fires onSelectTool', async () => {
    const { onSelectTool } = setup();
    const brush = screen.getByLabelText('Brush');
    expect(brush.getAttribute('aria-pressed')).toBe('true');
    // Eraser is no longer a tool — erasing is a mode shared by every fill/erase-capable
    // tool. Any other tool serves to prove selection still fires.
    await userEvent.click(screen.getByLabelText('Threshold'));
    expect(onSelectTool).toHaveBeenCalledWith('threshold');
  });

  // The "planned" rule (a registered-but-unimplemented tool rendered disabled) was
  // removed with Circle Multi, its only instance. Every tool the toolbox offers is now
  // implemented; a tool unavailable in the current context is still disabled, which the
  // next case covers.
  it('disables tools with no FoR-matched viewport (D3)', () => {
    setup({ disabledToolIds: ['sphereScissors'] });
    expect((screen.getByLabelText('Sphere') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the SEG controls strip (opacity) + silent backup status when provided', async () => {
    const onOpacityChange = vi.fn();
    setup({
      controls: { activeSegmentLabel: 'Segment 2', opacity: 0.6, onOpacityChange },
      backupStatus: 'Backed up · 2s ago',
    });
    const slider = screen.getByLabelText('Labelmap opacity') as HTMLInputElement;
    expect(slider.value).toBe('60');
    expect(screen.getByText('Backed up · 2s ago')).toBeTruthy();
  });

  it('shows the backup row for a non-SEG kind too (it is not a SEG control)', () => {
    setup({ kind: 'SR', backupStatus: 'Backing up…', backupStatusKind: 'saving' });
    expect(screen.getByTestId('backup-status').textContent).toContain('Backing up…');
  });

  it('hides the backup row when there is no status', () => {
    setup({});
    expect(screen.queryByTestId('backup-status')).toBeNull();
  });

  it('shows the brush-size control and fires onBrushSizeChange', () => {
    const onBrushSizeChange = vi.fn();
    setup({
      controls: { activeSegmentLabel: 'Segment 2', opacity: 0.5, onOpacityChange: vi.fn(), brushSize: 12, onBrushSizeChange },
    });
    const slider = screen.getByLabelText('Brush size') as HTMLInputElement;
    expect(slider.value).toBe('12');
    fireEvent.change(slider, { target: { value: '30' } });
    expect(onBrushSizeChange).toHaveBeenCalledWith(30);
  });

  it('omits the brush-size control when brushSize is not provided', () => {
    setup({ controls: { activeSegmentLabel: 'Segment 2', opacity: 0.5, onOpacityChange: vi.fn() } });
    expect(screen.queryByLabelText('Brush size')).toBeNull();
  });

  it('renders icon-only (no labels) when compact', () => {
    setup({ compact: true });
    // label text is omitted in compact mode; the button still exists via aria-label
    expect(screen.getByLabelText('Brush')).toBeTruthy();
    expect(screen.queryByText('Brush')).toBeNull();
  });

  // ── Threshold window (the intensity gate for the threshold brush) ──

  const thresholdControls = (over: Record<string, unknown> = {}) => ({
    activeSegmentLabel: 'Segment 2',
    opacity: 0.5,
    onOpacityChange: vi.fn(),
    thresholdRange: [-100, 300] as [number, number],
    onThresholdRangeChange: vi.fn(),
    thresholdPresets: [
      { name: 'Soft Tissue', range: [-100, 300] as [number, number] },
      { name: 'Bone', range: [300, 3000] as [number, number] },
    ],
    ...over,
  });

  it('shows the threshold window only while the threshold brush is active', () => {
    const { rerender } = render(
      <ContextToolbox kind="SEG" activeMemberName="Seg 1" activeToolId="brush" onSelectTool={vi.fn()} controls={thresholdControls()} />,
    );
    // Plain brush active: the window has no effect on it, so it must not be shown.
    expect(screen.queryByTestId('threshold-controls')).toBeNull();

    rerender(
      <ContextToolbox kind="SEG" activeMemberName="Seg 1" activeToolId="threshold" onSelectTool={vi.fn()} controls={thresholdControls()} />,
    );
    expect(screen.getByTestId('threshold-controls')).toBeTruthy();
    expect((screen.getByLabelText('Threshold minimum') as HTMLInputElement).value).toBe('-100');
    expect((screen.getByLabelText('Threshold maximum') as HTMLInputElement).value).toBe('300');
  });

  it('edits either bound of the threshold window', () => {
    const onThresholdRangeChange = vi.fn();
    setup({ activeToolId: 'threshold', controls: thresholdControls({ onThresholdRangeChange }) });

    fireEvent.change(screen.getByLabelText('Threshold minimum'), { target: { value: '300' } });
    expect(onThresholdRangeChange).toHaveBeenCalledWith([300, 300]);

    fireEvent.change(screen.getByLabelText('Threshold maximum'), { target: { value: '3000' } });
    expect(onThresholdRangeChange).toHaveBeenCalledWith([-100, 3000]);
  });

  it('applies a preset window and reflects the matching preset in the select', () => {
    const onThresholdRangeChange = vi.fn();
    setup({ activeToolId: 'threshold', controls: thresholdControls({ onThresholdRangeChange }) });

    // The current range equals the Soft Tissue preset, so the select shows it.
    expect((screen.getByLabelText('Threshold preset') as HTMLSelectElement).value).toBe('Soft Tissue');

    fireEvent.change(screen.getByLabelText('Threshold preset'), { target: { value: 'Bone' } });
    expect(onThresholdRangeChange).toHaveBeenCalledWith([300, 3000]);
  });

  it('shows "Custom" when the range matches no preset', () => {
    setup({
      activeToolId: 'threshold',
      controls: thresholdControls({ thresholdRange: [7, 9] as [number, number] }),
    });
    expect((screen.getByLabelText('Threshold preset') as HTMLSelectElement).value).toBe('');
  });

  it('omits the threshold window when no range is supplied', () => {
    setup({ activeToolId: 'threshold', controls: { activeSegmentLabel: 'Segment 2', opacity: 0.5, onOpacityChange: vi.fn() } });
    expect(screen.queryByTestId('threshold-controls')).toBeNull();
  });
});
