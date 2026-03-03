import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import AppDialogHost from './AppDialogHost';
import { useDialogStore } from '../../stores/dialogStore';

function resetDialogStore(): void {
  useDialogStore.setState(useDialogStore.getInitialState(), true);
}

describe('AppDialogHost', () => {
  beforeEach(() => {
    resetDialogStore();
  });

  it('renders nothing when no active dialog exists', () => {
    render(<AppDialogHost />);
    expect(screen.queryByLabelText('Close dialog')).not.toBeInTheDocument();
  });

  it('handles keyboard shortcuts for confirm dialogs', async () => {
    const user = userEvent.setup();
    useDialogStore.setState({
      active: {
        id: 101,
        kind: 'confirm',
        title: 'Unsaved changes',
        message: 'Discard edits?',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
        tone: 'danger',
      },
      queue: [],
    });

    render(<AppDialogHost />);
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep editing' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(useDialogStore.getState().active).toBeNull();

    useDialogStore.setState({
      active: {
        id: 102,
        kind: 'confirm',
        title: 'Apply protocol',
        message: 'Apply now?',
        confirmLabel: 'Apply',
        cancelLabel: 'Cancel',
        tone: 'default',
      },
      queue: [],
    });

    await user.keyboard('{Enter}');
    expect(useDialogStore.getState().active).toBeNull();
  });

  it('supports backdrop and button resolution for confirm and alert dialogs', async () => {
    const user = userEvent.setup();
    useDialogStore.setState({
      active: {
        id: 201,
        kind: 'confirm',
        title: 'Delete file',
        message: 'This cannot be undone.',
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        tone: 'danger',
      },
      queue: [],
    });

    const view = render(<AppDialogHost />);
    await user.click(screen.getByLabelText('Close dialog'));
    expect(useDialogStore.getState().active).toBeNull();

    useDialogStore.setState({
      active: {
        id: 202,
        kind: 'alert',
        title: 'Notice',
        message: 'Export complete.',
        confirmLabel: 'OK',
        cancelLabel: 'Cancel',
        tone: 'default',
      },
      queue: [],
    });
    view.rerender(<AppDialogHost />);

    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'OK' }));
    expect(useDialogStore.getState().active).toBeNull();
  });
});
