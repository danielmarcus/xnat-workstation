import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OperationsSection from '../OperationsSection';
import { SEG_OPERATIONS } from '../toolCatalog';

/** annotation-panel-modes: the operation drawer (R5-A) and its grouped picker (R4-A). */
const OPS = [...SEG_OPERATIONS, { id: 'module:t', label: 'Intensity threshold', title: 't', group: 'Modules' as const }];

function setup(over: Partial<React.ComponentProps<typeof OperationsSection>> = {}) {
  const props = {
    operations: OPS, openId: null, onOpen: vi.fn(), collapsed: false, onToggleCollapsed: vi.fn(), onClose: vi.fn(), summary: '',
    ...over,
  };
  render(<OperationsSection {...props}><div data-testid="body" /></OperationsSection>);
  return props;
}

describe('OperationsSection', () => {
  it('the picker is a grouped menu: Clean · Fill in · Segment · Check · Modules', async () => {
    const p = setup();
    expect(screen.getByRole('button', { name: 'Operation' }).textContent).toContain('Open an operation');
    await userEvent.click(screen.getByRole('button', { name: 'Operation' }));
    const menu = screen.getByRole('menu', { name: 'Operations' });
    expect(within(menu).getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Clean', 'Fill in', 'Segment', 'Check', 'Modules']);
    const items = (g: string) => within(within(menu).getByRole('group', { name: g })).getAllByRole('menuitem').map((b) => b.textContent);
    expect(items('Clean')).toEqual(['Cleanup']);
    expect(items('Fill in')).toEqual(['Propagate', 'Interpolate']);
    expect(items('Segment')).toEqual(['Seeded segmentation', 'Region competition']);
    expect(items('Check')).toEqual(['3D QC']);
    expect(items('Modules')).toEqual(['Intensity threshold']);
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Interpolate' }));
    expect(p.onOpen).toHaveBeenCalledWith('interpolate');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Escape closes the menu without picking', async () => {
    const p = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Operation' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(p.onOpen).not.toHaveBeenCalled();
  });

  it('names the open operation in its band, with no target chip (R6), and drags to resize', () => {
    const onHeightChange = vi.fn();
    setup({ openId: 'seeded', height: 300, onHeightChange });
    expect(screen.getByRole('button', { name: 'Operation' }).textContent).toContain('Seeded segmentation');
    expect(screen.queryByTestId('sheet-target')).toBeNull();
    expect(screen.getByTestId('operations-section').style.flex).toBe('0 10 300px');
    const handle = screen.getByRole('separator', { name: 'Resize operation' });
    fireEvent.pointerDown(handle, { clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 450, pointerId: 1 });
    // jsdom lays nothing out, so the drag starts from the stated height.
    expect(onHeightChange).toHaveBeenLastCalledWith(expect.any(Number));
    fireEvent.pointerUp(handle, { pointerId: 1 });
  });

  it('collapsed, it is the band and a one-line summary — no body, no resize handle', () => {
    setup({ openId: 'cleanup', collapsed: true, summary: 'Preview pending', onHeightChange: vi.fn() });
    expect(screen.getByTestId('operation-summary').textContent).toBe('Preview pending');
    expect(screen.queryByTestId('body')).toBeNull();
    expect(screen.queryByRole('separator')).toBeNull();
  });
});
