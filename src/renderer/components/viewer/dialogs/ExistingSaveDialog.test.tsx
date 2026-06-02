/**
 * ExistingSaveDialog component tests — spec §4.4.3.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import ExistingSaveDialog from './ExistingSaveDialog';

function renderDialog(overrides: Partial<React.ComponentProps<typeof ExistingSaveDialog>> = {}) {
  const onCancel = vi.fn();
  const onOverwrite = vi.fn();
  const onCreateNew = vi.fn();
  const utils = render(
    <ExistingSaveDialog
      open
      containerName="Tumor study A"
      scanId="3004"
      localSummary="3 segments, edited 2 min ago"
      remoteSummary="2 segments, 2 days ago"
      onCancel={onCancel}
      onOverwrite={onOverwrite}
      onCreateNew={onCreateNew}
      {...overrides}
    />,
  );
  return { ...utils, onCancel, onOverwrite, onCreateNew };
}

describe('ExistingSaveDialog (spec §4.4.3)', () => {
  it('does not render when open=false', () => {
    render(
      <ExistingSaveDialog
        open={false}
        containerName="X"
        scanId="1"
        localSummary=""
        remoteSummary=""
        onCancel={() => {}}
        onOverwrite={() => {}}
        onCreateNew={() => {}}
      />,
    );
    expect(screen.queryByTestId('existing-save-dialog')).toBeNull();
  });

  describe('Choose mode', () => {
    it('renders local + remote summary lines and the three actions', () => {
      renderDialog();
      expect(screen.getByTestId('existing-save-dialog').dataset.mode).toBe('choose');
      expect(screen.getByTestId('existing-save-local-summary').textContent).toMatch(/3 segments, edited 2 min ago/);
      expect(screen.getByTestId('existing-save-remote-summary').textContent).toMatch(/2 segments, 2 days ago/);
      expect(screen.queryByTestId('existing-save-cancel')).not.toBeNull();
      expect(screen.queryByTestId('existing-save-create-new')).not.toBeNull();
      expect(screen.queryByTestId('existing-save-overwrite')).not.toBeNull();
    });

    it('shows the scan id in the header subtitle', () => {
      renderDialog({ scanId: '4001' });
      expect(screen.getByTestId('existing-save-dialog').textContent).toMatch(/scan #4001/);
    });

    it('Overwrite fires onOverwrite', () => {
      const { onOverwrite } = renderDialog();
      act(() => {
        fireEvent.click(screen.getByTestId('existing-save-overwrite'));
      });
      expect(onOverwrite).toHaveBeenCalledTimes(1);
    });

    it('Cancel fires onCancel; scrim and Escape also fire it', () => {
      const { onCancel } = renderDialog();
      act(() => fireEvent.click(screen.getByTestId('existing-save-cancel')));
      act(() => fireEvent.click(screen.getByLabelText('Close dialog')));
      act(() => fireEvent.keyDown(window, { key: 'Escape' }));
      expect(onCancel).toHaveBeenCalledTimes(3);
    });

    it('initial focus is on Cancel — Overwrite is never the default', () => {
      renderDialog();
      expect(document.activeElement).toBe(screen.getByTestId('existing-save-cancel'));
    });
  });

  describe('Name mode', () => {
    it('Create new… transitions to Name mode and prefills "{name} (copy)" selected', () => {
      renderDialog({ containerName: 'Heart contours' });
      act(() => {
        fireEvent.click(screen.getByTestId('existing-save-create-new'));
      });
      expect(screen.getByTestId('existing-save-dialog').dataset.mode).toBe('name');
      const input = screen.getByTestId('existing-save-name-input') as HTMLInputElement;
      expect(input.value).toBe('Heart contours (copy)');
      expect(document.activeElement).toBe(input);
    });

    it('Back returns to Choose mode without firing any callback', () => {
      const { onCancel, onOverwrite, onCreateNew } = renderDialog();
      act(() => fireEvent.click(screen.getByTestId('existing-save-create-new')));
      act(() => fireEvent.click(screen.getByTestId('existing-save-back')));
      expect(screen.getByTestId('existing-save-dialog').dataset.mode).toBe('choose');
      expect(onCancel).not.toHaveBeenCalled();
      expect(onOverwrite).not.toHaveBeenCalled();
      expect(onCreateNew).not.toHaveBeenCalled();
    });

    it('Create fires onCreateNew(trimmed-name)', () => {
      const { onCreateNew } = renderDialog({ containerName: 'X' });
      act(() => fireEvent.click(screen.getByTestId('existing-save-create-new')));
      const input = screen.getByTestId('existing-save-name-input');
      act(() => fireEvent.change(input, { target: { value: '  New Name  ' } }));
      act(() => fireEvent.click(screen.getByTestId('existing-save-create')));
      expect(onCreateNew).toHaveBeenCalledWith('New Name');
    });

    it('Enter inside the input submits like Create', () => {
      const { onCreateNew } = renderDialog({ containerName: 'X' });
      act(() => fireEvent.click(screen.getByTestId('existing-save-create-new')));
      const input = screen.getByTestId('existing-save-name-input');
      act(() => fireEvent.change(input, { target: { value: 'Renamed' } }));
      act(() => fireEvent.keyDown(input, { key: 'Enter' }));
      expect(onCreateNew).toHaveBeenCalledWith('Renamed');
    });

    it('empty / whitespace-only name disables Create and does not submit on Enter', () => {
      const { onCreateNew } = renderDialog({ containerName: 'X' });
      act(() => fireEvent.click(screen.getByTestId('existing-save-create-new')));
      const input = screen.getByTestId('existing-save-name-input');
      act(() => fireEvent.change(input, { target: { value: '   ' } }));
      const createBtn = screen.getByTestId('existing-save-create') as HTMLButtonElement;
      expect(createBtn.disabled).toBe(true);
      act(() => fireEvent.keyDown(input, { key: 'Enter' }));
      expect(onCreateNew).not.toHaveBeenCalled();
    });
  });

  it('reopening for a different container resets to Choose mode and refreshes the default name', () => {
    const { rerender } = render(
      <ExistingSaveDialog
        open
        containerName="First"
        scanId="1"
        localSummary=""
        remoteSummary=""
        onCancel={() => {}}
        onOverwrite={() => {}}
        onCreateNew={() => {}}
      />,
    );
    // Enter Name mode.
    act(() => fireEvent.click(screen.getByTestId('existing-save-create-new')));
    expect(screen.getByTestId('existing-save-dialog').dataset.mode).toBe('name');

    // Close + reopen with a new name.
    rerender(
      <ExistingSaveDialog
        open={false}
        containerName="First"
        scanId="1"
        localSummary=""
        remoteSummary=""
        onCancel={() => {}}
        onOverwrite={() => {}}
        onCreateNew={() => {}}
      />,
    );
    rerender(
      <ExistingSaveDialog
        open
        containerName="Second"
        scanId="2"
        localSummary=""
        remoteSummary=""
        onCancel={() => {}}
        onOverwrite={() => {}}
        onCreateNew={() => {}}
      />,
    );
    expect(screen.getByTestId('existing-save-dialog').dataset.mode).toBe('choose');
    act(() => fireEvent.click(screen.getByTestId('existing-save-create-new')));
    const input = screen.getByTestId('existing-save-name-input') as HTMLInputElement;
    expect(input.value).toBe('Second (copy)');
  });
});
