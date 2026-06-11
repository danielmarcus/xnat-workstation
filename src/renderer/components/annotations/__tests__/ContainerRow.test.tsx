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

  it('shows the annotation XNAT scan number next to the label when persisted, and nothing for a never-saved container', () => {
    const { rerender } = render(
      <ContainerRow
        container={makeContainer({ source: { projectId: 'P', subjectId: 'S', sessionId: 'E', sourceScanId: '4', scanId: '3003' } })}
        expanded onToggleExpand={vi.fn()} onApproveToggle={vi.fn()} onAddMember={vi.fn()} onSave={vi.fn()} onKebab={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} />,
    );
    expect(screen.getByTestId('container-scan-rt-1').textContent).toBe('#3003');

    // A new (unsaved) container has no scanId yet → no scan token rendered.
    rerender(
      <ContainerRow container={makeContainer()} expanded onToggleExpand={vi.fn()} onApproveToggle={vi.fn()} onAddMember={vi.fn()} onSave={vi.fn()} onKebab={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} />,
    );
    expect(screen.queryByTestId('container-scan-rt-1')).toBeNull();
  });

  it('opens the kebab menu and fires hide-all / export actions; Revert only shows when wired', async () => {
    const onSetAllVisible = vi.fn();
    const onExportDicom = vi.fn();
    const onExportCsv = vi.fn();
    // Members default visible:true → menu offers "Hide all" (sets visible=false).
    setup({ onSetAllVisible, onExportDicom, onExportCsv });

    // Menu is closed until the kebab is clicked.
    expect(screen.queryByTestId('container-menu-rt-1')).toBeNull();
    await userEvent.click(screen.getByLabelText('Container menu'));
    expect(screen.getByTestId('container-menu-rt-1')).toBeTruthy();

    // Export items are always present (fully supported).
    expect(screen.getByTestId('menu-export-dicom-rt-1')).toBeTruthy();
    expect(screen.getByTestId('menu-export-csv-rt-1')).toBeTruthy();
    // Revert is absent when no onRevert handler is provided.
    expect(screen.queryByTestId('menu-revert-rt-1')).toBeNull();

    await userEvent.click(screen.getByTestId('menu-visibility-rt-1'));
    expect(onSetAllVisible).toHaveBeenCalledWith(false);
    // Acting on an item closes the menu.
    expect(screen.queryByTestId('container-menu-rt-1')).toBeNull();
  });

  it('Revert menu item is enabled only when dirty', async () => {
    const onRevert = vi.fn();
    const { rerender } = render(
      <ContainerRow container={makeContainer({ dirty: false })} expanded onRevert={onRevert}
        onToggleExpand={vi.fn()} onApproveToggle={vi.fn()} onAddMember={vi.fn()} onSave={vi.fn()} onKebab={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} />,
    );
    await userEvent.click(screen.getByLabelText('Container menu'));
    expect((screen.getByTestId('menu-revert-rt-1') as HTMLButtonElement).disabled).toBe(true);

    // Menu stays open across the prop change; re-query (re-clicking would toggle it shut).
    rerender(
      <ContainerRow container={makeContainer({ dirty: true })} expanded onRevert={onRevert}
        onToggleExpand={vi.fn()} onApproveToggle={vi.fn()} onAddMember={vi.fn()} onSave={vi.fn()} onKebab={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} />,
    );
    const revert = screen.getByTestId('menu-revert-rt-1') as HTMLButtonElement;
    expect(revert.disabled).toBe(false);
    await userEvent.click(revert);
    expect(onRevert).toHaveBeenCalled();
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

  it('starts in inline-edit mode when autoEdit is set (create-in-edit-mode, D7.6)', () => {
    const onEditConsumed = vi.fn();
    setup({ autoEdit: true, onEditConsumed });
    expect(screen.getByLabelText('Rename container')).toBeTruthy();
    expect(onEditConsumed).toHaveBeenCalled();
  });

  it('fires onCommitName when the name edit is accepted (Enter), not on Esc-cancel', async () => {
    const onCommitName = vi.fn();
    setup({ onCommitName });
    await userEvent.dblClick(screen.getByText('Pelvis_v3'));
    await userEvent.keyboard('{Escape}');
    expect(onCommitName).not.toHaveBeenCalled(); // Esc cancels — no advance
    await userEvent.dblClick(screen.getByText('Pelvis_v3'));
    await userEvent.keyboard('{Enter}');
    expect(onCommitName).toHaveBeenCalled(); // Enter commits — advances the create flow
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
