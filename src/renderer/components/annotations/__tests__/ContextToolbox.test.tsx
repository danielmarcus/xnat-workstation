import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContextToolbox from '../ContextToolbox';

/** Rebuild Phase 3, R3.6 — context toolbox (frozen mockup §4). */
const CONTROLS = { opacity: 0.5, onOpacityChange: () => {} };

function setup(over: Partial<React.ComponentProps<typeof ContextToolbox>> = {}) {
  const onSelectTool = vi.fn();
  render(
    <ContextToolbox kind="SEG" activeMemberName="Segment 2" activeToolId="brush" onSelectTool={onSelectTool} controls={CONTROLS} {...over} />,
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

  it('highlights the active tool\u2019s family and its modes, and a mode picks the tool', async () => {
    const { onSelectTool } = setup({ activeToolId: 'sphereBrush' });
    expect(screen.getByLabelText('Brush').getAttribute('aria-pressed')).toBe('true');
    const kernel = screen.getByRole('group', { name: 'Kernel' });
    const limit = screen.getByRole('group', { name: 'Limit' });
    expect(within(kernel).getByRole('button', { name: '3D' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(limit).getByRole('button', { name: 'None' }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(within(limit).getByRole('button', { name: 'Window' }));
    expect(onSelectTool).toHaveBeenLastCalledWith('sphereThreshold');
    // 3D has no Edges limit: the nearest tool that has it is the 2D Smart Brush.
    await userEvent.click(within(limit).getByRole('button', { name: 'Edges' }));
    expect(onSelectTool).toHaveBeenLastCalledWith('smartBrush');
  });

  it('a family button re-activates the family\u2019s last-used tool', async () => {
    const { onSelectTool } = setup({ activeToolId: 'paintFill', lastToolOfFamily: { brush: 'dynamicThreshold' } });
    await userEvent.click(screen.getByLabelText('Brush'));
    expect(onSelectTool).toHaveBeenLastCalledWith('dynamicThreshold');
    await userEvent.click(screen.getByLabelText('Shape'));
    expect(onSelectTool).toHaveBeenLastCalledWith('rectangleScissors');
  });

  it('names the edited member once, in the options strip\u2019s chip, which reveals the row', async () => {
    const onRevealEditing = vi.fn();
    setup({ editing: { member: 'Segment 2', container: 'Liver', color: 'rgb(1, 2, 3)' }, onRevealEditing });
    expect(screen.getAllByText('Segment 2')).toHaveLength(1);
    expect(screen.getByTestId('toolbox-header').textContent).not.toContain('Segment 2');
    await userEvent.click(screen.getByTestId('editing-chip'));
    expect(onRevealEditing).toHaveBeenCalled();
  });

  it('kinds without controls still show the editing chip', () => {
    setup({ kind: 'SR', controls: undefined, editing: { member: 'Length 1', container: 'Measurements', color: '' } });
    expect(screen.getByTestId('editing-chip').textContent).toContain('Length 1');
  });

  // The "planned" rule (a registered-but-unimplemented tool rendered disabled) was
  // removed with Circle Multi, its only instance. Every tool the toolbox offers is now
  // implemented; a tool unavailable in the current context is still disabled, which the
  // next case covers.
  it('disables tools with no FoR-matched viewport (D3)', () => {
    setup({ activeToolId: 'rectangleScissors', disabledToolIds: ['sphereScissors'] });
    expect((screen.getByRole('button', { name: 'Sphere' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Circle' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables a tool this machine cannot run, with the reason as its tooltip', async () => {
    const { onSelectTool } = setup({ unavailableTools: { region: 'needs WebGPU', regionPlus: 'needs WebGPU' } });
    const b = screen.getByLabelText('Region') as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.title).toBe('needs WebGPU');
    await userEvent.click(b);
    expect(onSelectTool).not.toHaveBeenCalled();
  });

  it('Segmentation shows one row of seven families, with no tabs (R3-B)', () => {
    render(<ContextToolbox kind="SEG" activeMemberName="S" activeToolId={null} onSelectTool={vi.fn()} />);
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    const grid = screen.getByTestId('toolbox-grid');
    expect(Array.from(grid.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'))).toEqual([
      'Select', 'Brush', 'Fill', 'Shape', 'Contour', 'Region', 'Trace',
    ]);
    expect(grid.className).toContain('grid-cols-7');
  });

  it('lays other kinds\u2019 grids out in the requested number of columns', () => {
    const { rerender } = render(<ContextToolbox kind="SR" activeMemberName="S" activeToolId={null} onSelectTool={vi.fn()} columns={4} />);
    expect(screen.getByTestId('toolbox-grid').className).toContain('grid-cols-4');
    rerender(<ContextToolbox kind="SR" activeMemberName="S" activeToolId={null} onSelectTool={vi.fn()} />);
    expect(screen.getByTestId('toolbox-grid').className).toContain('grid-cols-3');
  });

  it('other kinds have no tabs either', () => {
    render(<ContextToolbox kind="RTSTRUCT" activeMemberName="GTV" activeToolId={null} onSelectTool={vi.fn()} />);
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
  });

  it('the backup status sits in the header, above the grid, so it cannot change the toolbox height', () => {
    setup({ backupStatus: 'Backed up · 2s ago' });
    const status = screen.getByTestId('backup-status');
    const grid = screen.getByTestId('toolbox-grid');
    expect(status.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the SEG controls strip (opacity) + silent backup status when provided', async () => {
    const onOpacityChange = vi.fn();
    setup({
      controls: { opacity: 0.6, onOpacityChange },
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
      controls: { opacity: 0.5, onOpacityChange: vi.fn(), brushSize: 12, onBrushSizeChange },
    });
    const slider = screen.getByLabelText('Brush size') as HTMLInputElement;
    expect(slider.value).toBe('12');
    fireEvent.change(slider, { target: { value: '30' } });
    expect(onBrushSizeChange).toHaveBeenCalledWith(30);
  });

  it('omits the brush-size control when brushSize is not provided', () => {
    setup({ controls: { opacity: 0.5, onOpacityChange: vi.fn() } });
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
    setup({ activeToolId: 'threshold', controls: { opacity: 0.5, onOpacityChange: vi.fn() } });
    expect(screen.queryByTestId('threshold-controls')).toBeNull();
  });

  it('the ROI limit is a header toggle, not a tool: pressed while drawing, with Clear once drawn', async () => {
    const onToggleDraw = vi.fn();
    const onClear = vi.fn();
    const { rerender } = render(
      <ContextToolbox kind="SEG" activeMemberName="S" activeToolId="levelTrace" onSelectTool={vi.fn()}
        roiLimit={{ drawing: false, drawn: false, onToggleDraw, onClear }} />,
    );
    const roi = screen.getByRole('button', { name: 'ROI limit' });
    expect(screen.getByTestId('toolbox-header').contains(roi)).toBe(true);
    expect(roi.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByLabelText('Clear ROI limit')).toBeNull();
    await userEvent.click(roi);
    expect(onToggleDraw).toHaveBeenCalled();
    rerender(
      <ContextToolbox kind="SEG" activeMemberName="S" activeToolId="roiLimit" onSelectTool={vi.fn()}
        roiLimit={{ drawing: true, drawn: true, onToggleDraw, onClear }} />,
    );
    expect(screen.getByRole('button', { name: 'ROI limit' }).getAttribute('aria-pressed')).toBe('true');
    // Drawing the ROI limit leaves no family pressed.
    expect(screen.getByTestId('toolbox-grid').querySelector('[aria-pressed="true"]')).toBeNull();
    await userEvent.click(screen.getByLabelText('Clear ROI limit'));
    expect(onClear).toHaveBeenCalled();
  });
});
