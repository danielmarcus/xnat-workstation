import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Container } from '@shared/types/annotation';
import ContainerRow from '../ContainerRow';

/** Rebuild Phase 3, R3.4 — container header row behaviour (frozen mockup §2/§3). */
function makeContainer(over: Partial<Container> = {}): Container {
  return {
    id: 'rt-1',
    kind: 'RTSTRUCT',
    label: 'Pelvis_v3',
    members: [{ id: '1', label: 'GTV', visible: true, locked: false }],
    source: { projectId: 'P', subjectId: 'S', sessionId: 'E', sourceScanId: '4' },
    ...over,
  };
}

function setup(over: Partial<React.ComponentProps<typeof ContainerRow>> = {}) {
  const cbs = {
    onToggleExpand: vi.fn(), onApproveToggle: vi.fn(), onAddMember: vi.fn(),
    onSave: vi.fn(), onKebab: vi.fn(), onDelete: vi.fn(), onRename: vi.fn(),
  };
  render(<ContainerRow container={makeContainer()} expanded onToggleExpand={cbs.onToggleExpand} onApproveToggle={cbs.onApproveToggle} onAddMember={cbs.onAddMember} onSave={cbs.onSave} onKebab={cbs.onKebab} onDelete={cbs.onDelete} onRename={cbs.onRename} {...over} />);
  return cbs;
}

describe('ContainerRow', () => {
  it('renders the name + member count', () => {
    setup();
    expect(screen.getByText('Pelvis_v3')).toBeTruthy();
    expect(screen.getByTestId('member-count').textContent).toBe('1');
  });

  it('shows a dirty dot when dirty, and a cross-panel pill when clean + rendering elsewhere', () => {
    const { rerender } = render(
      <ContainerRow container={makeContainer({ dirty: true })} expanded onToggleExpand={vi.fn()} onApproveToggle={vi.fn()} onAddMember={vi.fn()} onSave={vi.fn()} onKebab={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} />,
    );
    expect(screen.getByTestId('dirty-dot')).toBeTruthy();
    rerender(
      <ContainerRow container={makeContainer({ dirty: false })} expanded crossPanelCount={2} onToggleExpand={vi.fn()} onApproveToggle={vi.fn()} onAddMember={vi.fn()} onSave={vi.fn()} onKebab={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} />,
    );
    expect(screen.getByText('↗ 2')).toBeTruthy();
  });

  it('Save is enabled only when dirty & unapproved', async () => {
    const cbs = setup({ container: makeContainer({ dirty: true }) });
    const save = screen.getByLabelText('Save container') as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    await userEvent.click(save);
    expect(cbs.onSave).toHaveBeenCalled();
  });

  it('approved container: approve toggle shows revoke, and add/save/delete are locked (D7.11)', () => {
    setup({ container: makeContainer({ approval: 'APPROVED', dirty: true }) });
    expect(screen.getByLabelText('Revoke approval')).toBeTruthy();
    expect((screen.getByLabelText('Add member') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Save container') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Delete container') as HTMLButtonElement).disabled).toBe(true);
  });

  it('double-click name → inline edit; Enter commits onRename', async () => {
    const cbs = setup();
    await userEvent.dblClick(screen.getByText('Pelvis_v3'));
    const input = screen.getByLabelText('Rename container') as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, 'Pelvis_v4{Enter}');
    expect(cbs.onRename).toHaveBeenCalledWith('Pelvis_v4');
  });

  it('fires expand / approve / add / kebab / delete callbacks', async () => {
    const cbs = setup();
    await userEvent.click(screen.getByLabelText('Collapse'));
    await userEvent.click(screen.getByLabelText('Approve'));
    await userEvent.click(screen.getByLabelText('Add member'));
    await userEvent.click(screen.getByLabelText('Container menu'));
    await userEvent.click(screen.getByLabelText('Delete container'));
    expect(cbs.onToggleExpand).toHaveBeenCalled();
    expect(cbs.onApproveToggle).toHaveBeenCalled();
    expect(cbs.onAddMember).toHaveBeenCalled();
    expect(cbs.onKebab).toHaveBeenCalled();
    expect(cbs.onDelete).toHaveBeenCalled();
  });
});
