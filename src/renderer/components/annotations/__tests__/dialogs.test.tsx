import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog, ConflictDialog, NameEntryDialog } from '../dialogs';

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
