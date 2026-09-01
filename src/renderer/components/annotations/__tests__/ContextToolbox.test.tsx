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
    await userEvent.click(screen.getByLabelText('Eraser'));
    expect(onSelectTool).toHaveBeenCalledWith('eraser');
  });

  it('renders planned tools flat-greyed and disabled', () => {
    setup();
    const planned = screen.getByLabelText('Dyn. Thresh') as HTMLButtonElement;
    expect(planned.disabled).toBe(true);
  });

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
});
