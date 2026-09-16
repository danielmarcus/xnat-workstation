import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog, ConflictDialog, LeaveUnsavedDialog, NameEntryDialog, ReviewUnsavedDialog } from '../dialogs';

/** Rebuild Phase 3, R3.7 — dialogs (frozen mockup §5). */
describe('ConfirmDialog', () => {
  it('renders title/body and fires confirm/cancel', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog title="Delete “CTV_54”?" body="18 contoured slices." confirmLabel="Delete" variant="danger" onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByText('Delete “CTV_54”?')).toBeTruthy();
    await userEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
    await userEvent.click(screen.getByText('Delete'));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('disables both buttons and shows the busy label while a confirm is in flight', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog title="Delete from XNAT?" confirmLabel="Delete from XNAT" busyLabel="Deleting…" variant="danger" busy onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByText('Deleting…')).toBeTruthy();
    const buttons = screen.getAllByRole('button') as HTMLButtonElement[];
    expect(buttons.every((b) => b.disabled)).toBe(true);
    await userEvent.click(screen.getByText('Deleting…'));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('surfaces an error in red and turns the confirm button into a Retry', () => {
    render(<ConfirmDialog title="Delete from XNAT?" confirmLabel="Delete from XNAT" variant="danger" error="Server said no." onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toBe('Server said no.');
    expect(screen.getByText('Retry')).toBeTruthy();
  });
});

describe('NameEntryDialog', () => {
  it('pre-fills the default name and creates with name + color', async () => {
    const onCreate = vi.fn();
    render(<NameEntryDialog title="New structure" defaultName="ROI 1" onCreate={onCreate} onCancel={vi.fn()} />);
    const input = screen.getByLabelText('Name') as HTMLInputElement;
    expect(input.value).toBe('ROI 1');
    await userEvent.click(screen.getByText('Create'));
    expect(onCreate).toHaveBeenCalledWith('ROI 1', expect.any(String));
  });

  it('disables Create when the name is blank', async () => {
    render(<NameEntryDialog title="New" defaultName="x" onCreate={vi.fn()} onCancel={vi.fn()} />);
    const input = screen.getByLabelText('Name') as HTMLInputElement;
    await userEvent.clear(input);
    expect((screen.getByText('Create') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('ConflictDialog', () => {
  it('offers the three H7 resolutions', async () => {
    const onKeepLocal = vi.fn();
    const onDiscardLocal = vi.fn();
    const onInspect = vi.fn();
    render(<ConflictDialog containerLabel="Pelvis_v3" onKeepLocal={onKeepLocal} onDiscardLocal={onDiscardLocal} onInspect={onInspect} onCancel={vi.fn()} />);
    await userEvent.click(screen.getByText(/Keep local/));
    await userEvent.click(screen.getByText(/Discard local/));
    await userEvent.click(screen.getByText(/Inspect differences/));
    expect(onKeepLocal).toHaveBeenCalled();
    expect(onDiscardLocal).toHaveBeenCalled();
    expect(onInspect).toHaveBeenCalled();
  });
});

describe('ReviewUnsavedDialog', () => {
  const entries = [
    { containerId: 'a', label: 'Segment 1', isOtherSession: false },
    { containerId: 'b', label: 'Tumor', isOtherSession: true, sessionLabel: 'CT_BRAIN_01' },
  ];

  it('groups current-session vs held-over work and labels the other session', () => {
    render(<ReviewUnsavedDialog entries={entries} onSaveOne={vi.fn()} onSaveAll={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('This session')).toBeTruthy();
    expect(screen.getByText('Held from other sessions')).toBeTruthy();
    expect(screen.getByText(/CT_BRAIN_01/)).toBeTruthy();
  });

  it('fires onSaveOne for a row and onSaveAll for the footer', async () => {
    const onSaveOne = vi.fn();
    const onSaveAll = vi.fn();
    render(<ReviewUnsavedDialog entries={entries} onSaveOne={onSaveOne} onSaveAll={onSaveAll} onClose={vi.fn()} />);
    // The first row's Save button.
    await userEvent.click(screen.getAllByText('Save')[0]);
    expect(onSaveOne).toHaveBeenCalledWith('a');
    await userEvent.click(screen.getByText('Save all'));
    expect(onSaveAll).toHaveBeenCalled();
  });

  it('shows the all-saved state and no Save-all when there is nothing unsaved', () => {
    render(<ReviewUnsavedDialog entries={[]} onSaveOne={vi.fn()} onSaveAll={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/All annotations saved/)).toBeTruthy();
    expect(screen.queryByText('Save all')).toBeNull();
  });
});

/**
 * LeaveUnsavedDialog (proposal §4.2) — the one place in the app where unsaved work can
 * deliberately be dropped, so the wording and the default matter (proposal §7). It must
 * name what is leaving rather than say "unsaved changes", Cancel must be the default, and
 * Discard must not be reachable by pressing Enter.
 */
describe('LeaveUnsavedDialog', () => {
  const entries = [
    { containerId: 'c1', label: 'Tumor' },
    { containerId: 'c2', label: 'CTV_54' },
  ];

  it('names the containers being left rather than saying "unsaved changes"', () => {
    render(
      <LeaveUnsavedDialog entries={entries} leavingLabel="scan 4" onSave={vi.fn()} onDiscard={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText('Tumor')).toBeTruthy();
    expect(screen.getByText('CTV_54')).toBeTruthy();
    expect(screen.getByText(/scan 4/)).toBeTruthy();
  });

  it('fires save / discard / cancel', async () => {
    const onSave = vi.fn(), onDiscard = vi.fn(), onCancel = vi.fn();
    render(<LeaveUnsavedDialog entries={entries} onSave={onSave} onDiscard={onDiscard} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole('button', { name: /^save/i }));
    expect(onSave).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /discard/i }));
    expect(onDiscard).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('focuses Cancel, so the safe action is the one Enter takes', async () => {
    const onDiscard = vi.fn();
    render(<LeaveUnsavedDialog entries={entries} onSave={vi.fn()} onDiscard={onDiscard} onCancel={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /cancel/i }));
    await userEvent.keyboard('{Enter}');
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it('Escape cancels — the switch is aborted, nothing is dropped', async () => {
    const onCancel = vi.fn(), onDiscard = vi.fn();
    render(<LeaveUnsavedDialog entries={entries} onSave={vi.fn()} onDiscard={onDiscard} onCancel={onCancel} />);
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it('disables every action while a save is in flight, so nothing double-fires', () => {
    render(<LeaveUnsavedDialog entries={entries} busy onSave={vi.fn()} onDiscard={vi.fn()} onCancel={vi.fn()} />);
    for (const name of [/^saving|^save/i, /discard/i, /cancel/i]) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('surfaces a failed save and keeps the dialog actionable', () => {
    render(
      <LeaveUnsavedDialog entries={entries} error="Upload failed" onSave={vi.fn()} onDiscard={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByRole('alert').textContent).toMatch(/Upload failed/);
    expect((screen.getByRole('button', { name: /discard/i }) as HTMLButtonElement).disabled).toBe(false);
  });
});
