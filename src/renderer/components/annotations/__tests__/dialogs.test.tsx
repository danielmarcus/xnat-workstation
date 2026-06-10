import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog, ConflictDialog, NameEntryDialog, ReviewUnsavedDialog } from '../dialogs';

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
