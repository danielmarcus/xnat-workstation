import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SmartToolControls from '../SmartToolControls';
import { LEVEL_TRACE_DEFAULTS, SMART_BRUSH_DEFAULTS } from '../../../stores/semiAutoStore';
import type { SemiAutoControlsModel } from '../../../hooks/useSemiAutoControls';

/** annotation-panel-modes R7-A: essentials on show, the rest under More, with a changed dot. */
function model(over: Partial<SemiAutoControlsModel> = {}): SemiAutoControlsModel {
  return {
    levelTrace: { ...LEVEL_TRACE_DEFAULTS }, setLevelTrace: vi.fn(),
    smartBrush: { ...SMART_BRUSH_DEFAULTS }, setSmartBrush: vi.fn(),
    roiDrawn: false, roiHere: false, clearRoi: vi.fn(), readGuardFromRoi: vi.fn(), message: null,
    ...over,
  };
}

describe('SmartToolControls: essentials and More', () => {
  it('Level Trace shows its essentials, folds the rest under More, and More opens them', async () => {
    render(<SmartToolControls toolId="levelTrace" m={model()} />);
    expect(screen.getByRole('group', { name: 'Band' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Edge guard' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Smoothing' })).toBeNull();
    expect(screen.queryByTestId('more-changed')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /More/ }));
    expect(screen.getByRole('group', { name: 'Smoothing' })).toBeTruthy();
  });

  it('More shows a dot while a folded setting differs from its default — and only then', () => {
    const { rerender } = render(<SmartToolControls toolId="levelTrace" m={model({ levelTrace: { ...LEVEL_TRACE_DEFAULTS, huTolerance: 250 } })} />);
    expect(screen.queryByTestId('more-changed'), 'an essential changed: nothing hidden differs').toBeNull();
    rerender(<SmartToolControls toolId="levelTrace" m={model({ levelTrace: { ...LEVEL_TRACE_DEFAULTS, smoothing: 'strong' } })} />);
    expect(screen.getByTestId('more-changed')).toBeTruthy();
    rerender(<SmartToolControls toolId="levelTrace" m={model({ levelTrace: { ...LEVEL_TRACE_DEFAULTS, guard: { lo: 0, hi: 10 } } })} />);
    expect(screen.getByTestId('more-changed')).toBeTruthy();
  });

  it('Smart Brush keeps spacing under More, with the dot when it is changed', () => {
    const { rerender } = render(<SmartToolControls toolId="smartBrush" m={model()} />);
    expect(screen.getByLabelText('Tolerance')).toBeTruthy();
    expect(screen.queryByLabelText('Spacing')).toBeNull();
    expect(screen.queryByTestId('more-changed')).toBeNull();
    rerender(<SmartToolControls toolId="smartBrush" m={model({ smartBrush: { ...SMART_BRUSH_DEFAULTS, spacingPx: 5 } })} />);
    expect(screen.getByTestId('more-changed')).toBeTruthy();
  });
});
