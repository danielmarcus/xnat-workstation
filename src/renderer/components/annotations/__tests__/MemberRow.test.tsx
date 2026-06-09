import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Member } from '@shared/types/annotation';
import MemberRow from '../MemberRow';

/** Rebuild Phase 3, R3.5 — member row behaviour (frozen mockup §2/§8). */
function makeMember(over: Partial<Member> = {}): Member {
  return { id: '1', label: 'GTV_primary', color: [239, 68, 68, 255], visible: true, locked: false, ...over };
}

function setup(over: Partial<React.ComponentProps<typeof MemberRow>> = {}) {
  const cbs = {
    onSelect: vi.fn(), onActivate: vi.fn(), onCycleVisibility: vi.fn(),
    onToggleLock: vi.fn(), onDelete: vi.fn(), onRename: vi.fn(),
  };
  render(
    <MemberRow
      member={makeMember()} visibility="filled" lockState="unlocked" active={false} selected={false}
      metric="12 sl" onSelect={cbs.onSelect} onActivate={cbs.onActivate} onCycleVisibility={cbs.onCycleVisibility}
      onToggleLock={cbs.onToggleLock} onDelete={cbs.onDelete} onRename={cbs.onRename} {...over}
    />,
  );
  return cbs;
}

describe('MemberRow', () => {
  it('renders label + geometry metric', () => {
    setup();
    expect(screen.getByText('GTV_primary')).toBeTruthy();
    expect(screen.getByText('12 sl')).toBeTruthy();
  });

  it('shows the active indicator when active', () => {
    setup({ active: true });
    expect(screen.getByTestId('active-indicator')).toBeTruthy();
  });

  it('single-click selects (non-additive); ctrl-click selects additively; double-click activates', async () => {
    const cbs = setup();
    const row = screen.getByTestId('member-row-1');

    fireEvent.click(row);
    expect(cbs.onSelect).toHaveBeenLastCalledWith(false);

    cbs.onSelect.mockClear();
    fireEvent.click(row, { ctrlKey: true });
    expect(cbs.onSelect).toHaveBeenLastCalledWith(true);

    fireEvent.dblClick(row);
    expect(cbs.onActivate).toHaveBeenCalled();
  });

  it('cycles visibility and toggles lock via their controls', async () => {
    const cbs = setup();
    await userEvent.click(screen.getByLabelText(/Cycle visibility/));
    expect(cbs.onCycleVisibility).toHaveBeenCalled();
    await userEvent.click(screen.getByLabelText('Toggle lock'));
    expect(cbs.onToggleLock).toHaveBeenCalled();
  });

  it('cross-series member shows its source series + no lock control (read-only here, D9)', () => {
    setup({ eligibility: 'cross-series', sourceSeriesLabel: 'T1 SAG', metric: '86 cm³' });
    expect(screen.getByText('T1 SAG')).toBeTruthy();
    expect(screen.queryByLabelText('Toggle lock')).toBeNull();
  });

  it('different-FoR member shows "not here" and renders no edit controls (A2d)', () => {
    setup({ eligibility: 'different-for' });
    expect(screen.getByText('diff FoR')).toBeTruthy();
    expect(screen.getByText('not here')).toBeTruthy();
    expect(screen.queryByLabelText('Delete member')).toBeNull();
    expect(screen.queryByLabelText(/Cycle visibility/)).toBeNull();
  });

  it('interpolated provenance shows the "auto" marker', () => {
    setup({ provenance: 'interpolated' });
    expect(screen.getByText('auto')).toBeTruthy();
  });

  it('disables delete when locked (session or approved) — locked rows are not deletable', () => {
    const { rerender } = render(
      <MemberRow member={makeMember()} visibility="filled" lockState="locked" active={false} selected={false} onSelect={vi.fn()} onActivate={vi.fn()} onCycleVisibility={vi.fn()} onToggleLock={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} />,
    );
    expect((screen.getByLabelText('Delete member') as HTMLButtonElement).disabled).toBe(true);
    // ...but the lock button stays clickable so the user can unlock
    expect((screen.getByLabelText('Toggle lock') as HTMLButtonElement).disabled).toBe(false);

    rerender(<MemberRow member={makeMember()} visibility="filled" lockState="approved" active={false} selected={false} onSelect={vi.fn()} onActivate={vi.fn()} onCycleVisibility={vi.fn()} onToggleLock={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} />);
    expect((screen.getByLabelText('Delete member') as HTMLButtonElement).disabled).toBe(true);
  });

  it('starts in inline-edit mode when autoEdit is set (create-in-edit-mode, D7.6)', () => {
    const onEditConsumed = vi.fn();
    setup({ autoEdit: true, onEditConsumed });
    expect(screen.getByLabelText('Rename member')).toBeTruthy(); // input shown immediately
    expect(onEditConsumed).toHaveBeenCalled();
  });
});
